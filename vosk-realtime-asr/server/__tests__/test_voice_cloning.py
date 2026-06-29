"""
声音复刻 2.0 — 服务端单元测试 (TDD red → green)

覆盖:
- VoiceCloningClient 鉴权头生成 (X-Api-Key + X-Api-App-Key + X-Api-Access-Key)
- 上传音频 (multipart/form-data, 16kHz mono PCM 验证)
- 触发训练 (异步, 返回 task_id + voice_id)
- 查询训练状态 (轮询, success / training / failed 三态)
- 列出用户音色
- 删除音色
- 错误传播: 401 / 403 / 5xx / 超时
- 鉴权缺失时显式抛出 ConfigError (不静默用空 token 调线上)
- Prom 指标: voice_upload_total / voice_train_total / voice_train_duration_seconds

火山引擎 声音复刻 2.0:
  - 训练数据: 单声道 16kHz+ PCM, 建议 10s ~ 5min
  - 训练时长: 几秒 ~ 几分钟 (异步)
  - 鉴权: X-Api-Key (新) 或 X-Api-App-Key + X-Api-Access-Key (旧)

模型: MiniMax-M3
"""
import io
import json
import os
import sys
import time
from unittest.mock import MagicMock, patch

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)


def _make_pcm(duration_seconds: float = 1.0, sample_rate: int = 16000) -> bytes:
    """生成静音 PCM (16-bit mono), 用于上传测试."""
    num_samples = int(duration_seconds * sample_rate)
    return b"\x00\x00" * num_samples


def _build_client(app_id: str = "test-app-id", token: str = "test-token", api_key: str = ""):
    """构造 client (延迟导入, 让单测失败先于 ImportError 报告)."""
    from voice_cloning import VoiceCloningClient, VoiceCloningConfig
    cfg = VoiceCloningConfig(
        app_id=app_id,
        access_token=token,
        api_key=api_key,
        endpoint="https://example.com/api/voice_cloning",
    )
    return VoiceCloningClient(cfg)


# ============================================================================
# 鉴权头
# ============================================================================
def test_build_auth_headers_uses_api_key_when_provided():
    """新控制台: 单一 X-Api-Key header."""
    client = _build_client(api_key="secret-key-abc")
    headers = client._build_auth_headers()
    assert headers.get("X-Api-Key") == "secret-key-abc", "新控制台必须用 X-Api-Key"
    assert "Authorization" in headers, "Authorization 必须始终注入 (兼容老网关)"
    assert "Bearer" in headers["Authorization"]


def test_build_auth_headers_uses_app_id_and_token_when_no_api_key():
    """旧控制台: X-Api-App-Key + X-Api-Access-Key 双 header."""
    client = _build_client(app_id="old-app", token="old-token", api_key="")
    headers = client._build_auth_headers()
    assert headers.get("X-Api-App-Key") == "old-app"
    assert headers.get("X-Api-Access-Key") == "old-token"
    assert "X-Api-Key" not in headers, "旧控制台不能注入 X-Api-Key"


def test_build_auth_headers_includes_resource_id():
    """声音复刻 2.0 必须带 resource_id header."""
    client = _build_client()
    client.config.resource_id = "volc.voice_cloning.2_0"
    headers = client._build_auth_headers()
    assert headers.get("X-Api-Resource-Id") == "volc.voice_cloning.2_0"


# ============================================================================
# 凭证缺失 → ConfigError
# ============================================================================
def test_config_error_when_no_credentials():
    """app_id + access_token + api_key 都没有时, 构造 client 抛 ConfigError."""
    from voice_cloning import VoiceCloningConfig, VoiceCloningClient
    with __import__("pytest").raises(Exception) as exc_info:
        VoiceCloningClient(VoiceCloningConfig(app_id="", access_token="", api_key="", endpoint="x"))
    # 必须显式报错 (不能静默继续, 否则线上调一次 401 才发现)
    assert "凭证" in str(exc_info.value) or "credential" in str(exc_info.value).lower()


# ============================================================================
# 上传音频
# ============================================================================
def test_upload_audio_sends_multipart_form_data():
    """上传时构造 multipart/form-data, 字段名 audio (二进制 PCM)."""
    client = _build_client()
    pcm = _make_pcm(duration_seconds=2.0)

    captured = {}

    def fake_post(url, *, data=None, files=None, headers=None, timeout=None):
        captured["url"] = url
        captured["data"] = data
        captured["files"] = files
        captured["headers"] = headers
        # 模拟服务端返回 200
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {"audio_id": "audio_abc123", "duration": 2.0, "sample_rate": 16000},
        }
        return resp

    with patch.object(client, "_http_post", side_effect=fake_post):
        result = client.upload_audio(pcm, sample_rate=16000, speaker_id="user-001")

    assert captured["files"] is not None, "必须以 files= 方式上传 (multipart/form-data)"
    assert "audio" in captured["files"], "字段名必须叫 audio"
    audio_field = captured["files"]["audio"]
    # (filename, bytes, mime)
    assert len(audio_field) >= 2
    assert isinstance(audio_field[1], (bytes, io.BytesIO)), "音频内容必须是 bytes-like"
    assert result["audio_id"] == "audio_abc123"
    assert result["duration"] == 2.0


def test_upload_audio_rejects_non_pcm_data():
    """上传空 / 非 PCM 数据时, 客户端先校验 (early reject)."""
    client = _build_client()
    raised = False
    try:
        client.upload_audio(b"", sample_rate=16000, speaker_id="user-001")
    except ValueError as e:
        raised = True
        assert "empty" in str(e).lower() or "音频" in str(e)
    assert raised, "空 PCM 必须立即拒绝, 不浪费一次线上请求"


def test_upload_audio_validates_sample_rate():
    """声音复刻 2.0 要求采样率 ≥ 16000."""
    client = _build_client()
    raised = False
    try:
        client.upload_audio(_make_pcm(), sample_rate=8000, speaker_id="user-001")
    except ValueError as e:
        raised = True
        assert "16000" in str(e) or "采样率" in str(e)
    assert raised, "采样率 < 16000 必须拒绝"


# ============================================================================
# 触发训练
# ============================================================================
def test_train_returns_voice_id_and_task_id():
    """train 返回 { task_id, voice_id, status: 'training' }."""
    client = _build_client()

    def fake_post(url, *, json=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {
                "task_id": "task_xyz",
                "voice_id": "S_f5W7pQJX1",
                "status": "training",
            },
        }
        return resp

    with patch.object(client, "_http_post", side_effect=fake_post):
        result = client.train(audio_id="audio_abc123", speaker_id="user-001", voice_name="我的声音")

    assert result["voice_id"] == "S_f5W7pQJX1"
    assert result["task_id"] == "task_xyz"
    assert result["status"] == "training"


def test_train_passes_speaker_and_voice_name():
    """train 必须把 speaker_id / voice_name 透传给服务端 (音色归属)."""
    client = _build_client()
    captured = {}

    def fake_post(url, *, json=None, headers=None, timeout=None):
        captured["json"] = json
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {"task_id": "t1", "voice_id": "S_1", "status": "training"},
        }
        return resp

    with patch.object(client, "_http_post", side_effect=fake_post):
        client.train(audio_id="a1", speaker_id="user-007", voice_name="小明的声音")

    body = captured["json"]
    assert body.get("speaker_id") == "user-007", "speaker_id 必须透传"
    assert body.get("voice_name") == "小明的声音", "voice_name 必须透传"
    assert body.get("audio_id") == "a1"


# ============================================================================
# 训练状态轮询
# ============================================================================
def test_get_train_status_returns_success_when_done():
    """task 成功 → status='success', voice_id 已绑定."""
    client = _build_client()

    def fake_get(url, *, params=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {"task_id": "t1", "status": "success", "voice_id": "S_done_1"},
        }
        return resp

    with patch.object(client, "_http_get", side_effect=fake_get):
        result = client.get_train_status(task_id="t1")
    assert result["status"] == "success"
    assert result["voice_id"] == "S_done_1"


def test_get_train_status_returns_training_when_in_progress():
    """训练中 → status='training', voice_id 可能为空."""
    client = _build_client()

    def fake_get(url, *, params=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {"task_id": "t1", "status": "training", "voice_id": None},
        }
        return resp

    with patch.object(client, "_http_get", side_effect=fake_get):
        result = client.get_train_status(task_id="t1")
    assert result["status"] == "training"


def test_get_train_status_returns_failed_with_error():
    """训练失败 → status='failed' + error_message."""
    client = _build_client()

    def fake_get(url, *, params=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {
                "task_id": "t1",
                "status": "failed",
                "error": {"code": 4001, "message": "audio too short"},
            },
        }
        return resp

    with patch.object(client, "_http_get", side_effect=fake_get):
        result = client.get_train_status(task_id="t1")
    assert result["status"] == "failed"
    assert "error" in result


# ============================================================================
# 列出音色
# ============================================================================
def test_list_voices_returns_user_scoped_voices():
    """list 只返回当前 speaker_id 下的音色."""
    client = _build_client()
    captured = {}

    def fake_get(url, *, params=None, headers=None, timeout=None):
        captured["params"] = params
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {
                "voices": [
                    {"voice_id": "S_a", "name": "声音A", "status": "ready", "created_at": 1700000000},
                    {"voice_id": "S_b", "name": "声音B", "status": "training", "created_at": 1700000100},
                ],
            },
        }
        return resp

    with patch.object(client, "_http_get", side_effect=fake_get):
        result = client.list_voices(speaker_id="user-001")

    assert captured["params"].get("speaker_id") == "user-001"
    assert len(result) == 2
    assert result[0]["voice_id"] == "S_a"
    assert result[1]["status"] == "training"


# ============================================================================
# 删除音色
# ============================================================================
def test_delete_voice_returns_success():
    """delete → 200 + code=0."""
    client = _build_client()
    called = {"yes": False}

    def fake_delete(url, *, params=None, headers=None, timeout=None):
        called["yes"] = True
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"code": 0, "message": "ok"}
        return resp

    with patch.object(client, "_http_delete", side_effect=fake_delete):
        result = client.delete_voice(voice_id="S_to_delete")
    assert called["yes"] is True
    assert result["code"] == 0


# ============================================================================
# 错误传播
# ============================================================================
def test_http_error_raises_with_status_code_and_body():
    """非 2xx 响应 → 抛 VoiceCloningHttpError, 含 status_code + body."""
    from voice_cloning import VoiceCloningHttpError
    client = _build_client()

    def fake_post(url, *, json=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 401
        resp.json.return_value = {"code": 1001, "message": "invalid token"}
        return resp

    with patch.object(client, "_http_post", side_effect=fake_post):
        raised = False
        try:
            client.train(audio_id="a1", speaker_id="u1", voice_name="x")
        except VoiceCloningHttpError as e:
            raised = True
            assert e.status_code == 401
            assert "invalid token" in str(e) or "1001" in str(e)
    assert raised, "401 必须抛 VoiceCloningHttpError"


def test_http_error_on_5xx_includes_status_code():
    """5xx 错误包含 status_code, 客户端据此决定是否重试."""
    from voice_cloning import VoiceCloningHttpError
    client = _build_client()

    def fake_get(url, *, params=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 503
        resp.json.return_value = {"code": -1, "message": "server unavailable"}
        return resp

    with patch.object(client, "_http_get", side_effect=fake_get):
        raised = False
        try:
            client.get_train_status(task_id="t1")
        except VoiceCloningHttpError as e:
            raised = True
            assert e.status_code == 503
    assert raised


# ============================================================================
# Prom 指标: 训练次数 / 成功率 / 时长
# ============================================================================
def test_metrics_record_train_attempt_and_outcome():
    """MetricsCollector 必须有 voice_train_total / voice_train_duration_seconds."""
    from metrics import MetricsCollector
    m = MetricsCollector()
    # 验证这些指标属性存在
    assert hasattr(m, "voice_train_total"), "必须定义 voice_train_total (labels=outcome)"
    assert hasattr(m, "voice_train_duration_seconds"), "必须定义 voice_train_duration_seconds"
    assert hasattr(m, "voice_upload_total"), "必须定义 voice_upload_total"


# ============================================================================
# Flask endpoint: /api/voice/upload
# ============================================================================
def test_api_voice_upload_endpoint_returns_200_and_audio_id():
    """POST /api/voice/upload: multipart audio → 200 { audio_id, duration }."""
    from flask import Flask
    from voice_cloning import register_voice_cloning_routes

    flask_app = Flask(__name__)
    client = _build_client()

    def fake_post(url, *, data=None, files=None, json=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {"audio_id": "audio_abc123", "duration": 2.0, "sample_rate": 16000},
        }
        return resp

    with patch.object(client, "_http_post", side_effect=fake_post):
        register_voice_cloning_routes(flask_app, client_factory=lambda: client)
        with flask_app.test_client() as tc:
            data = {
                "audio": (io.BytesIO(_make_pcm(2.0)), "voice.wav", "audio/wav"),
                "speaker_id": "user-001",
                "sample_rate": "16000",
            }
            resp = tc.post("/api/voice/upload", data=data, content_type="multipart/form-data")
    assert resp.status_code == 200
    body = resp.get_json()
    assert "audio_id" in body
    assert body["audio_id"] == "audio_abc123"


def test_api_voice_upload_returns_400_when_no_audio():
    """缺少 audio 字段 → 400."""
    from flask import Flask
    from voice_cloning import register_voice_cloning_routes

    flask_app = Flask(__name__)
    register_voice_cloning_routes(flask_app, client_factory=lambda: _build_client())

    with flask_app.test_client() as tc:
        resp = tc.post("/api/voice/upload", data={"speaker_id": "u1"}, content_type="multipart/form-data")
    assert resp.status_code == 400


def test_api_voice_train_endpoint_triggers_training():
    """POST /api/voice/train: JSON { audio_id, voice_name, speaker_id } → { voice_id, task_id, status }."""
    from flask import Flask
    from voice_cloning import register_voice_cloning_routes

    flask_app = Flask(__name__)
    client = _build_client()

    def fake_post(url, *, data=None, files=None, json=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {"task_id": "task_xyz", "voice_id": "S_f5W7pQJX1", "status": "training"},
        }
        return resp

    with patch.object(client, "_http_post", side_effect=fake_post):
        register_voice_cloning_routes(flask_app, client_factory=lambda: client)
        with flask_app.test_client() as tc:
            resp = tc.post(
                "/api/voice/train",
                json={"audio_id": "audio_abc123", "voice_name": "我的声音", "speaker_id": "user-001"},
            )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["voice_id"] == "S_f5W7pQJX1"
    assert body["task_id"] == "task_xyz"
    assert body["status"] == "training"


def test_api_voice_train_status_returns_state():
    """GET /api/voice/train/status?task_id=xxx → { status, voice_id }."""
    from flask import Flask
    from voice_cloning import register_voice_cloning_routes

    flask_app = Flask(__name__)
    client = _build_client()

    def fake_get(url, *, params=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {"task_id": "t1", "status": "success", "voice_id": "S_done_1"},
        }
        return resp

    with patch.object(client, "_http_get", side_effect=fake_get):
        register_voice_cloning_routes(flask_app, client_factory=lambda: client)
        with flask_app.test_client() as tc:
            resp = tc.get("/api/voice/train/status?task_id=t1")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "success"
    assert body["voice_id"] == "S_done_1"


def test_api_voice_list_endpoint_returns_voices():
    """GET /api/voice/list?speaker_id=xxx → { voices: [...] }."""
    from flask import Flask
    from voice_cloning import register_voice_cloning_routes

    flask_app = Flask(__name__)
    client = _build_client()

    def fake_get(url, *, params=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {
                "voices": [
                    {"voice_id": "S_a", "name": "声音A", "status": "ready", "created_at": 1700000000},
                    {"voice_id": "S_b", "name": "声音B", "status": "training", "created_at": 1700000100},
                ],
            },
        }
        return resp

    with patch.object(client, "_http_get", side_effect=fake_get):
        register_voice_cloning_routes(flask_app, client_factory=lambda: client)
        with flask_app.test_client() as tc:
            resp = tc.get("/api/voice/list?speaker_id=user-001")
    assert resp.status_code == 200
    body = resp.get_json()
    assert "voices" in body
    assert len(body["voices"]) == 2


def test_api_voice_delete_endpoint_returns_ok():
    """DELETE /api/voice/delete?voice_id=xxx → { code: 0 }."""
    from flask import Flask
    from voice_cloning import register_voice_cloning_routes

    flask_app = Flask(__name__)
    client = _build_client()

    def fake_delete(url, *, params=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"code": 0, "message": "ok"}
        return resp

    with patch.object(client, "_http_delete", side_effect=fake_delete):
        register_voice_cloning_routes(flask_app, client_factory=lambda: client)
        with flask_app.test_client() as tc:
            resp = tc.delete("/api/voice/delete?voice_id=S_a")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["code"] == 0


# ============================================================================
# 鉴权缺失时 endpoint 不暴露 (启动期 fail-fast)
# ============================================================================
def test_register_routes_raises_when_credentials_missing():
    """生产启动时若凭证缺失 → 显式报错 (避免线上请求 401)."""
    from voice_cloning import register_voice_cloning_routes
    from flask import Flask

    flask_app = Flask(__name__)

    def bad_factory():
        from voice_cloning import VoiceCloningClient, VoiceCloningConfig
        return VoiceCloningClient(
            VoiceCloningConfig(app_id="", access_token="", api_key="", endpoint="x")
        )

    raised = False
    try:
        register_voice_cloning_routes(flask_app, client_factory=bad_factory)
    except Exception as e:
        raised = True
        assert "凭证" in str(e) or "credential" in str(e).lower()
    assert raised, "凭证缺失必须 fail-fast"


# ============================================================================
# OTel span: voice.upload / voice.train
# ============================================================================
def test_otel_span_emitted_around_train():
    """train 调用必须开 OTel span 'voice.train' (成功路径)."""
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

    def fake_post(url, *, json=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "code": 0,
            "data": {"task_id": "t1", "voice_id": "S_1", "status": "training"},
        }
        return resp

    with patch.object(client, "_http_post", side_effect=fake_post):
        with patch.object(client, "_tracer") as mock_tracer:
            mock_tracer.start_as_current_span = lambda n: FakeSpan(n)
            client.train(audio_id="a1", speaker_id="u1", voice_name="x")

    assert span_attr["name"] == "voice.train"
    assert span_attr["ended"] is True, "span 必须 end (context manager 退出)"
