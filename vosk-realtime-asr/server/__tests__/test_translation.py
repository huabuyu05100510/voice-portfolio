"""
同声传译 2.0 (Simultaneous Interpretation 2.0) 服务端代理 — TDD 单元测试

覆盖:
- _build_request        : 构造火山引擎翻译 API JSON body (source/target/lang/text)
- translate_stream      : 流式 WebSocket → 拆分 partial/final 回调
- translate 错误         : 4xx/5xx/network → TranslationError
- translate 缺凭证       : 抛 MisconfiguredError, 不发请求
- 缓存命中               : 相同 (src, src_lang, tgt_lang) → 跳过 API
- 限流 / 计量            : translation_requests_total{lang_pair, status}, latency
- 语言对                 : 仅允许在 SUPPORTED_PAIRS 内
- 端到端延迟             : 记录到 metrics.translation_latency_ms

测试方式: mock urllib.request / websocket-client, 不打真实网络.

**模型**: MiniMax-M3
"""
import sys
import os
import json
import time
import threading
import pytest
from unittest import mock

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)


# ----------------------------------------------------------------------------
# fixtures
# ----------------------------------------------------------------------------
@pytest.fixture
def fake_env(monkeypatch):
    """设置同声传译 2.0 凭证环境变量, reload translation 模块"""
    monkeypatch.setenv('VOLC_TRANSLATE_APP_ID', 'test-translate-app')
    monkeypatch.setenv('VOLC_TRANSLATE_TOKEN', 'test-translate-token')
    monkeypatch.setenv('VOLC_TRANSLATE_ENDPOINT', 'https://openspeech.bytedance.com/api/v2/simultaneous')
    monkeypatch.setenv('VOLC_TRANSLATE_RESOURCE_ID', 'volc.translate.s2t.v2')
    # 不 reload: prometheus_client 在 reload 时报 duplicated timeseries.
    # 测试通过 mock.patch.object 替换 _post_translate / metrics, 避免依赖模块 import 时的环境.


# ----------------------------------------------------------------------------
# TDD RED: 这些测试在实现前必须先失败
# ----------------------------------------------------------------------------
def test_module_imports():
    """translation.py 应可被 import, 不抛副作用"""
    import translation  # noqa: F401
    assert hasattr(translation, 'translate_stream')
    assert hasattr(translation, 'translate_once')
    assert hasattr(translation, 'MisconfiguredError')
    assert hasattr(translation, 'TranslationError')


def test_supported_language_pairs():
    """SUPPORTED_PAIRS 应包含 zh-en, en-zh, zh-ja, ja-zh 等主要语言对"""
    import translation
    assert 'zh-en' in translation.SUPPORTED_PAIRS
    assert 'en-zh' in translation.SUPPORTED_PAIRS
    assert 'zh-ja' in translation.SUPPORTED_PAIRS
    # zh↔zh 不允许 (无意义)
    assert 'zh-zh' not in translation.SUPPORTED_PAIRS


def test_is_valid_lang_pair():
    """_is_valid_lang_pair 应只接受白名单内的 pair"""
    import translation
    assert translation._is_valid_lang_pair('zh-en') is True
    assert translation._is_valid_lang_pair('zh-XX') is False
    assert translation._is_valid_lang_pair('') is False


def test_build_request_shape(fake_env):
    """_build_request 应生成火山引擎翻译 API 标准 body"""
    import translation
    body = translation._build_request(
        text='你好世界',
        source_lang='zh',
        target_lang='en',
        session_id='test-session',
    )
    parsed = json.loads(body)
    assert parsed['app']['appid'] == 'test-translate-app'
    assert parsed['app']['token'] == 'test-translate-token'
    assert parsed['app']['resource_id'] == 'volc.translate.s2t.v2'
    assert parsed['user']['uid'] == 'voice-portfolio-translate'
    assert parsed['request']['text'] == '你好世界'
    assert parsed['request']['source_language'] == 'zh'
    assert parsed['request']['target_language'] == 'en'
    assert 'reqid' in parsed['request']
    assert parsed['session']['session_id'] == 'test-session'


def test_translate_once_success(fake_env):
    """translate_once 应调用 API 并返回翻译结果 + 延迟"""
    import translation

    expected_response = {
        'code': 0,
        'message': 'success',
        'data': {
            'translation': 'Hello world',
            'source_language': 'zh',
            'target_language': 'en',
            'latency_ms': 120,
        },
    }

    with mock.patch.object(translation, '_post_translate') as mock_post:
        mock_post.return_value = expected_response
        result = translation.translate_once(
            text='你好世界',
            source_lang='zh',
            target_lang='en',
        )

    assert result['translation'] == 'Hello world'
    assert result['source_language'] == 'zh'
    assert result['target_language'] == 'en'
    mock_post.assert_called_once()
    # 第二参数应是 dict 含正确 fields
    call_args = mock_post.call_args
    body = json.loads(call_args[0][1])
    assert body['request']['text'] == '你好世界'


def test_translate_once_invalid_pair(fake_env):
    """不支持的语言对应抛 InvalidLanguagePairError"""
    import translation
    with pytest.raises(translation.InvalidLanguagePairError):
        translation.translate_once(
            text='你好',
            source_lang='zh',
            target_lang='xx',  # 不支持
        )


def test_translate_once_misconfigured(monkeypatch):
    """缺凭证应抛 MisconfiguredError, 不发请求"""
    monkeypatch.delenv('VOLC_TRANSLATE_APP_ID', raising=False)
    monkeypatch.delenv('VOLC_TRANSLATE_TOKEN', raising=False)
    import translation

    with pytest.raises(translation.MisconfiguredError):
        translation.translate_once(text='你好', source_lang='zh', target_lang='en')


def test_translate_once_cache_hit(fake_env):
    """相同 (text, src, tgt) 二次调用应命中缓存, 不再发请求"""
    import translation

    with mock.patch.object(translation, '_post_translate') as mock_post:
        mock_post.return_value = {
            'code': 0,
            'data': {'translation': 'Hello', 'source_language': 'zh', 'target_language': 'en', 'latency_ms': 100},
        }

        # 第一次: cache miss
        r1 = translation.translate_once(text='你好', source_lang='zh', target_lang='en')
        assert mock_post.call_count == 1
        assert r1['translation'] == 'Hello'

        # 第二次: cache hit
        r2 = translation.translate_once(text='你好', source_lang='zh', target_lang='en')
        assert mock_post.call_count == 1  # 没增加
        assert r2['translation'] == 'Hello'

        # 清理 cache (避免污染后续测试)
        translation._translation_cache.clear()


def test_translate_once_cache_different_pair(fake_env):
    """不同目标语言不算同一缓存"""
    import translation
    with mock.patch.object(translation, '_post_translate') as mock_post:
        mock_post.side_effect = [
            {'code': 0, 'data': {'translation': 'Hello', 'source_language': 'zh', 'target_language': 'en', 'latency_ms': 100}},
            {'code': 0, 'data': {'translation': 'こんにちは', 'source_language': 'zh', 'target_language': 'ja', 'latency_ms': 130}},
        ]

        r1 = translation.translate_once(text='你好', source_lang='zh', target_lang='en')
        r2 = translation.translate_once(text='你好', source_lang='zh', target_lang='ja')
        assert mock_post.call_count == 2
        assert r1['translation'] == 'Hello'
        assert r2['translation'] == 'こんにちは'

        translation._translation_cache.clear()


def test_translate_once_api_error(fake_env):
    """API 返回 code != 0 应抛 TranslationError"""
    import translation
    with mock.patch.object(translation, '_post_translate') as mock_post:
        mock_post.return_value = {'code': 401, 'message': 'auth failed'}
        with pytest.raises(translation.TranslationError) as exc:
            translation.translate_once(text='你好', source_lang='zh', target_lang='en')
        assert 'auth failed' in str(exc.value) or '401' in str(exc.value)


def test_translate_once_network_error(fake_env):
    """网络异常应抛 TranslationError(包含 network 信息)"""
    import translation
    with mock.patch.object(translation, '_post_translate') as mock_post:
        mock_post.side_effect = translation.TranslationError('network unreachable')
        with pytest.raises(translation.TranslationError):
            translation.translate_once(text='你好', source_lang='zh', target_lang='en')


def test_translate_once_records_metrics(fake_env):
    """translate_once 应增加 translation_requests_total 指标 + 观察 latency"""
    import translation

    fake = FakeMetrics()

    with mock.patch.object(translation, '_post_translate') as mock_post, \
         mock.patch.object(translation, 'metrics', fake):
        mock_post.return_value = {
            'code': 0,
            'data': {'translation': 'Hello', 'source_language': 'zh', 'target_language': 'en', 'latency_ms': 100},
        }

        translation.translate_once(text='你好', source_lang='zh', target_lang='en')
        # 成功调用 + zh-en → counter 出现 status=success|lang_pair=zh-en 计数 1
        key_success = next((k for k in fake._counter_store if 'zh-en' in k and 'success' in k), None)
        assert key_success is not None, f"missing success counter: {fake._counter_store}"
        assert fake._counter_store[key_success] >= 1
        # latency histogram 应被 observe 至少一次
        assert fake._latency_store['count'] >= 1

        translation._translation_cache.clear()


def test_translate_stream_emits_partial_and_final(fake_env):
    """translate_stream 应按 partial/final 顺序触发回调"""
    import translation

    frames = [
        '{"type":"partial","text":"Hello","is_final":false}',
        '{"type":"partial","text":"Hello world","is_final":false}',
        '{"type":"final","text":"Hello world","is_final":true,"latency_ms":150}',
    ]

    partials = []
    finals = []
    errors = []

    done = threading.Event()

    class FakeWS:
        def __init__(self, frames):
            self.frames = list(frames)
            self.idx = 0
            self.sent = []

        def send(self, payload):
            self.sent.append(payload)

        def recv(self):
            if self.idx >= len(self.frames):
                time.sleep(0.01)
                if done.is_set():
                    raise EOFError('done')
                # 阻塞 — 但我们已经 set 了 done, 所以应该不会到这里
                raise EOFError('done')
            frame = self.frames[self.idx]
            self.idx += 1
            return frame

    fake_ws = FakeWS(frames)

    def on_partial(text, lang_pair):
        partials.append((text, lang_pair))

    def on_final(text, lang_pair, latency_ms):
        finals.append((text, lang_pair, latency_ms))
        done.set()

    def on_error(code, msg):
        errors.append((code, msg))

    # 启动 stream (同步方法, 内部循环)
    translation.translate_stream(
        text='你好世界',
        source_lang='zh',
        target_lang='en',
        on_partial=on_partial,
        on_final=on_final,
        on_error=on_error,
        _ws_factory=lambda url, headers: fake_ws,
    )

    assert len(partials) == 2
    assert partials[0][0] == 'Hello'
    assert partials[1][0] == 'Hello world'
    assert len(finals) == 1
    assert finals[0][0] == 'Hello world'
    assert finals[0][2] >= 0
    assert errors == []


def test_translate_stream_handles_error(fake_env):
    """translate_stream 收到 type=error 帧应触发 on_error 回调"""
    import translation

    frames = [
        '{"type":"error","code":401,"message":"unauthorized"}',
    ]

    errors = []

    class FakeWS:
        def __init__(self):
            self.sent = []

        def send(self, payload):
            self.sent.append(payload)

        def recv(self):
            return frames.pop(0) if frames else (_ for _ in ()).throw(EOFError('done'))

    fake_ws = FakeWS()

    translation.translate_stream(
        text='你好',
        source_lang='zh',
        target_lang='en',
        on_partial=lambda *a: None,
        on_final=lambda *a: None,
        on_error=lambda code, msg: errors.append((code, msg)),
        _ws_factory=lambda url, headers: fake_ws,
    )

    assert len(errors) == 1
    assert errors[0][0] == 401


def test_translation_cache_key():
    """_cache_key 应基于 (text, source, target) 生成稳定 hash"""
    import translation
    k1 = translation._cache_key('你好', 'zh', 'en')
    k2 = translation._cache_key('你好', 'zh', 'en')
    k3 = translation._cache_key('你好', 'zh', 'ja')
    assert k1 == k2
    assert k1 != k3
    # 长度合理 (不为空字符串)
    assert len(k1) > 0


def test_translation_clear_cache(fake_env):
    """clear_cache 应清空缓存"""
    import translation
    translation._translation_cache['dummy'] = 'value'
    assert 'dummy' in translation._translation_cache
    translation.clear_cache()
    assert 'dummy' not in translation._translation_cache


def test_metrics_initialized():
    """translation 模块应有 metrics 实例 (Counter / Histogram)"""
    import translation
    assert hasattr(translation, 'metrics')
    assert hasattr(translation.metrics, 'translation_requests_total')
    assert hasattr(translation.metrics, 'translation_latency_ms')
    assert hasattr(translation.metrics, 'translation_cache_hits_total')


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
class FakeMetrics:
    """最小化 Prometheus metric 替代 (Counter.labels(**).inc() + Histogram.observe)"""
    def __init__(self):
        self._counter_store = {}
        self._latency_store = {'count': 0, 'value': 0.0}
        self._cache_hits_store = {}

        outer = self

        class _Counter:
            def labels(s, **kw):
                # 单标签版: key = sorted(k=v)
                key = '|'.join(f"{k}={kw[k]}" for k in sorted(kw.keys()))
                class _L:
                    def inc(s, n=1):
                        # 该 fake 容纳 requests_total / cache_hits_total / errors_total
                        # 用 prefix 区分: 调用方传 status=success → requests_total
                        # 调用方传 lang_pair 单独 → cache_hits_total
                        # 调用方传 reason=... → errors_total
                        outer._counter_store[key] = outer._counter_store.get(key, 0) + n
                return _L()

        class _Hist:
            def observe(self, v):
                outer._latency_store['count'] += 1
                outer._latency_store['value'] += v

        self.translation_requests_total = _Counter()
        self.translation_latency_ms = _Hist()
        self.translation_cache_hits_total = _Counter()
        self.translation_errors_total = _Counter()


if __name__ == '__main__':
    sys.exit(pytest.main([__file__, '-v']))