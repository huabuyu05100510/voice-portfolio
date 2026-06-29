"""
端到端实时语音交互 (Realtime Voice Interaction) — 服务端单元测试 (TDD red)

覆盖:
- RealtimeConfig 凭证校验 (缺 token 抛 ConfigError, 不静默用空 token)
- build_auth_headers 注入 Authorization + X-Api-App-Id + X-Api-Resource-Id
- build_session_update_payload 生成 session.update JSON 事件
- encode_audio_chunk 生成 input_audio_buffer.append 事件 (PCM → base64)
- decode_server_event 解析服务端事件 (audio delta / transcript delta / speech_started / error / done)
- /api/realtime endpoint: 401 when no creds; WSS proxy round-trip mock

火山引擎 Doubao Realtime Voice API:
  - 端点: wss://openspeech.bytedance.com/api/v3/realtime (OpenAI Realtime 兼容事件)
  - 鉴权: Authorization Bearer + X-Api-App-Id + X-Api-Resource-Id
  - JSON 事件: session.update, input_audio_buffer.append, response.audio.delta, ...

模型: MiniMax-M3
"""
import base64
import json
import os
import sys
from unittest.mock import MagicMock, patch

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)


def _build_client(app_id: str = "test-app-id", token: str = "test-token", endpoint: str = "wss://example.com/api/v3/realtime"):
    from realtime_voice import RealtimeClient, RealtimeConfig
    cfg = RealtimeConfig(
        app_id=app_id,
        access_token=token,
        endpoint=endpoint,
        model="Doubao_scene_SLM_Doubao_realtime_voice_model",
    )
    return RealtimeClient(cfg)


# ============================================================================
# Config: fail-fast
# ============================================================================
def test_config_error_when_no_credentials():
    """app_id + access_token 都为空时, 构造 client 抛 ConfigError."""
    from realtime_voice import RealtimeConfig, RealtimeClient
    with __import__("pytest").raises(Exception) as exc_info:
        RealtimeClient(RealtimeConfig(app_id="", access_token="", endpoint="wss://x"))
    assert "凭证" in str(exc_info.value) or "credential" in str(exc_info.value).lower()


# ============================================================================
# build_auth_headers
# ============================================================================
def test_build_auth_headers_uses_bearer_token():
    """主鉴权用 Authorization Bearer."""
    client = _build_client(token="secret-token-xyz")
    headers = client._build_auth_headers()
    assert headers.get("Authorization") == "Bearer; secret-token-xyz", \
        "Authorization 必须为 'Bearer; {token}' 格式 (火山引擎约定)"

    # 火山引擎历史 v3 文档用 'Bearer; ' 前缀 (分号 + 空格)
    assert headers["Authorization"].startswith("Bearer; ")


def test_build_auth_headers_includes_app_id_and_resource_id():
    """X-Api-App-Id + X-Api-Resource-Id 必须注入."""
    client = _build_client(app_id="app-123")
    client.config.resource_id = "volc.speech.realtime_voice"
    headers = client._build_auth_headers()
    assert headers.get("X-Api-App-Id") == "app-123"
    assert headers.get("X-Api-Resource-Id") == "volc.speech.realtime_voice"


# ============================================================================
# build_session_update_payload
# ============================================================================
def test_build_session_update_payload_default_vad():
    """默认 session.update 包含 VAD 配置 (turn_detection)."""
    client = _build_client()
    payload = client.build_session_update_payload()
    assert payload["type"] == "session.update"
    session = payload["session"]
    assert "turn_detection" in session
    td = session["turn_detection"]
    # VAD 灵敏度默认配置 (eager 但不激进)
    assert td.get("type") in ("server_vad", None)
    assert "silence_duration_ms" in td
    assert td["silence_duration_ms"] >= 200


def test_build_session_update_payload_includes_audio_format_pcm16k():
    """音频格式必须声明 pcm16 @ 16kHz mono."""
    client = _build_client()
    payload = client.build_session_update_payload()
    audio = payload["session"]["input_audio_format"]
    assert audio == "pcm16"

    output_audio = payload["session"].get("output_audio_format")
    assert output_audio in ("pcm16", "pcm", None)  # 服务端可能默认 pcm


def test_build_session_update_payload_can_pass_instructions():
    """可选 system instructions 透传给 LLM."""
    client = _build_client()
    payload = client.build_session_update_payload(instructions="你是一个友好的助手")
    assert payload["session"]["instructions"] == "你是一个友好的助手"


# ============================================================================
# encode_audio_chunk
# ============================================================================
def test_encode_audio_chunk_wraps_pcm_in_base64():
    """16-bit PCM 字节 → base64 字符串塞入 input_audio_buffer.append 事件."""
    client = _build_client()
    pcm = b"\x00\x01\x02\x03" * 4  # 16 字节 PCM
    event = client.encode_audio_chunk(pcm)
    assert event["type"] == "input_audio_buffer.append"
    audio_b64 = event["audio"]
    assert isinstance(audio_b64, str)
    # 必须能 base64 解码回原始字节
    decoded = base64.b64decode(audio_b64)
    assert decoded == pcm


def test_encode_audio_chunk_empty_pcm_returns_empty_event():
    """空 PCM → event.audio = '' (不抛)."""
    client = _build_client()
    event = client.encode_audio_chunk(b"")
    assert event["type"] == "input_audio_buffer.append"
    assert event["audio"] == ""


# ============================================================================
# decode_server_event
# ============================================================================
def test_decode_audio_delta_extracts_base64_audio():
    """response.audio.delta: { delta: <base64> } → 返回 (audio_bytes, response_id, item_id)."""
    client = _build_client()
    payload_b64 = base64.b64encode(b"\x10\x20\x30").decode("ascii")
    raw = json.dumps({
        "type": "response.audio.delta",
        "delta": payload_b64,
        "response_id": "resp_1",
        "item_id": "item_1",
    })
    result = client.decode_server_event(raw)
    assert result["type"] == "response.audio.delta"
    assert result["audio_bytes"] == b"\x10\x20\x30"
    assert result["response_id"] == "resp_1"
    assert result["item_id"] == "item_1"


def test_decode_audio_transcript_delta_extracts_text():
    """response.audio_transcript.delta: { delta: '你' } → text='你'."""
    client = _build_client()
    raw = json.dumps({
        "type": "response.audio_transcript.delta",
        "delta": "你好",
        "response_id": "resp_1",
        "item_id": "item_1",
    })
    result = client.decode_server_event(raw)
    assert result["type"] == "response.audio_transcript.delta"
    assert result["text"] == "你好"


def test_decode_speech_started_signals_barge_in():
    """input_audio_buffer.speech_started → barge_in=True."""
    client = _build_client()
    raw = json.dumps({
        "type": "input_audio_buffer.speech_started",
        "audio_start_ms": 1234,
    })
    result = client.decode_server_event(raw)
    assert result["type"] == "input_audio_buffer.speech_started"
    assert result["barge_in"] is True


def test_decode_speech_stopped_signals_turn_end():
    """input_audio_buffer.speech_stopped → barge_in=False, turn_end=True."""
    client = _build_client()
    raw = json.dumps({
        "type": "input_audio_buffer.speech_stopped",
        "audio_end_ms": 5678,
    })
    result = client.decode_server_event(raw)
    assert result["type"] == "input_audio_buffer.speech_stopped"
    assert result["turn_end"] is True


def test_decode_input_audio_transcription_completed():
    """conversation.item.input_audio_transcription.completed → user transcript 完成."""
    client = _build_client()
    raw = json.dumps({
        "type": "conversation.item.input_audio_transcription.completed",
        "transcript": "今天天气怎么样",
        "item_id": "item_user_1",
    })
    result = client.decode_server_event(raw)
    assert result["type"] == "conversation.item.input_audio_transcription.completed"
    assert result["transcript"] == "今天天气怎么样"


def test_decode_response_done_extracts_usage():
    """response.done: { response: { usage } } → turn done + usage."""
    client = _build_client()
    raw = json.dumps({
        "type": "response.done",
        "response": {
            "id": "resp_1",
            "usage": {"total_tokens": 100, "input_tokens": 30, "output_tokens": 70},
        },
    })
    result = client.decode_server_event(raw)
    assert result["type"] == "response.done"
    assert result["turn_done"] is True
    assert result["usage"]["total_tokens"] == 100


def test_decode_error_event_returns_code_message():
    """error: { code, message } → 字段透传."""
    client = _build_client()
    raw = json.dumps({
        "type": "error",
        "code": "invalid_api_key",
        "message": "Invalid token",
    })
    result = client.decode_server_event(raw)
    assert result["type"] == "error"
    assert result["code"] == "invalid_api_key"
    assert result["message"] == "Invalid token"


def test_decode_unknown_event_returns_type_only():
    """未知事件类型 → 原 type 字段保留, 不抛."""
    client = _build_client()
    raw = json.dumps({"type": "weird.future.event", "payload": {"x": 1}})
    result = client.decode_server_event(raw)
    assert result["type"] == "weird.future.event"
    assert result["raw"] == {"x": 1}


def test_decode_invalid_json_returns_error_event():
    """非 JSON 文本 → error 事件 (不抛)."""
    client = _build_client()
    result = client.decode_server_event("not a json")
    assert result["type"] == "error"
    assert result["code"] == "parse_failed"


# ============================================================================
# WSS endpoint
# ============================================================================
def test_api_realtime_endpoint_exists():
    """POST /api/realtime/health 应返回 200 with configured status."""
    from flask import Flask
    from realtime_voice import register_realtime_routes

    flask_app = Flask(__name__)
    register_realtime_routes(flask_app, client_factory=lambda: _build_client())

    with flask_app.test_client() as tc:
        resp = tc.get("/api/realtime/health")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["configured"] is True
    assert body["model"] == "Doubao_scene_SLM_Doubao_realtime_voice_model"


def test_api_realtime_health_returns_503_when_credentials_missing():
    """凭证缺失时 /api/realtime/health 返回 503 + configured=false, 不抛错."""
    from flask import Flask
    from realtime_voice import register_realtime_routes
    from realtime_voice import RealtimeConfig, RealtimeClient

    flask_app = Flask(__name__)

    def bad_factory():
        return RealtimeClient(RealtimeConfig(app_id="", access_token="", endpoint="wss://x"))

    # 不抛错 (启动期不阻塞)
    register_realtime_routes(flask_app, client_factory=bad_factory)
    with flask_app.test_client() as tc:
        resp = tc.get("/api/realtime/health")
    assert resp.status_code == 503
    body = resp.get_json()
    assert body["configured"] is False
    assert "凭证" in body.get("error", "") or "credential" in body.get("error", "").lower()


# ============================================================================
# OTel span: realtime.user_input / realtime.ai_output
# ============================================================================
def test_otel_span_emitted_around_session_open():
    """session_open 必须开 OTel span 'realtime.session_open'."""
    client = _build_client()
    span_attr = {"name": None, "ended": False}

    class FakeSpan:
        def __init__(self, name):
            span_attr["name"] = name

        def __enter__(self):
            return self

        def __exit__(self, *args):
            span_attr["ended"] = True

        def set_attribute(self, k, v):
            pass

    with patch.object(client, "_tracer") as mock_tracer:
        mock_tracer.start_as_current_span = lambda n: FakeSpan(n)
        try:
            client.open_session()
        except Exception:
            pass  # websocket-client not installed in CI

    assert span_attr["name"] == "realtime.session_open"