"""
火山引擎 v3 sauc 累积协议契约测试

背景: F2 fix 曾错误假设火山引擎 v3 是"single 模式"(每帧 only 最新一句),
把 is_cumulative 硬编码为 False。实测日志证明协议是**累积模式** —
同一轮发言内, text 单调增长 (3→8→...→74), 轮次切换才重置。

is_cumulative=False 会令 reducer 跳过前缀合并, 把每一帧当新句追加 →
"一句话分成好几句 一个人分成好几段"。

本测试锁定: 服务端 emit 的 payload.is_cumulative 必须 True。
"""
import os
import sys

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)

import app  # noqa: E402


class _FakeCounter:
    def labels(self, **_kw):
        return self

    def inc(self, _n=1):
        pass


class _FakeHistogram:
    def observe(self, _v):
        pass


class _FakeMetrics:
    transcription_results_total = _FakeCounter()
    transcription_chars_total = _FakeCounter()
    transcription_latency = _FakeHistogram()
    transcription_errors_total = _FakeCounter()


def _install_stubs():
    """app.py 模块级 metrics/logger 默认 None, 注入桩"""
    if app.metrics is None:
        app.metrics = _FakeMetrics()
    if app.logger is None:
        class _FakeLogger:
            def info(self, *a, **k):
                pass

            def error(self, *a, **k):
                pass

        app.logger = _FakeLogger()


def _capture_final(monkeypatch_emit):
    """复刻 _on_volc_final 调用并捕获 socketio.emit payload"""
    captured = {}

    def fake_emit(event, payload, to=None):
        captured['event'] = event
        captured['payload'] = payload
        captured['to'] = to

    # app.socketio.emit 是 bound 方法, 直接替换模块属性
    class _FakeSocketIO:
        emit = staticmethod(fake_emit)

    orig = app.socketio
    app.socketio = _FakeSocketIO()
    try:
        app._on_volc_final(
            text="你好吗今天天气",
            utterances=[{
                'text': '你好吗今天天气',
                'additions': {'speaker_id': '0'},
            }],
            speakers=[{'id': '0', 'label': '发言人 1'}],
            latency_ms=120.0,
            sid='test-sid-cumulative',
        )
    finally:
        app.socketio = orig
    return captured


def _seed_session():
    """注入一个最小可用的 session"""
    from text_buffer import smart_append
    buf, _ = smart_append('', '你好吗')
    app.sessions['test-sid-cumulative'] = {
        'text_buffer': buf,
        'speakers_seen': {},
        'current_speaker_id': None,
        'last_known_speaker_id': None,
        'metrics': {
            'transcription_chars': 0,
            'latencies': [],
            'speaker_count': 0,
            'audio_bytes': 0,
            'chunks_processed': 0,
            'avg_latency': 0,
            'total_latencies': 0,
            'startTime': 0,
        },
    }


def test_final_emits_cumulative_true():
    """火山引擎 v3 是累积协议 — is_cumulative 必须 True, 否则 reducer 乱分句"""
    _seed_session()
    _install_stubs()
    captured = _capture_final(None)
    assert captured['event'] == 'transcription_result'
    payload = captured['payload']
    assert payload['is_final'] is True
    # 核心断言: 必须告知客户端走累积合并 (path A: 前缀扩展就地更新)
    assert payload.get('is_cumulative') is True, (
        "火山引擎 v3 sauc 是累积协议 — is_cumulative=False 会导致 reducer "
        "把同一句的每一帧都追加成新卡片, 字幕裂成几十段"
    )


def test_final_has_speaker_id_resolved():
    """累积帧同时应携带 speaker_id (从 utterance.additions 解析)"""
    _seed_session()
    _install_stubs()
    captured = _capture_final(None)
    payload = captured['payload']
    assert payload.get('speaker_id') == '0'


def test_final_speaker_fallback_to_last_known():
    """累积帧 utterance_count=1 无 speaker_id 时,
    payload.speaker_id 必须 fallback 到 last_known, 否则 UI 全是"未知说话人".
    """
    _seed_session()
    _install_stubs()
    # 模拟前一句边界帧已解析到 "0", sticky 已落
    app.sessions['test-sid-cumulative']['last_known_speaker_id'] = '0'
    app.sessions['test-sid-cumulative']['current_speaker_id'] = '0'

    # 当前帧: utterances 内无 speaker_id (累积中间帧常见)
    captured = {}

    def fake_emit(event, payload, to=None):
        captured['payload'] = payload

    class _Fake:
        emit = staticmethod(fake_emit)

    orig = app.socketio
    app.socketio = _Fake()
    try:
        app._on_volc_final(
            text="继续说",
            utterances=[{'text': '继续说'}],  # 无 additions.speaker_id
            speakers=[],
            latency_ms=50.0,
            sid='test-sid-cumulative',
        )
    finally:
        app.socketio = orig

    # 核心断言: 累积中间帧无 speaker 时, 必须 fallback 到 last_known="0"
    assert captured['payload'].get('speaker_id') == '0', (
        "final 累积帧 speaker_id 必须沿用 last_known, 否则 UI 显示'未知说话人'"
    )
