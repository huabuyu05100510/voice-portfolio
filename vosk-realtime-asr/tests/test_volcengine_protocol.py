"""
火山引擎 SAUC 二进制协议 — 纯函数层单测 (v3 风格)

v3 协议特征:
- 帧头 4 字节 + size 4 字节 + gzip 压缩 payload (共 8 字节 header+size)
- payload JSON 顶层只有 user / audio / request
- HTTP header 用 X-Api-App-Key / X-Api-Access-Key / X-Api-Resource-Id, **没有** Authorization

参考: https://github.com/archibate/talky/blob/main/talky.py
"""
import gzip
import json
import struct
import pytest

from volcengine_engine import (
    encode_full_client_request,
    encode_audio_only,
    encode_audio_last,
    parse_server_response,
    parse_server_response_v3,
    extract_utterances,
    build_full_request_payload,
    build_ws_headers,
    PROTOCOL_VERSION,
    MSG_TYPE_FULL_REQUEST,
    MSG_TYPE_AUDIO_ONLY,
    MSG_TYPE_FULL_RESPONSE,
    MSG_TYPE_ERROR,
    MSG_TYPE_PARTIAL_RESPONSE,
    MSG_TYPE_FINAL_RESPONSE,
    FLAG_LAST,
    COMPRESSION_GZIP,
    SERIALIZATION_JSON,
)


# ============================================================================
# 编码: 客户端请求帧
# ============================================================================
class TestEncodeFullClientRequest:
    def test_header_byte0_is_protocol_version(self):
        payload = {"hello": "world"}
        frame = encode_full_client_request(payload)
        assert frame[0] == PROTOCOL_VERSION

    def test_header_byte1_msg_type_is_full_request(self):
        payload = {"hello": "world"}
        frame = encode_full_client_request(payload)
        assert (frame[1] >> 4) == MSG_TYPE_FULL_REQUEST

    def test_header_byte2_serialization_is_json(self):
        """byte2 高 4 位 = serialization = JSON (0x1)"""
        frame = encode_full_client_request({"a": 1})
        assert (frame[2] >> 4) == SERIALIZATION_JSON

    def test_header_byte2_compression_is_gzip(self):
        """byte2 低 4 位 = compression = gzip (0x1)"""
        frame = encode_full_client_request({"a": 1})
        assert (frame[2] & 0x0F) == COMPRESSION_GZIP

    def test_size_is_4bytes_big_endian(self):
        """bytes 4..7 = payload_size (大端 4 字节)"""
        frame = encode_full_client_request({"a": 1})
        size = struct.unpack(">I", frame[4:8])[0]
        # size 应等于后续 body 长度 (gzip 压缩后)
        assert size == len(frame) - 8

    def test_body_is_gzipped_json(self):
        """body 应是 gzip(JSON(payload))"""
        payload = {"user": {"uid": "test"}, "request": {"model_name": "bigmodel"}}
        frame = encode_full_client_request(payload)
        body = gzip.decompress(frame[8:])
        decoded = json.loads(body.decode("utf-8"))
        assert decoded == payload

    def test_v3_payload_structure_no_namespace(self):
        """v3 payload 顶层只有 user / audio / request, 没有 v2 的 namespace/input/parameters"""
        payload = build_full_request_payload(
            app_key="x", access_token="y", uid="u1",
            model_name="bigmodel",
        )
        assert "namespace" not in payload
        assert "input" not in payload
        assert "parameters" not in payload
        assert "user" in payload
        assert "audio" in payload
        assert "request" in payload

    def test_v3_audio_section_format_pcm(self):
        """v3 audio: format='pcm', codec='raw', rate/bits/channel"""
        payload = build_full_request_payload(
            app_key="x", access_token="y", uid="u1",
            sample_rate=16000, bits=16, channels=1,
        )
        assert payload["audio"]["format"] == "pcm"
        assert payload["audio"]["codec"] == "raw"
        assert payload["audio"]["rate"] == 16000
        assert payload["audio"]["bits"] == 16
        assert payload["audio"]["channel"] == 1

    def test_v3_request_show_utterances_default_true(self):
        """v3 默认 show_utterances=True 才能拿到分角色"""
        payload = build_full_request_payload(app_key="x", access_token="y", uid="u1")
        assert payload["request"]["show_utterances"] is True
        assert payload["request"]["model_name"] == "bigmodel"
        assert payload["request"]["enable_punc"] is True
        assert payload["request"]["enable_itn"] is True


class TestEncodeAudioOnly:
    def test_header_msg_type_is_audio(self):
        audio = b"\x00\x01" * 100
        frame = encode_audio_only(audio)
        assert (frame[1] >> 4) == MSG_TYPE_AUDIO_ONLY

    def test_body_is_gzipped_pcm(self):
        """audio-only 帧 body 也要 gzip 压缩"""
        audio = b"\xaa\xbb\xcc\xdd" * 100  # 400 bytes
        frame = encode_audio_only(audio)
        body = gzip.decompress(frame[8:])
        assert body == audio

    def test_last_frame_sets_last_flag(self):
        """最后一帧 flags=0x2 (LAST)"""
        audio = b"\xff" * 100
        frame = encode_audio_last(audio)
        assert (frame[1] & FLAG_LAST) == FLAG_LAST

    def test_normal_audio_frame_has_no_last_flag(self):
        audio = b"\x00" * 100
        frame = encode_audio_only(audio)
        assert (frame[1] & FLAG_LAST) == 0


# ============================================================================
# 解码: 服务端响应帧
# ============================================================================
class TestParseServerResponse:
    def _make_frame(self, msg_type: int, body: dict, flags: int = 0,
                    compression: int = COMPRESSION_GZIP) -> bytes:
        body_bytes = json.dumps(body).encode("utf-8")
        if compression == COMPRESSION_GZIP:
            body_bytes = gzip.compress(body_bytes)
        size = len(body_bytes)
        # 8 字节 header+size
        size_bytes = struct.pack(">I", size)
        byte2 = (SERIALIZATION_JSON << 4) | compression
        header = bytes([PROTOCOL_VERSION, (msg_type << 4) | flags, byte2, 0x00])
        return header + size_bytes + body_bytes

    def test_parse_partial_response(self):
        body = {"result": {"text": "你好"}, "utterances": []}
        frame = self._make_frame(MSG_TYPE_PARTIAL_RESPONSE, body)
        out = parse_server_response(frame)
        assert out["type"] == "partial"
        assert out["payload"]["result"]["text"] == "你好"

    def test_parse_final_response_with_speaker(self):
        body = {
            "result": {
                "text": "你好世界。我是字节。",
                "utterances": [
                    {"text": "你好世界。", "start_time": 0, "end_time": 1500,
                     "speaker_id": "spk0", "words": [
                         {"text": "你好", "start_time": 0, "end_time": 500, "speaker_id": "spk0"},
                     ]},
                    {"text": "我是字节。", "start_time": 1500, "end_time": 3000,
                     "speaker_id": "spk1", "words": []},
                ],
            }
        }
        frame = self._make_frame(MSG_TYPE_FINAL_RESPONSE, body)
        out = parse_server_response(frame)
        assert out["type"] == "final"
        utts = out["payload"]["result"]["utterances"]
        assert len(utts) == 2
        assert utts[0]["speaker_id"] == "spk0"
        assert utts[1]["speaker_id"] == "spk1"

    def test_parse_error_response(self):
        body = {"code": 10001, "message": "invalid token"}
        frame = self._make_frame(MSG_TYPE_ERROR, body)
        out = parse_server_response(frame)
        assert out["type"] == "error"
        assert out["payload"]["code"] == 10001

    def test_parse_full_response_ack(self):
        body = {"result": {"text": ""}}
        frame = self._make_frame(MSG_TYPE_FULL_RESPONSE, body)
        out = parse_server_response(frame)
        assert out["type"] == "full"

    def test_parse_with_uncompressed_body(self):
        """兼容未压缩的 body (某些调试场景)"""
        body = {"result": {"text": "plain"}}
        body_bytes = json.dumps(body).encode("utf-8")
        size = len(body_bytes)
        size_bytes = struct.pack(">I", size)
        byte2 = (SERIALIZATION_JSON << 4) | 0  # 无压缩
        header = bytes([PROTOCOL_VERSION, (MSG_TYPE_PARTIAL_RESPONSE << 4), byte2, 0x00])
        frame = header + size_bytes + body_bytes
        out = parse_server_response(frame)
        assert out["type"] == "partial"
        assert out["payload"]["result"]["text"] == "plain"


# ============================================================================
# v3/sauc/bigmodel_async 实测协议: flags bit 0 = has seq
# ============================================================================
class TestParseServerResponseV3:
    def _make_v3_frame(self, msg_type: int, body: dict, flags: int = 0,
                       compression: int = 0, seq: int = None) -> bytes:
        body_bytes = json.dumps(body).encode("utf-8")
        if compression == COMPRESSION_GZIP:
            body_bytes = gzip.compress(body_bytes)
        size = len(body_bytes)
        size_bytes = struct.pack(">I", size)
        byte2 = (SERIALIZATION_JSON << 4) | compression
        header = bytes([PROTOCOL_VERSION, (msg_type << 4) | flags, byte2, 0x00])
        if seq is not None:
            return header + struct.pack(">i", seq) + size_bytes + body_bytes
        return header + size_bytes + body_bytes

    def test_parse_response_with_seq_field(self):
        body = {"result": {"additions": {"log_id": "test"}}}
        frame = self._make_v3_frame(0x9, body, flags=0x3, seq=1)
        out = parse_server_response_v3(frame)
        assert out["type"] == "full"
        assert out["seq"] == 1
        assert out["flags"] == 0x3

    def test_parse_response_without_seq_field(self):
        body = {"result": {"additions": {"log_id": "test"}}}
        frame = self._make_v3_frame(0x9, body, flags=0)
        out = parse_server_response_v3(frame)
        assert out["type"] == "full"
        assert out["seq"] is None

    def test_parse_with_uncompressed_body(self):
        """v3 实际返回 uncompressed JSON"""
        body = {"result": {"additions": {"log_id": "x"}}}
        frame = self._make_v3_frame(0x9, body, compression=0)
        out = parse_server_response_v3(frame)
        assert out["type"] == "full"
        assert out["payload"]["result"]["additions"]["log_id"] == "x"


# ============================================================================
# speaker_id 在 v3 嵌套在 additions 里 (实测确认)
# ============================================================================
class TestExtractUtterancesWithAdditions:
    def test_extract_speaker_from_additions_nested(self):
        payload = {
            "result": {
                "text": "看看。",
                "utterances": [
                    {
                        "text": "看看。",
                        "start_time": 340,
                        "end_time": 420,
                        "additions": {
                            "speaker_id": "0",
                            "fixed_prefix_result": "",
                        },
                        "words": [],
                    }
                ]
            }
        }
        utterances, speakers = extract_utterances(payload)
        assert len(utterances) == 1
        assert utterances[0]["speaker_id"] == "0"
        assert speakers[0]["id"] == "0"

    def test_extract_fallback_to_top_level_speaker_id(self):
        payload = {
            "result": {
                "utterances": [
                    {"text": "hi", "speaker_id": "spk0"},
                    {"text": "world", "speaker_id": "spk1"},
                ]
            }
        }
        utterances, speakers = extract_utterances(payload)
        assert len(utterances) == 2
        assert utterances[0]["speaker_id"] == "spk0"
        assert utterances[1]["speaker_id"] == "spk1"
        assert len(speakers) == 2

    def test_extract_multiple_speakers_from_additions(self):
        payload = {
            "result": {
                "text": "你好。我是字节。",
                "utterances": [
                    {"text": "你好。", "start_time": 0, "end_time": 1500,
                     "additions": {"speaker_id": "spk0"}, "words": []},
                    {"text": "我是字节。", "start_time": 1500, "end_time": 3000,
                     "additions": {"speaker_id": "spk1"}, "words": []},
                ]
            }
        }
        utterances, speakers = extract_utterances(payload)
        assert len(utterances) == 2
        assert utterances[0]["speaker_id"] == "spk0"
        assert utterances[1]["speaker_id"] == "spk1"
        assert [s["id"] for s in speakers] == ["spk0", "spk1"]


# ============================================================================
# 握手 header 构造
# ============================================================================
class TestBuildWsHeaders:
    def test_authorization_header_uses_bearer_with_semicolon(self):
        """v1/sauc 实测协议: Authorization 头带分号 'Bearer; {token}'"""
        hdrs = build_ws_headers(app_key="k", access_token="t", resource_id="bigmodel")
        auths = [h for h in hdrs if h.startswith("Authorization:")]
        assert len(auths) == 1
        # 关键: 带分号
        assert auths[0] == "Authorization: Bearer; t"

    def test_required_headers_present(self):
        hdrs = build_ws_headers(app_key="app", access_token="tok", resource_id="bigmodel")
        names = [h.split(":", 1)[0].strip() for h in hdrs]
        for required in ("X-Api-App-Key", "X-Api-Access-Key", "X-Api-Resource-Id",
                         "X-Api-Request-Id", "X-Api-Connect-Id", "X-Api-Sequence"):
            assert required in names, f"missing header: {required}"

    def test_x_api_sequence_is_fixed_minus_one(self):
        """官方文档要求 X-Api-Sequence 固定 -1, 不发会 400"""
        hdrs = build_ws_headers(app_key="a", access_token="b", resource_id="x")
        text = "\n".join(hdrs)
        assert "X-Api-Sequence: -1" in text

    def test_resource_id_is_configurable(self):
        """resource_id 可切换服务: 豆包流式 1.0/2.0 × 小时/并发 = 4 个组合"""
        for rid in (
            "volc.bigasr.sauc.duration",     # 豆包 1.0 小时版 (最常用)
            "volc.bigasr.sauc.concurrent",   # 豆包 1.0 并发版
            "volc.seedasr.sauc.duration",    # 豆包 2.0 小时版
            "volc.seedasr.sauc.concurrent",  # 豆包 2.0 并发版
        ):
            hdrs = build_ws_headers(app_key="a", access_token="b", resource_id=rid)
            text = "\n".join(hdrs)
            assert f"X-Api-Resource-Id: {rid}" in text

    def test_request_id_and_connect_id_default_to_uuid(self):
        import uuid
        hdrs = build_ws_headers(app_key="a", access_token="b", resource_id="x")
        text = "\n".join(hdrs)
        # 至少有一行 X-Api-Request-Id: <uuid-like>
        import re
        m_req = re.search(r"X-Api-Request-Id:\s*([0-9a-f-]{36})", text)
        m_con = re.search(r"X-Api-Connect-Id:\s*([0-9a-f-]{36})", text)
        assert m_req, "X-Api-Request-Id not a UUID"
        assert m_con, "X-Api-Connect-Id not a UUID"
        # 验证确实是合法 UUID
        uuid.UUID(m_req.group(1))
        uuid.UUID(m_con.group(1))


# ============================================================================
# Round-trip
# ============================================================================
class TestRoundTrip:
    def test_full_request_round_trip(self):
        payload = build_full_request_payload(
            app_key="k", access_token="t", uid="u1", model_name="bigmodel",
            sample_rate=16000, bits=16, channels=1,
        )
        frame = encode_full_client_request(payload)
        # 解码 body 应得到原 JSON
        body = gzip.decompress(frame[8:])
        decoded = json.loads(body.decode("utf-8"))
        assert decoded["user"]["uid"] == "u1"
        assert decoded["audio"]["rate"] == 16000
        assert decoded["request"]["model_name"] == "bigmodel"
        assert decoded["request"]["show_utterances"] is True

    def test_audio_round_trip(self):
        original = b"\x00\x10" * 1600  # 100ms PCM
        frame = encode_audio_only(original)
        body = gzip.decompress(frame[8:])
        assert body == original

    def test_extra_request_merged(self):
        """extra_request 字段会合并到 request 顶层"""
        payload = build_full_request_payload(
            app_key="k", access_token="t", uid="u1",
            extra_request={"mode": "s2t", "source_language": "zh", "target_language": "en"},
        )
        assert payload["request"]["mode"] == "s2t"
        assert payload["request"]["source_language"] == "zh"
