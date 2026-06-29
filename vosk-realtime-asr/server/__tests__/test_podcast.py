"""
语音播客大模型 — TDD 红测试
============================

待实现模块:
- server/podcast.py
- /api/podcast/generate  (POST)
- /api/podcast/styles    (GET)
- /api/podcast/task/<id> (GET)

设计依据: docs/2026-06-27-podcast-llm-tech-proposal.md

红测期间: 这些测试应全部 FAIL, 实现 podcast.py 后变绿。
"""
import os
import sys
import json
import time
import pytest
from unittest.mock import patch, MagicMock

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)


# ============================================================================
# Fixture: 给 endpoint 测试用, 手动注册路由 (避免触发 boot_app 启动 Prom server)
# ============================================================================
@pytest.fixture
def podcast_client():
    """一个隔离的 Flask test client + 注册过的 podcast 路由"""
    from flask import Flask
    from podcast import register_podcast_routes

    test_app = Flask(__name__)
    register_podcast_routes(test_app)
    test_app.config["TESTING"] = True
    return test_app.test_client()


# ============================================================================
# 纯函数: parse_script — 主持人 A/B 分流
# ============================================================================
def test_parse_script_host_a_or_b_basic():
    """脚本数组被解析为 HostTurn 列表, role 标准化为 host_a / host_b"""
    from podcast import parse_script
    raw = [
        {"role": "A", "text": "大家好, 欢迎收听。", "audio_url": "https://x/a.mp3", "duration_ms": 2400},
        {"role": "B", "text": "今天我们聊一聊 AI。", "audio_url": "https://x/b.mp3", "duration_ms": 2100},
        {"role": "host_a", "text": "首先回顾上期要点。", "audio_url": "https://x/c.mp3", "duration_ms": 3000},
    ]
    out = parse_script(raw)
    assert len(out) == 3
    assert [t.role for t in out] == ["host_a", "host_b", "host_a"]
    assert out[0].text.startswith("大家好")
    assert out[0].audio_url == "https://x/a.mp3"
    assert out[0].duration_ms == 2400


def test_parse_script_handles_unknown_speaker():
    """未知 role 降级为 host_other, 不抛异常"""
    from podcast import parse_script
    raw = [
        {"role": "guest", "text": "我补充一下。", "audio_url": "u", "duration_ms": 1500},
    ]
    out = parse_script(raw)
    assert out[0].role == "host_other"
    assert out[0].text == "我补充一下。"


def test_parse_script_handles_missing_fields():
    """缺失字段给出默认值 (text='', audio_url='', duration_ms=0)"""
    from podcast import parse_script
    raw = [{"role": "A"}]
    out = parse_script(raw)
    assert out[0].text == ""
    assert out[0].audio_url == ""
    assert out[0].duration_ms == 0


def test_parse_script_empty_input_returns_empty_list():
    """空输入 → 空 list, 不抛异常"""
    from podcast import parse_script
    assert parse_script([]) == []
    assert parse_script(None) == []


# ============================================================================
# 纯函数: validate_request
# ============================================================================
def test_validate_request_empty_transcript_rejected():
    """空 transcript → (False, 'empty_transcript')"""
    from podcast import validate_request
    ok, err = validate_request({"transcript": "", "style": "tech", "duration": "short"})
    assert ok is False
    assert err == "empty_transcript"


def test_validate_request_too_long_rejected():
    """transcript 超 50000 chars → (False, 'transcript_too_long')"""
    from podcast import validate_request
    ok, err = validate_request({"transcript": "x" * 50001, "style": "tech", "duration": "short"})
    assert ok is False
    assert err == "transcript_too_long"


def test_validate_request_invalid_style_rejected():
    """未知 style → (False, 'invalid_option')"""
    from podcast import validate_request
    ok, err = validate_request({"transcript": "hello", "style": "weird_style", "duration": "short"})
    assert ok is False
    assert err == "invalid_option"


def test_validate_request_invalid_duration_rejected():
    """未知 duration → (False, 'invalid_option')"""
    from podcast import validate_request
    ok, err = validate_request({"transcript": "hello", "style": "tech", "duration": "epic"})
    assert ok is False
    assert err == "invalid_option"


def test_validate_request_default_options_accepted():
    """不传 style/duration → 走默认值, 校验通过"""
    from podcast import validate_request
    ok, err = validate_request({"transcript": "hello world"})
    assert ok is True
    assert err is None


# ============================================================================
# 枚举: STYLES / DURATIONS
# ============================================================================
def test_styles_contains_four_styles():
    """必须有 tech / business / entertainment / academic 四种"""
    from podcast import STYLES
    assert "tech" in STYLES
    assert "business" in STYLES
    assert "entertainment" in STYLES
    assert "academic" in STYLES
    assert len(STYLES) == 4
    for sid, s in STYLES.items():
        assert "label" in s
        assert "description" in s


def test_durations_contains_three_lengths():
    """必须有 short / medium / long 三种"""
    from podcast import DURATIONS
    assert "short" in DURATIONS
    assert "medium" in DURATIONS
    assert "long" in DURATIONS
    assert len(DURATIONS) == 3


# ============================================================================
# 编排: generate_podcast — mock HTTPS 调用
# ============================================================================
def test_generate_podcast_calls_api_with_correct_payload(monkeypatch):
    """mock 上游, 验证构造的 HTTPS payload 字段"""
    from podcast import generate_podcast, PodcastConfig

    captured = {}
    def fake_api(payload, config):
        captured["payload"] = payload
        captured["config_resource_id"] = config.resource_id
        return {
            "task_id": "task-001",
            "script": [
                {"role": "A", "text": "hi", "audio_url": "u1", "duration_ms": 1000},
                {"role": "B", "text": "hey", "audio_url": "u2", "duration_ms": 1200},
            ],
            "chapters": [
                {"title": "开场", "start_ms": 0, "end_ms": 1000},
            ],
            "total_duration_ms": 2200,
        }
    monkeypatch.setattr("podcast.call_podcast_api", fake_api)

    cfg = PodcastConfig(
        app_id="app123",
        token="tok456",
        api_key=None,
        resource_id="volc.podcast.llm.duration",
        endpoint="https://openspeech.bytedance.com/api/v3/podcast/generate",
    )
    result = generate_podcast(
        transcript="今天的会议讨论了产品路线图。",
        style="tech",
        duration="short",
        include_audio_clip=False,
        config=cfg,
    )
    assert captured["payload"]["text"] == "今天的会议讨论了产品路线图。"
    assert captured["payload"]["style"] == "tech"
    assert captured["payload"]["duration"] == "short"
    assert captured["payload"]["include_audio_clip"] is False
    assert captured["payload"]["speakers"] == 2
    assert captured["config_resource_id"] == "volc.podcast.llm.duration"
    assert len(result.script) == 2
    assert result.script[0].role == "host_a"
    assert result.total_duration_ms == 2200


def test_generate_podcast_with_old_console_uses_dual_headers(monkeypatch):
    """旧控制台 (api_key=None) → payload 携带 appid + token, 上游层组装双 header"""
    from podcast import generate_podcast, PodcastConfig

    captured = {}
    def fake_api(payload, config):
        captured["payload"] = payload
        captured["config_app_id"] = config.app_id
        captured["config_api_key"] = config.api_key
        return {"task_id": "t", "script": [], "chapters": [], "total_duration_ms": 0}
    monkeypatch.setattr("podcast.call_podcast_api", fake_api)

    cfg = PodcastConfig(
        app_id="my_app",
        token="my_token",
        api_key=None,
        resource_id="volc.podcast.llm.duration",
        endpoint="https://example/api",
    )
    generate_podcast("text", "tech", "short", False, cfg)
    assert captured["config_app_id"] == "my_app"
    assert captured["config_api_key"] is None


def test_generate_podcast_logs_metrics(monkeypatch):
    """生成成功 → Prometheus 计数器 +1, 延迟 histogram 写入"""
    from podcast import generate_podcast, PodcastConfig

    def fake_api(payload, config):
        return {"task_id": "t", "script": [{"role": "A", "text": "x", "audio_url": "u", "duration_ms": 500}], "chapters": [], "total_duration_ms": 500}
    monkeypatch.setattr("podcast.call_podcast_api", fake_api)

    fake_metrics = MagicMock()
    # 模块内通过 `podcast_metrics.generate_total.labels(...).inc()` 调用
    fake_generate_total = MagicMock()
    fake_latency = MagicMock()
    fake_metrics.generate_total = fake_generate_total
    fake_metrics.generate_latency_seconds = fake_latency
    monkeypatch.setattr("podcast.podcast_metrics", fake_metrics)

    cfg = PodcastConfig(app_id="a", token="t", api_key=None, resource_id="r", endpoint="e")
    generate_podcast("text", "tech", "short", False, cfg)
    # generate_total.labels(style="tech", duration="short").inc() 必须被调用
    fake_generate_total.labels.assert_called_with(style="tech", duration="short")
    fake_generate_total.labels.return_value.inc.assert_called()
    fake_latency.observe.assert_called()


# ============================================================================
# 顶层: /api/podcast/styles endpoint
# ============================================================================
def test_styles_endpoint_returns_four(monkeypatch, podcast_client):
    """GET /api/podcast/styles → 200, 返回 4 种风格"""
    res = podcast_client.get("/api/podcast/styles")
    assert res.status_code == 200
    data = res.get_json()
    assert "styles" in data
    assert len(data["styles"]) == 4
    ids = [s["id"] for s in data["styles"]]
    assert "tech" in ids
    assert "business" in ids


# ============================================================================
# 顶层: /api/podcast/generate endpoint
# ============================================================================
def test_generate_endpoint_empty_transcript_returns_400(monkeypatch, podcast_client):
    """空 transcript → 400 empty_transcript"""
    # 防止真实 HTTPS 调用
    monkeypatch.setattr("podcast.call_podcast_api", lambda *a, **kw: {})

    res = podcast_client.post("/api/podcast/generate", json={
        "transcript": "", "style": "tech", "duration": "short"
    })
    assert res.status_code == 400
    assert res.get_json()["error"] == "empty_transcript"


def test_generate_endpoint_credentials_missing_returns_503(monkeypatch):
    """凭证缺失 → 503 podcast_not_configured"""
    from flask import Flask
    from podcast import register_podcast_routes, PodcastConfig

    test_app = Flask(__name__)
    cfg = PodcastConfig(app_id="", token="", api_key=None, resource_id="r", endpoint="e")
    register_podcast_routes(test_app, cfg)
    test_app.config["TESTING"] = True
    client = test_app.test_client()

    res = client.post("/api/podcast/generate", json={
        "transcript": "hello", "style": "tech", "duration": "short"
    })
    assert res.status_code == 503
    assert res.get_json()["error"] == "podcast_not_configured"


def test_generate_endpoint_short_returns_sync_200(monkeypatch):
    """duration=short → 同步 200 + script + chapters + total_duration_ms"""
    from flask import Flask
    from podcast import register_podcast_routes, PodcastConfig, PodcastResult

    test_app = Flask(__name__)
    cfg = PodcastConfig(app_id="app", token="tok", api_key="key", resource_id="r", endpoint="e")
    register_podcast_routes(test_app, cfg)
    test_app.config["TESTING"] = True
    client = test_app.test_client()

    def fake_generate(transcript, style, duration, include_audio_clip, config):
        return PodcastResult(
            task_id="sync-001",
            script=[],
            chapters=[],
            total_duration_ms=3000,
        )
    monkeypatch.setattr("podcast.generate_podcast", fake_generate)

    res = client.post("/api/podcast/generate", json={
        "transcript": "hello world", "style": "tech", "duration": "short"
    })
    assert res.status_code == 200
    data = res.get_json()
    assert data["task_id"] == "sync-001"
    assert data["total_duration_ms"] == 3000


def test_generate_endpoint_long_returns_async_202(monkeypatch):
    """duration=long → 202 Accepted + task_id, 客户端需轮询"""
    from flask import Flask
    from podcast import register_podcast_routes, PodcastConfig, PodcastResult

    test_app = Flask(__name__)
    cfg = PodcastConfig(app_id="app", token="tok", api_key="key", resource_id="r", endpoint="e")
    register_podcast_routes(test_app, cfg)
    test_app.config["TESTING"] = True
    client = test_app.test_client()

    def fake_generate(transcript, style, duration, include_audio_clip, config):
        return PodcastResult(
            task_id="async-007",
            script=[],
            chapters=[],
            total_duration_ms=0,
            is_async=True,
        )
    monkeypatch.setattr("podcast.generate_podcast", fake_generate)

    res = client.post("/api/podcast/generate", json={
        "transcript": "long meeting...", "style": "tech", "duration": "long"
    })
    assert res.status_code == 202
    data = res.get_json()
    assert data["task_id"] == "async-007"
    assert data["status"] == "pending"


def test_generate_endpoint_upstream_error_returns_502(monkeypatch):
    """上游 5xx → 502 upstream_error"""
    from flask import Flask
    from podcast import register_podcast_routes, PodcastConfig, PodcastUpstreamError

    test_app = Flask(__name__)
    cfg = PodcastConfig(app_id="app", token="tok", api_key="key", resource_id="r", endpoint="e")
    register_podcast_routes(test_app, cfg)
    test_app.config["TESTING"] = True
    client = test_app.test_client()

    def fake_generate(transcript, style, duration, include_audio_clip, config):
        raise PodcastUpstreamError("upstream 503")
    monkeypatch.setattr("podcast.generate_podcast", fake_generate)

    res = client.post("/api/podcast/generate", json={
        "transcript": "x", "style": "tech", "duration": "short"
    })
    assert res.status_code == 502
    assert res.get_json()["error"] == "upstream_error"


# ============================================================================
# /api/podcast/task/<id> 轮询
# ============================================================================
def test_task_endpoint_returns_progress(monkeypatch):
    """轮询 endpoint 返回 progress + status"""
    from flask import Flask
    from podcast import register_podcast_routes, PodcastConfig

    test_app = Flask(__name__)
    cfg = PodcastConfig(app_id="app", token="tok", api_key="key", resource_id="r", endpoint="e")
    register_podcast_routes(test_app, cfg)
    test_app.config["TESTING"] = True
    client = test_app.test_client()

    monkeypatch.setattr(
        "podcast.poll_podcast_task",
        lambda task_id, config: {"status": "running", "progress": 0.42},
    )

    res = client.get("/api/podcast/task/abc")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "running"
    assert data["progress"] == 0.42


def test_task_endpoint_unknown_returns_404(monkeypatch):
    """未知 task_id → 404"""
    from flask import Flask
    from podcast import register_podcast_routes, PodcastConfig, PodcastTaskNotFound

    test_app = Flask(__name__)
    cfg = PodcastConfig(app_id="app", token="tok", api_key="key", resource_id="r", endpoint="e")
    register_podcast_routes(test_app, cfg)
    test_app.config["TESTING"] = True
    client = test_app.test_client()

    def fake_poll(task_id, config):
        raise PodcastTaskNotFound(task_id)
    monkeypatch.setattr("podcast.poll_podcast_task", fake_poll)

    res = client.get("/api/podcast/task/nonexistent")
    assert res.status_code == 404