"""
火山引擎会话 (VolcengineSession) — 单测
Mock websocket-client 的 create_connection, 验证:
- 握手 header 含 X-Api-Access-Key / Authorization Bearer;
- full request payload 含 show_speaker_info=True
- audio-only 帧不带 JSON
- LAST 帧带 0x22 flags
- 读循环正确解析 0xC / 0xF / 0xB
"""
import json
import threading
import time
import queue
from unittest import mock

import pytest

import volcengine_session as vs_mod
from volcengine_session import VolcengineSession


# ============================================================================
# Fake WSS — 注入到 volcengine_session.websocket
# ============================================================================
class FakeWS:
    """模拟 websocket-client.create_connection 的返回对象"""
    def __init__(self, recv_queue=None, sent_frames=None, fail_on_send=False):
        self.sent_frames = sent_frames if sent_frames is not None else []
        self.recv_queue = recv_queue if recv_queue is not None else queue.Queue()
        self.connected = True
        self.fail_on_send = fail_on_send
        self.send_count = 0
        self.closed = False

    def send_binary(self, frame: bytes):
        if self.fail_on_send:
            raise RuntimeError("send failed")
        self.sent_frames.append(frame)
        self.send_count += 1

    def recv(self):
        if self.closed:
            raise Exception("WS closed")
        try:
            return self.recv_queue.get(timeout=0.5)
        except queue.Empty:
            raise Exception("WS recv timeout")

    def close(self):
        self.connected = False
        self.closed = True

    def settimeout(self, t):
        pass


@pytest.fixture
def fake_ws_factory():
    """返回 factory(url, **kw) -> FakeWS"""
    fake = {"ws": None}

    def factory(*args, **kwargs):
        fake["ws"] = FakeWS()
        fake["ws"].url = args[0] if args else kwargs.get("url", "")
        fake["ws"].headers = kwargs.get("header", [])
        return fake["ws"]

    return factory, fake


# ============================================================================
# 配置 fixture
# ============================================================================
@pytest.fixture
def volc_config():
    return {
        "app_key": "be7a469d-3937-40ff-882a-7d72398c44c6",
        "access_token": "be7a469d-3937-40ff-882a-7d72398c44c6",
        "resource_id": "bigmodel",
        "model_name": "bigmodel",
        "endpoint": "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
    }


# ============================================================================
# 握手
# ============================================================================
class TestHandshake:
    def test_open_uses_wss_endpoint(self, volc_config, fake_ws_factory, monkeypatch):
        factory, fake = fake_ws_factory
        monkeypatch.setattr(vs_mod, "create_connection", factory)

        callbacks = {"partial": [], "final": [], "error": []}
        sess = VolcengineSession(
            sid="test-001",
            config=volc_config,
            on_partial=lambda t, sid=None: callbacks["partial"].append((t, sid)),
            on_final=lambda t, u, s, lat=None: callbacks["final"].append((t, u, s, lat)),
            on_error=lambda c, m, sid=None: callbacks["error"].append((c, m)),
        )
        sess.start()
        time.sleep(0.2)

        assert fake["ws"] is not None
        # v3 endpoint 默认 v3/sauc/bigmodel_async
        assert "wss://openspeech.bytedance.com/" in fake["ws"].url
        assert "/api/v3/sauc/" in fake["ws"].url
        sess.close()

    def test_open_sends_full_request_with_speaker(self, volc_config, fake_ws_factory, monkeypatch):
        """v3 风格: payload 顶层只有 user/audio/request, 不含 v2 的 namespace/parameters/input"""
        import gzip
        factory, fake = fake_ws_factory
        monkeypatch.setattr(vs_mod, "create_connection", factory)

        sess = VolcengineSession(
            sid="test-002",
            config=volc_config,
            on_partial=lambda *a, **kw: None,
            on_final=lambda *a, **kw: None,
            on_error=lambda *a, **kw: None,
        )
        sess.start()
        # 等握手完成 (后台线程创建 fake ws 并发首帧)
        deadline = time.time() + 2
        while time.time() < deadline and fake["ws"] is None:
            time.sleep(0.02)
        sess.close()

        assert fake["ws"] is not None
        # 第一帧是 full request (v3: 4B header + 4B size + gzip body)
        assert len(fake["ws"].sent_frames) >= 1
        first = fake["ws"].sent_frames[0]
        assert first[0] == 0x11  # PROTOCOL_VERSION
        # v3: byte1 = msg_type<<4 | flags
        assert (first[1] >> 4) == 0x1  # MSG_TYPE_FULL_REQUEST
        # byte2 低 4 位 = gzip 压缩
        assert (first[2] & 0x0F) == 0x1
        # body 从 offset 8 开始, 是 gzip(JSON)
        body = json.loads(gzip.decompress(first[8:]).decode("utf-8"))
        assert body["request"]["show_utterances"] is True
        assert body["request"]["model_name"] == "bigmodel"
        # v3 字段 (不再是 v2 的 namespace/input/parameters)
        assert "namespace" not in body
        assert "parameters" not in body
        assert "input" not in body
        assert body["audio"]["format"] == "pcm"
        assert body["audio"]["rate"] == 16000

    def test_handshake_headers_use_v3_x_api_format(self, volc_config, fake_ws_factory, monkeypatch):
        """v3 协议用 X-Api-* header, **没有** Authorization Bearer;"""
        factory, fake = fake_ws_factory
        monkeypatch.setattr(vs_mod, "create_connection", factory)

        sess = VolcengineSession(
            sid="test-003",
            config=volc_config,
            on_partial=lambda *a, **kw: None,
            on_final=lambda *a, **kw: None,
            on_error=lambda *a, **kw: None,
        )
        sess.start()
        deadline = time.time() + 2
        while time.time() < deadline and fake["ws"] is None:
            time.sleep(0.02)
        sess.close()

        hdrs = dict(h.split(": ", 1) for h in fake["ws"].headers)
        # v1/sauc 协议: 必须同时有 Authorization Bearer; 头 (带分号) + X-Api-* 系列
        assert hdrs.get("Authorization") == f"Bearer; {volc_config['access_token']}"
        assert hdrs["X-Api-Resource-Id"] == "bigmodel"
        assert hdrs["X-Api-App-Key"] == volc_config["app_key"]
        assert hdrs["X-Api-Access-Key"] == volc_config["access_token"]
        assert "X-Api-Request-Id" in hdrs
        assert "X-Api-Connect-Id" in hdrs
        assert hdrs.get("X-Api-Sequence") == "-1"


# ============================================================================
# send_audio / finalize
# ============================================================================
class TestSendAudio:
    def test_send_audio_uses_audio_only_frame_gzipped(self, volc_config, fake_ws_factory, monkeypatch):
        """audio-only 帧: 4B header + 4B size + gzip(PCM), body 解压后等于原 PCM"""
        import gzip
        factory, fake = fake_ws_factory
        monkeypatch.setattr(vs_mod, "create_connection", factory)

        sess = VolcengineSession(
            sid="test-004",
            config=volc_config,
            on_partial=lambda *a, **kw: None,
            on_final=lambda *a, **kw: None,
            on_error=lambda *a, **kw: None,
        )
        sess.start()
        deadline = time.time() + 2
        while time.time() < deadline and fake["ws"] is None:
            time.sleep(0.02)

        original = b"\xaa\xbb" * 200  # 400 bytes
        sess.send_audio(original)
        time.sleep(0.05)
        sess.close()

        frames = fake["ws"].sent_frames
        assert len(frames) >= 2
        audio_frame = frames[1]
        # byte1 高 4 位 = MSG_TYPE_AUDIO_ONLY (0x2)
        assert (audio_frame[1] >> 4) == 0x2
        # byte2 低 4 位 = gzip (0x1)
        assert (audio_frame[2] & 0x0F) == 0x1
        # body = gzip(PCM), 解压后等于原 PCM
        body = gzip.decompress(audio_frame[8:])
        assert body == original

    def test_finalize_sends_last_frame(self, volc_config, fake_ws_factory, monkeypatch):
        factory, fake = fake_ws_factory
        monkeypatch.setattr(vs_mod, "create_connection", factory)

        sess = VolcengineSession(
            sid="test-005",
            config=volc_config,
            on_partial=lambda *a, **kw: None,
            on_final=lambda *a, **kw: None,
            on_error=lambda *a, **kw: None,
        )
        sess.start()
        deadline = time.time() + 2
        while time.time() < deadline and fake["ws"] is None:
            time.sleep(0.02)
        sess.finalize(b"\x00" * 100)
        time.sleep(0.05)
        sess.close()

        frames = fake["ws"].sent_frames
        last = frames[-1]
        # LAST = 0x2, 在 byte1 低 4 位 (v3 是 byte1 不是 byte2)
        assert (last[1] & 0x0F) == 0x2


# ============================================================================
# 读循环 (用 fake ws.recv_queue 喂数据)
# ============================================================================
class TestReadLoop:
    def _make_response_frame(self, msg_type: int, body: dict, code: int = 0) -> bytes:
        """手工构造服务端响应帧 (v3 风格: header(4) + [seq(4) if flag bit0] + size(4) + body)
        """
        import gzip as _gzip, struct as _struct
        body_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")
        body_bytes = _gzip.compress(body_bytes)
        size = len(body_bytes)
        size_bytes = _struct.pack(">I", size)
        # byte2: serialization=JSON(0x1) <<4 | compression=gzip(0x1) = 0x11
        header = bytes([0x11, (msg_type << 4), 0x11, 0x00])
        return header + size_bytes + body_bytes

    def test_partial_response_invokes_on_partial(self, volc_config, fake_ws_factory, monkeypatch):
        factory, fake = fake_ws_factory
        monkeypatch.setattr(vs_mod, "create_connection", factory)

        captured = []
        sess = VolcengineSession(
            sid="test-partial",
            config=volc_config,
            on_partial=lambda t, sid=None: captured.append(("partial", t, sid)),
            on_final=lambda *a: captured.append(("final",)),
            on_error=lambda *a: captured.append(("error",)),
        )
        sess.start()
        # 等握手完成, 然后往 recv_queue 喂数据
        deadline = time.time() + 2
        while time.time() < deadline and fake["ws"] is None:
            time.sleep(0.02)
        assert fake["ws"] is not None, "session 握手超时"
        partial = self._make_response_frame(0xC, {"result": {"text": "你好"}})
        fake["ws"].recv_queue.put(partial)

        # 让读循环有时间消费
        deadline = time.time() + 2
        while time.time() < deadline and not any(c[0] == "partial" for c in captured):
            time.sleep(0.05)
        sess.close()

        assert any(c[0] == "partial" and "你好" in c[1] for c in captured), \
            f"expected partial callback with '你好', got {captured}"

    def test_final_response_invokes_on_final_with_utterances(self, volc_config, fake_ws_factory, monkeypatch):
        factory, fake = fake_ws_factory
        monkeypatch.setattr(vs_mod, "create_connection", factory)

        captured = []
        sess = VolcengineSession(
            sid="test-final",
            config=volc_config,
            on_partial=lambda *a, **kw: None,
            on_final=lambda *a, **kw: captured.append({
                "text": a[0] if a else "",
                "utterances": a[1] if len(a) > 1 else [],
                "speakers": a[2] if len(a) > 2 else [],
            }),
            on_error=lambda *a, **kw: None,
        )
        sess.start()
        deadline = time.time() + 2
        while time.time() < deadline and fake["ws"] is None:
            time.sleep(0.02)
        assert fake["ws"] is not None
        final_body = {
            "result": {
                "text": "你好世界。我是字节。",
                "utterances": [
                    {"text": "你好世界。", "start_time": 0, "end_time": 1500,
                     "additions": {"speaker_id": "spk0"}, "words": [
                         {"text": "你好", "start_time": 0, "end_time": 500},
                     ]},
                    {"text": "我是字节。", "start_time": 1500, "end_time": 3000,
                     "additions": {"speaker_id": "spk1"}, "words": []},
                ],
            },
            "audio_info": {"duration": 3000},
        }
        final = self._make_response_frame(0xF, final_body)
        fake["ws"].recv_queue.put(final)

        deadline = time.time() + 2
        while time.time() < deadline and not captured:
            time.sleep(0.05)
        sess.close()

        assert len(captured) >= 1
        cap = captured[0]
        assert "你好世界" in cap["text"]
        assert len(cap["utterances"]) == 2
        assert cap["utterances"][0]["speaker_id"] == "spk0"
        assert cap["utterances"][1]["speaker_id"] == "spk1"
        # speakers 应该是按出现顺序分配的 [{id, label}]
        assert len(cap["speakers"]) == 2
        assert cap["speakers"][0]["id"] == "spk0"
        assert cap["speakers"][1]["id"] == "spk1"

    def test_error_response_invokes_on_error(self, volc_config, fake_ws_factory, monkeypatch):
        factory, fake = fake_ws_factory
        monkeypatch.setattr(vs_mod, "create_connection", factory)

        captured = []
        sess = VolcengineSession(
            sid="test-err",
            config=volc_config,
            on_partial=lambda *a, **kw: None,
            on_final=lambda *a, **kw: None,
            on_error=lambda c, m, sid=None: captured.append((c, m)),
        )
        sess.start()
        deadline = time.time() + 2
        while time.time() < deadline and fake["ws"] is None:
            time.sleep(0.02)
        assert fake["ws"] is not None
        err = self._make_response_frame(0xB, {"code": 10001, "message": "invalid token"})
        fake["ws"].recv_queue.put(err)

        deadline = time.time() + 2
        while time.time() < deadline and not captured:
            time.sleep(0.05)
        sess.close()

        assert len(captured) >= 1
        code, msg = captured[0]
        assert code == 10001
        assert "token" in msg


# ============================================================================
# 清理
# ============================================================================
class TestCleanup:
    def test_close_releases_thread_and_ws(self, volc_config, fake_ws_factory, monkeypatch):
        factory, fake = fake_ws_factory
        monkeypatch.setattr(vs_mod, "create_connection", factory)

        sess = VolcengineSession(
            sid="test-clean",
            config=volc_config,
            on_partial=lambda *a, **kw: None,
            on_final=lambda *a, **kw: None,
            on_error=lambda *a, **kw: None,
        )
        sess.start()
        time.sleep(0.1)
        sess.close()
        time.sleep(0.2)
        # 线程应已退出
        assert sess._reader_thread is None or not sess._reader_thread.is_alive()
        assert fake["ws"].closed is True
