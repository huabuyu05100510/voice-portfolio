"""
火山引擎 (字节跳动开放平台) 流式语音识别 — 协议层封装 (v3)

端点: wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
       (resource-id 可通过 X-Api-Resource-Id header 切换:
        bigmodel = 流式语音识别, volc.service_type.10053 = 豆包 AST 2.0 s2t)
鉴权: X-Api-App-Key + X-Api-Access-Key + X-Api-Resource-Id (+ Request-Id / Connect-Id)
      注意: **没有** Authorization Bearer; header (v3 网关只认 X-Api-*)
帧协议: 自研二进制 — 0x11 header + gzip 压缩 payload

帧字节布局:
    byte0 = (protocol_version<<4) | header_size        (固定 0x11, 4 字节 header)
    byte1 = (message_type<<4)   | flags
        flags: 0b0000 normal, 0b0001 +seq, 0b0010 last, 0b0011 last+neg-seq
    byte2 = (serialization<<4)  | compression
        serialization: 0x1 = JSON, 0x2/0x3 = protobuf
        compression:   0x0 = none, 0x1 = gzip
    byte3 = reserved (0x00)
    bytes 4..7 = payload_size (4 字节大端 int)
    [body] = gzip(payload)

Payload JSON (v3 结构, 取代 v2 的 user/namespace/model_name/input/parameters/audio):
    {
      "user":    {"uid": "...", "platform": "..."},
      "audio":   {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1},
      "request": {
        "model_name":      "bigmodel",
        "enable_itn":      true,
        "enable_punc":     true,
        "show_utterances": true,        // 关键: 返回分段 + 词级时间戳
        "result_type":     "single",    // single = 一句一返
        // 豆包同声传译 s2t 模式可能还需要: "mode": "s2t", "source_language": "zh", "target_language": "en"
      }
    }

服务端响应帧类型:
    0x9  full_resp     - 配置 ack
    0xC  partial_resp  - 增量 partial (result.text)
    0xF  final_resp    - 完整结果 (result.text + result.utterances[] + speaker_id)
    0xB  error         - {code, message} (talky 把 error + final 都归到 0x0F)

参考: https://github.com/archibate/talky/blob/main/talky.py (已实测)
"""
from __future__ import annotations

import gzip
import json
import struct
from typing import Any, Dict, List, Tuple


# ============================================================================
# 协议常量
# ============================================================================
PROTOCOL_VERSION = 0x11  # (protocol_v1 << 4) | header_size_1(=4 字节 header)
HEADER_SIZE_SMALL = 0x01
HEADER_SIZE_LARGE = 0x02

# Message types (byte1 高 4 位)
MSG_TYPE_FULL_REQUEST = 0x1
MSG_TYPE_AUDIO_ONLY = 0x2
MSG_TYPE_FULL_RESPONSE = 0x9
MSG_TYPE_ERROR = 0xB
MSG_TYPE_PARTIAL_RESPONSE = 0xC
MSG_TYPE_FINAL_RESPONSE = 0xF

# Flags (byte1 低 4 位)
FLAG_NONE = 0x0
FLAG_HAS_SEQ = 0x1
FLAG_LAST = 0x2  # 最后一帧 audio

# Serialization (byte2 高 4 位)
SERIALIZATION_JSON = 0x1
SERIALIZATION_PROTOBUF = 0x2

# Compression (byte2 低 4 位)
COMPRESSION_NONE = 0x0
COMPRESSION_GZIP = 0x1

# Server response type name 映射
RESPONSE_TYPE_NAMES = {
    MSG_TYPE_FULL_RESPONSE: "full",
    MSG_TYPE_PARTIAL_RESPONSE: "partial",
    MSG_TYPE_FINAL_RESPONSE: "final",
    MSG_TYPE_ERROR: "error",
}


def _gen_reqid() -> str:
    """生成 v1/sauc 服务端要求的 reqid (uuid 格式)"""
    import uuid
    return str(uuid.uuid4())


def parse_server_response_v3(data: bytes) -> Dict[str, Any]:
    """
    v3/sauc/bigmodel_async 端点专用解析 (实测确认).

    帧布局 (经实测):
      byte0 = 0x11 (协议版本)
      byte1 = (msg_type<<4) | flags
              - msg_type: 0x9 full / 0xC partial / 0xF final / 0xE end / 0xB error
              - flags bit0: 1 = has 4-byte seq 字段
              - flags bit1: 1 = LAST (最后一帧)
              - flags bit2: 1 = ??? (观察到的)
              - flags bit3: 1 = ??? (观察到的)
      byte2 = (serialization<<4) | compression
              - 实际看到 serialization=1 (JSON), compression=0 (no gzip)
              - 但 talky.py 默认 0x11 = JSON+gzip, 我们发送请求时 gzip
      byte3 = 0x00
      [seq: 4B big-endian signed int]  (仅当 flags bit0 set)
      size: 4B big-endian unsigned int (gzip 后 body 长度)
      body: <size> bytes

    响应里 speaker_id 位于 utterance.additions.speaker_id (不是顶层)
    """
    if not isinstance(data, (bytes, bytearray)):
        return {"type": "text", "payload": {"raw": str(data)[:500]}, "raw_size": 0}
    if len(data) < 4:
        return {"type": "unknown", "payload": {"raw": data.hex()}, "raw_size": len(data)}

    msg_type = (data[1] >> 4) & 0x0F
    flags = data[1] & 0x0F
    compression = data[2] & 0x0F

    off = 4
    seq = None
    if flags & 0x01:
        if len(data) < off + 4:
            return {"type": "unknown", "payload": {"raw": data.hex()}, "raw_size": len(data)}
        seq = struct.unpack(">i", data[off:off+4])[0]
        off += 4

    if len(data) < off + 4:
        return {"type": "unknown", "payload": {"raw": data.hex()}, "raw_size": len(data)}
    size = struct.unpack(">I", data[off:off+4])[0]
    off += 4
    body = data[off:off + size]

    if compression == COMPRESSION_GZIP:
        try:
            body = gzip.decompress(body)
        except Exception as e:
            return {"type": "error", "payload": {"code": -1, "message": f"gzip fail: {e}"},
                    "raw_size": len(data)}

    try:
        parsed = json.loads(body.decode("utf-8")) if body else {}
    except Exception as e:
        parsed = {"_parse_error": str(e), "_raw": body[:500].decode("utf-8", errors="replace")}

    type_name = RESPONSE_TYPE_NAMES.get(msg_type, f"unknown_0x{msg_type:X}")
    return {
        "type": type_name,
        "flags": flags,
        "seq": seq,
        "payload": parsed,
        "raw_size": len(data),
    }


# ============================================================================
# 内部: 帧头构造 + gzip 包装
# ============================================================================
def _make_header(msg_type: int, flags: int, serialization: int, compression: int) -> bytes:
    """
    构造 4 字节帧头:
        byte0 = 0x11
        byte1 = (msg_type<<4) | flags
        byte2 = (serialization<<4) | compression
        byte3 = reserved (0x00)

    payload_size 由外层在 4 字节 header 之后追加。
    注: v3 协议下 payload size 编码跨 4 字节 (bytes 4..7), 总 header = 8 字节。
    """
    byte1 = ((msg_type & 0x0F) << 4) | (flags & 0x0F)
    byte2 = ((serialization & 0x0F) << 4) | (compression & 0x0F)
    return bytes([PROTOCOL_VERSION, byte1, byte2, 0x00])


def _frame(header: bytes, payload: bytes, compression: int = COMPRESSION_GZIP) -> bytes:
    """
    把 header + size + (压缩后的 payload) 拼成完整二进制帧。

    v3 网关要求 payload 必须 gzip 压缩; client 发送时遵循服务端期望即可。
    """
    if compression == COMPRESSION_GZIP:
        body = gzip.compress(payload)
    else:
        body = payload
    return header + struct.pack(">I", len(body)) + body


# ============================================================================
# 客户端 → 服务端: 编码
# ============================================================================
def encode_full_client_request(payload: Dict[str, Any]) -> bytes:
    """
    编码 0x1 client full request (v3 风格)。

    payload 是 dict, JSON 序列化后 gzip, 加 4 字节 header + 4 字节 size。
    第一段音频**不放**在 payload 里 (v3 与 v2 不同); v3 的第一帧只发 config,
    后续 audio-only 帧另发。
    """
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    header = _make_header(
        msg_type=MSG_TYPE_FULL_REQUEST,
        flags=FLAG_NONE,
        serialization=SERIALIZATION_JSON,
        compression=COMPRESSION_GZIP,
    )
    return _frame(header, body, COMPRESSION_GZIP)


def encode_audio_only(audio: bytes) -> bytes:
    """编码 0x2 audio-only 帧 (PCM 原字节 + gzip 压缩 + 4 字节 header + 4 字节 size)。"""
    header = _make_header(
        msg_type=MSG_TYPE_AUDIO_ONLY,
        flags=FLAG_NONE,
        serialization=SERIALIZATION_JSON,  # serialization 字段对 audio 不重要, 用 JSON 占位
        compression=COMPRESSION_GZIP,
    )
    return _frame(header, audio, COMPRESSION_GZIP)


def encode_audio_last(audio: bytes) -> bytes:
    """编码最后一帧 audio-only (flags=LAST), 通知服务端结束。"""
    header = _make_header(
        msg_type=MSG_TYPE_AUDIO_ONLY,
        flags=FLAG_LAST,
        serialization=SERIALIZATION_JSON,
        compression=COMPRESSION_GZIP,
    )
    return _frame(header, audio, COMPRESSION_GZIP)


# ============================================================================
# 服务端 → 客户端: 解码
# ============================================================================
def parse_server_response(data: bytes) -> Dict[str, Any]:
    """
    解析服务端响应帧 (v3 风格: header 4B + size 4B + gzip body)。

    返回:
        {
          "type": "full" | "partial" | "final" | "error" | "unknown_<hex>",
          "flags": int,
          "payload": <dict>,
          "raw_size": int,
        }
    """
    if not isinstance(data, (bytes, bytearray)):
        return {"type": "text", "payload": {"raw": str(data)[:500]}, "raw_size": 0}

    if len(data) < 8:
        return {"type": "unknown", "payload": {"raw": data.hex()}, "raw_size": len(data)}

    msg_type = (data[1] >> 4) & 0x0F
    flags = data[1] & 0x0F
    compression = data[2] & 0x0F

    payload_size = struct.unpack(">I", data[4:8])[0]
    body = data[8:8 + payload_size]

    if compression == COMPRESSION_GZIP:
        try:
            body = gzip.decompress(body)
        except Exception as e:
            return {
                "type": "error",
                "payload": {"code": -1, "message": f"gzip decompress failed: {e}"},
                "raw_size": len(data),
            }

    try:
        parsed = json.loads(body.decode("utf-8")) if body else {}
    except Exception as e:
        parsed = {"_parse_error": str(e), "_raw": body[:500].decode("utf-8", errors="replace")}

    type_name = RESPONSE_TYPE_NAMES.get(msg_type, f"unknown_0x{msg_type:X}")
    return {
        "type": type_name,
        "flags": flags,
        "payload": parsed,
        "raw_size": len(data),
    }


# ============================================================================
# 构造典型 full request payload (v3 结构)
# ============================================================================
def build_full_request_payload(
    app_key: str,
    access_token: str,
    cluster: str = None,
    model_name: str = "bigmodel",
    uid: str = "web-client",
    enable_itn: bool = True,
    enable_punc: bool = True,
    show_utterances: bool = True,
    enable_speaker_info: bool = True,  # 火山官方分角色参数名 (替代旧的 show_speaker_info)
    enable_diarization: bool = True,   # 兼容旧 API 命名 (内部映射到 enable_speaker_info)
    result_type: str = "single",
    sample_rate: int = 16000,
    bits: int = 16,
    channels: int = 1,
    platform: str = "Web",
    extra_request: dict = None,
    # ⭐ 多说话人关键参数: -1 = 自动检测任意人数, 默认 2 在某些版本上锁死
    diarization_speaker_count: int = -1,
) -> Dict[str, Any]:
    """
    构造 v3 风格 0x1 full request payload。

    关键参数 (基于 docs/6561/1631584 官方 HTTP spec + 社区 streaming 实现):
    - request.model_name = "bigmodel" (或 bigmodel_async)
    - request.enable_speaker_info = true → 启用说话人分离 (官方字段名)
    - request.diarization_speaker_count = -1 → ⭐ 自动检测任意人数说话人
      (默认 2 在某些版本锁死, 显式 -1 让服务端放开限制)
    - request.show_utterances = true → 启用分段 + 词级时间戳
    - request.enable_itn / enable_punc → 数字归一 / 标点
    - request.enable_ddc = false → 智能纠错 (默认关闭)

    响应: result.text + result.utterances[] (含 speaker_id / words[])
    """
    req = {
        "model_name": model_name,
        "enable_itn": enable_itn,
        "enable_punc": enable_punc,
        "enable_ddc": False,
        "show_utterances": show_utterances,
        "result_type": result_type,
        # v1/sauc 服务端要求 request.reqid 必须存在 (uuid-like)
        "reqid": _gen_reqid(),
    }
    # v3 官方字段: enable_speaker_info
    # 兼容旧版本: 同时发 show_speaker_info (服务端会忽略不认识的字段)
    if enable_diarization or enable_speaker_info:
        req["enable_speaker_info"] = True
        req["show_speaker_info"] = True  # 兼容
        # ⭐ 关键: 让服务端自动检测任意数量说话人
        # 某些版本默认 2 说话人, 必须显式设为 -1 才能扩展
        req["diarization_speaker_count"] = diarization_speaker_count
        # 兼容字段名
        req["speaker_count"] = diarization_speaker_count
    if extra_request:
        req.update(extra_request)

    payload = {
        "user": {"uid": uid, "platform": platform},
        "audio": {
            "format": "pcm",
            "codec": "raw",
            "rate": sample_rate,
            "bits": bits,
            "channel": channels,
        },
        "request": req,
    }

    # v1/sauc 端点虽然用 v3 帧协议, 但 payload JSON 仍要求 v2 风格的 app 嵌套对象
    # (不写会被服务端 "invalid type for token app, is <nil>" 拒绝)
    if cluster is None:
        cluster = "volcengine_streaming_common"
    payload["app"] = {
        "appid": app_key.split("-")[0] if "-" in app_key else app_key[:8],
        "token": access_token,
        "cluster": cluster,
    }

    return payload


def build_ws_headers(app_key: str, access_token: str, resource_id: str,
                     request_id: str = None, connect_id: str = None,
                     api_key: str = None) -> list:
    """
    构造 v1/sauc WebSocket 握手 HTTP headers (经实测验证协议)。

    优先用新控制台 X-Api-Key (单一鉴权 header); 旧版用 X-Api-App-Key + X-Api-Access-Key 双 header.

    Headers:
        Authorization: Bearer; {token}    # ⭐ 字节 SAUC 网关特殊: 带分号 (新旧都加更稳)
        # 新控制台:
        X-Api-Key: API_KEY
        # 旧控制台:
        X-Api-App-Key: APPID
        X-Api-Access-Key: Access Token
        # 通用:
        X-Api-Resource-Id: 资源 ID
            - volc.seedasr.sauc.duration   → 豆包流式语音识别 2.0 (小时版) ⭐
            - volc.seedasr.sauc.concurrent → 豆包流式语音识别 2.0 (并发版)
            - volc.bigasr.sauc.duration   → 豆包流式语音识别 1.0 (小时版)
            - volc.bigasr.sauc.concurrent → 豆包流式语音识别 1.0 (并发版)
        X-Api-Request-Id: uuid
        X-Api-Connect-Id: uuid
        X-Api-Sequence:  -1 (固定值)
    """
    import uuid
    auth_token = api_key or access_token
    headers = [
        f"Authorization: Bearer; {auth_token}",  # ⭐ 带分号 (新旧控制台都加)
        f"X-Api-Resource-Id: {resource_id}",
        f"X-Api-Request-Id: {request_id or str(uuid.uuid4())}",
        f"X-Api-Connect-Id: {connect_id or str(uuid.uuid4())}",
        f"X-Api-Sequence: -1",
    ]
    if api_key:
        # 新控制台: 单 X-Api-Key
        headers.insert(1, f"X-Api-Key: {api_key}")
    else:
        # 旧控制台: 双 header
        headers.insert(1, f"X-Api-App-Key: {app_key}")
        headers.insert(2, f"X-Api-Access-Key: {access_token}")
    return headers


# ============================================================================
# 业务便捷: 从 final 响应抽取 utterances + speakers
# ============================================================================
def extract_utterances(final_payload: Dict[str, Any]) -> Tuple[list, list]:
    """
    从 final response payload 抽取:
    - utterances: list[{text, start_time, end_time, speaker_id, words:[]}]
    - speakers: list[{id, color, label}] — 前端会按 palette 着色

    兼容两种入参:
    - 完整 payload: {"result": {"utterances": [...]}}
    - 直接 result: {"utterances": [...]}

    speaker_id 位置 (实测确认):
    - v3/sauc 2.0 模型: 位于 utterance.additions.speaker_id (嵌套)
    - 兼容老版本: 直接 utterance.speaker_id

    speakers 按出现顺序分配 label: '发言人 1', '发言人 2', ...
    """
    # 兼容两种入参格式
    if "utterances" in final_payload:
        result = final_payload
    else:
        result = final_payload.get("result") or {}

    raw_utts = result.get("utterances") or []
    utterances = []
    speaker_id_to_label = {}
    speakers = []

    for u in raw_utts:
        # v3/sauc (豆包 2.0): speaker_id 在 additions 里
        additions = u.get("additions") or {}
        sid = (
            additions.get("speaker_id")
            or u.get("speaker_id")
            or "spk?"
        )
        if sid not in speaker_id_to_label:
            speaker_id_to_label[sid] = f"发言人 {len(speakers) + 1}"
            speakers.append({"id": sid, "label": speaker_id_to_label[sid]})
        utterances.append({
            "text": u.get("text", ""),
            "start_time": u.get("start_time", 0),
            "end_time": u.get("end_time", 0),
            "speaker_id": sid,
            "words": u.get("words") or [],
        })
    return utterances, speakers


# ============================================================================
# Smoke: 命令行直接跑测试帧编解码
# ============================================================================
if __name__ == "__main__":
    import os, time, wave
    payload = build_full_request_payload(
        app_key="placeholder",
        access_token="placeholder",
        model_name="bigmodel",
        uid="smoke",
    )
    frame = encode_full_client_request(payload)
    print(f"full request frame: {len(frame)} bytes (gzipped JSON)")
    print(f"  header: {frame[:4].hex()}")
    print(f"  size: {frame[4:8].hex()} = {int.from_bytes(frame[4:8], 'big')}")

    audio = b"\x00\x01" * 1600  # 100ms @ 16kHz
    audio_frame = encode_audio_only(audio)
    print(f"\naudio frame: {len(audio_frame)} bytes (gzipped {len(audio)} bytes PCM)")
    print(f"  header: {audio_frame[:4].hex()}")

    last_frame = encode_audio_last(b"\x00" * 100)
    print(f"\nlast frame flags: {hex(last_frame[1] & 0x0F)}")
