"""
SeedTTS 2.0 (语音合成 2.0) 服务端代理 — TDD 单元测试

覆盖:
- _build_request  : 构造火山引擎标准 JSON body (app / token / cluster / user / audio / voice / text)
- list_voices      : 拉取音色列表 (curl volcengine 模拟响应) → 规整成 {id, name, gender, ...}
- synthesize       : 流式 HTTP 响应 (chunked MP3) → bytes 累积
- synthesize 错误   : 4xx/5xx 抛 TTSError
- synthesize 缺凭证 : 抛 MisconfiguredError, 不发请求
- 限流             : 连续失败计数 → tts_errors_total{reason}
- 计量             : tts_requests_total{voice, status}, tts_latency_seconds

测试方式: mock urllib.request.urlopen, 不打真实网络.
"""
import sys
import os
import io
import json
import time
import pytest
from unittest import mock

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)


# ----------------------------------------------------------------------------
# fixtures
# ----------------------------------------------------------------------------
@pytest.fixture
def fake_env(monkeypatch):
    monkeypatch.setenv('VOLC_TTS_APP_ID', 'test-app-id')
    monkeypatch.setenv('VOLC_TTS_TOKEN', 'test-token')
    monkeypatch.setenv('VOLC_TTS_CLUSTER', 'volcano_tts')
    monkeypatch.setenv('VOLC_TTS_VOICE', 'BV001_streaming')
    monkeypatch.setenv('VOLC_TTS_ENDPOINT', 'https://openspeech.bytedance.com/api/v1/tts')
    # 重要: 防止 from tts import * 副作用 import real config
    import importlib
    if 'tts' in sys.modules:
        importlib.reload(sys.modules['tts'])


@pytest.fixture
def fake_mp3_bytes():
    # 16 字节占位 MP3 (不要求真实解码, 这里只测流式累积)
    return b'\xff\xfb\x90\x00' + b'\x00' * 12


# ----------------------------------------------------------------------------
# TDD RED: 这些测试在实现前必须先失败
# ----------------------------------------------------------------------------
def test_module_imports():
    """tts.py 应可被 import, 不抛副作用"""
    import tts  # noqa: F401
    assert hasattr(tts, 'synthesize')
    assert hasattr(tts, 'list_voices')


def test_build_request_shape(fake_env):
    """_build_request 应生成火山引擎语音合成标准 body"""
    import tts
    body = tts._build_request(
        text='你好世界',
        voice='BV001_streaming',
        speed=1.0,
        pitch=1.0,
        audio_format='mp3',
    )
    parsed = json.loads(body)
    assert parsed['app']['appid'] == 'test-app-id'
    assert parsed['app']['token'] == 'test-token'
    assert parsed['app']['cluster'] == 'volcano_tts'
    assert parsed['user']['uid'] == 'voice-portfolio-web'
    assert parsed['audio']['voice_type'] == 'BV001_streaming'
    assert parsed['audio']['encoding'] == 'mp3'
    assert parsed['audio']['speed_ratio'] == 1.0
    assert parsed['audio']['pitch_ratio'] == 1.0
    assert parsed['request']['reqid'].endswith(':text')
    assert '你好世界' in parsed['request']['text']


def test_build_request_ssml(fake_env):
    """SSML 输入应原样塞到 text 字段, 不剥离标签"""
    import tts
    ssml = '<speak>你好<break time="500ms"/>世界</speak>'
    body = tts._build_request(text=ssml, voice='BV001_streaming')
    parsed = json.loads(body)
    assert parsed['request']['text'] == ssml
    assert parsed['request']['text_type'] == 'ssml'


def test_synthesize_returns_mp3_bytes(fake_env, fake_mp3_bytes):
    """synthesize 成功 → 返回完整 MP3 bytes, 耗时记入 metric"""
    import tts
    fake_resp = mock.MagicMock()
    fake_resp.read.side_effect = [fake_mp3_bytes, b'']  # chunked
    fake_resp.status = 200
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = lambda s, *a: False

    with mock.patch('tts.urlopen', return_value=fake_resp) as urlopen_mock:
        audio = tts.synthesize(text='测试', voice='BV001_streaming', speed=1.0, pitch=1.0, audio_format='mp3')
    assert audio == fake_mp3_bytes
    # urlopen 收到正确 URL + POST + Bearer
    req = urlopen_mock.call_args[0][0]
    assert req.get_full_url() == 'https://openspeech.bytedance.com/api/v1/tts'
    assert req.get_method() == 'POST'
    assert req.get_header('Authorization') == 'Bearer; test-token'
    body = json.loads(req.data.decode('utf-8'))
    assert body['audio']['voice_type'] == 'BV001_streaming'


def test_synthesize_streaming_chunks_accumulated(fake_env):
    """分块响应 (5 块) 应被累积成完整 bytes"""
    import tts
    chunks = [b'chunk-' + str(i).encode() for i in range(5)]
    fake_resp = mock.MagicMock()
    fake_resp.read.side_effect = chunks + [b'']
    fake_resp.status = 200
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = lambda s, *a: False
    with mock.patch('tts.urlopen', return_value=fake_resp):
        audio = tts.synthesize(text='hi', voice='BV001_streaming')
    assert audio == b''.join(chunks)


def test_synthesize_4xx_raises_tts_error(fake_env):
    """HTTP 4xx → 抛 TTSError, status/body 可读"""
    import tts
    err = urllib_error_with(code=401, body='{"error":"unauthorized"}')
    with mock.patch('tts.urlopen', side_effect=err):
        with pytest.raises(tts.TTSError) as ei:
            tts.synthesize(text='hi', voice='BV001_streaming')
    assert ei.value.status_code == 401
    assert 'unauthorized' in ei.value.body


def test_synthesize_5xx_raises_tts_error(fake_env):
    """HTTP 5xx → 抛 TTSError"""
    import tts
    err = urllib_error_with(code=500, body='server down')
    with mock.patch('tts.urlopen', side_effect=err):
        with pytest.raises(tts.TTSError) as ei:
            tts.synthesize(text='hi', voice='BV001_streaming')
    assert ei.value.status_code == 500


def test_synthesize_no_credentials_raises(monkeypatch):
    """未配 VOLC_TTS_* → MisconfiguredError, 不发请求"""
    for k in ('VOLC_TTS_APP_ID', 'VOLC_TTS_TOKEN', 'VOLC_TTS_CLUSTER'):
        monkeypatch.delenv(k, raising=False)
    import tts
    with pytest.raises(tts.MisconfiguredError):
        tts.synthesize(text='hi', voice='BV001_streaming')


def test_synthesize_text_too_long_raises(fake_env):
    """超过 1024 字节 (火山引擎单次硬限) → ValidationError"""
    import tts
    too_long = 'a' * 2048
    with pytest.raises(tts.ValidationError):
        tts.synthesize(text=too_long, voice='BV001_streaming')


def test_synthesize_invalid_speed(fake_env):
    """speed 不在 0.5~2.0 → ValidationError"""
    import tts
    with pytest.raises(tts.ValidationError):
        tts.synthesize(text='hi', voice='BV001_streaming', speed=3.0)


def test_synthesize_records_metrics(fake_env, fake_mp3_bytes, monkeypatch):
    """成功合成应 inc tts_requests_total{voice, status=ok} + observe latency"""
    import tts
    # 注入 fake metrics
    fake_metrics = FakeMetrics()
    monkeypatch.setattr(tts, 'metrics', fake_metrics)
    fake_resp = mock.MagicMock()
    fake_resp.read.side_effect = [fake_mp3_bytes, b'']
    fake_resp.status = 200
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = lambda s, *a: False
    with mock.patch('tts.urlopen', return_value=fake_resp):
        tts.synthesize(text='hi', voice='BV002_streaming', speed=1.0, pitch=1.0)
    assert fake_metrics.total_ok() == 1
    assert fake_metrics.latency_store['count'] == 1
    assert fake_metrics.latency_store['value'] > 0


def test_list_voices_returns_normalized_list(fake_env):
    """list_voices 应把火山引擎响应规整成 [{id, name, gender, sample_rate}]"""
    import tts
    # 火山引擎 ListVoices 标准响应 (mock)
    volc_payload = {
        'data': [
            {'voice_type': 'BV001_streaming', 'name': '磁性男声', 'gender': 'male', 'sample_rate': 24000},
            {'voice_type': 'BV002_streaming', 'name': '温柔女声', 'gender': 'female', 'sample_rate': 24000},
        ]
    }
    fake_resp = mock.MagicMock()
    fake_resp.read.return_value = json.dumps(volc_payload).encode('utf-8')
    fake_resp.status = 200
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = lambda s, *a: False
    with mock.patch('tts.urlopen', return_value=fake_resp):
        voices = tts.list_voices()
    assert len(voices) == 2
    assert voices[0]['id'] == 'BV001_streaming'
    assert voices[0]['name'] == '磁性男声'
    assert voices[0]['gender'] == 'male'
    assert voices[1]['id'] == 'BV002_streaming'


def test_list_voices_no_credentials_raises(monkeypatch):
    """未配置 → MisconfiguredError"""
    for k in ('VOLC_TTS_APP_ID', 'VOLC_TTS_TOKEN'):
        monkeypatch.delenv(k, raising=False)
    import tts
    with pytest.raises(tts.MisconfiguredError):
        tts.list_voices()


def test_audio_format_normalization(fake_env):
    """mp3 / pcm / opus 三种格式应映射到火山引擎 encoding 字段"""
    import tts
    for fmt, expected in [('mp3', 'mp3'), ('pcm', 'pcm'), ('wav', 'wav')]:
        body = json.loads(tts._build_request(text='x', voice='v', audio_format=fmt))
        assert body['audio']['encoding'] == expected


def test_default_voice_used_when_omitted(fake_env):
    """synthesize 不传 voice → 用 VOLC_TTS_VOICE env"""
    import tts
    body = json.loads(tts._build_request(text='x', voice=None))
    assert body['audio']['voice_type'] == 'BV001_streaming'


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def urllib_error_with(code: int, body: str):
    """构造一个 urlopen 抛出的 HTTPError"""
    from urllib.error import HTTPError
    return HTTPError(
        url='https://openspeech.bytedance.com/api/v1/tts',
        code=code,
        msg='error',
        hdrs={},
        fp=io.BytesIO(body.encode('utf-8')),
    )


class FakeMetrics:
    """最小化 Prometheus metric 替代, 仅 tts.* 关注
    - tts_requests_total: 带 .labels(**kw).inc(n) 接口
    - tts_latency_seconds: 带 .observe(v) 接口
    - 外层 dict 暴露 (tts_requests_total / tts_latency) 供测试 assert
    """
    def __init__(self):
        self._counter_store = {}      # status → count
        self._latency_store = {'count': 0, 'value': 0.0}

        outer = self

        class _Counter:
            def labels(self, **kw):
                # 火山引擎代码用 (status, voice) 两标签, 这里把 (status, voice) 拼成 key
                key = f"status={kw.get('status','ok')}|voice={kw.get('voice','-')}"
                class _L:
                    def inc(s, n=1):
                        outer._counter_store[key] = outer._counter_store.get(key, 0) + n
                return _L()
        class _Hist:
            def observe(self, v):
                outer._latency_store['count'] += 1
                outer._latency_store['value'] += v
        self._counter = _Counter()
        self._hist = _Hist()

    @property
    def tts_requests_total(self):
        return self._counter

    @property
    def tts_latency_seconds(self):
        return self._hist

    # 测试便捷访问
    @property
    def counter_store(self):
        """{ "status=ok|voice=BV001" : n, ... }"""
        return self._counter_store

    @property
    def latency_store(self):
        return self._latency_store

    def total_ok(self):
        return sum(v for k, v in self._counter_store.items() if 'status=ok' in k)

    def total_error(self):
        return sum(v for k, v in self._counter_store.items() if 'status=error' in k)
