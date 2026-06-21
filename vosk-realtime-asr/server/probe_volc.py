#!/usr/bin/env python3
"""
volc 后端自动探测脚本 (v3 协议版本)

每隔 30s 重试 /api/v3/sauc/bigmodel_async + volc.seedasr.sauc.duration, 一旦后端就绪就:
- 在屏幕打印 🎉 SUCCESS
- 写入 /tmp/volc_ready.json
- 退出

用法:
    cd server && python3 probe_volc.py
"""
from __future__ import annotations

import gzip
import json
import os
import struct
import sys
import time
import uuid

import websocket

API_KEY = os.environ.get("VOLC_API_KEY", "77c3e13e-35c8-45fd-b784-7cb0e6b15365")
URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
RESOURCE_ID = "volc.seedasr.sauc.duration"
PROBE_INTERVAL = 30  # 秒

SAMPLE_AUDIO_PATH = "/Users/huabuyu/resume/语音/vosk-realtime-asr/client/public/sample-cn.wav"


def send_frame(ws, msg_type, flags, payload_bytes):
    hdr = bytes([0x11, (msg_type << 4) | flags, 0x11, 0x00])
    body = gzip.compress(payload_bytes)
    ws.send_binary(hdr + struct.pack(">I", len(body)) + body)


def recv_frame(ws):
    """智能解析 v3 帧, 返回 (type, flags, seq, decoded)"""
    opcode, data = ws.recv_data()
    if opcode != 0x2 or len(data) < 4:
        return None
    mt = (data[1] >> 4) & 0x0F
    flags = data[1] & 0x0F
    compression = data[2] & 0x0F
    off = 4
    seq = None
    if flags & 0x01:
        seq = struct.unpack(">i", data[off:off+4])[0]
        off += 4
    size = struct.unpack(">I", data[off:off+4])[0]
    off += 4
    body = data[off:off+size]
    if compression == 0x1:
        body = gzip.decompress(body)
    return mt, flags, seq, json.loads(body.decode())


def load_audio(path):
    """读 wav 文件, 返回 bytes (要求 16kHz/16bit/mono)"""
    import wave
    wf = wave.open(path, 'rb')
    data = wf.readframes(wf.getnframes())
    wf.close()
    return data


def try_one() -> tuple:
    """尝试一次: 握手 + 发真实音频 + 等识别结果
    返回 (status, message)
    status: "ready" | "waiting" | "error"
    """
    reqid = str(uuid.uuid4())
    headers = [
        f"X-Api-Key: {API_KEY}",
        f"X-Api-Resource-Id: {RESOURCE_ID}",
        f"X-Api-Request-Id: {reqid}",
        "X-Api-Sequence: -1",
    ]
    try:
        ws = websocket.create_connection(URL, header=headers, timeout=6)
    except Exception as e:
        return "waiting", f"handshake: {str(e)[:60]}"

    payload = {
        "user": {"uid": "probe", "platform": "Test"},
        "audio": {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1},
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True, "enable_punc": True,
            "enable_speaker_info": True, "show_utterances": True,
            "reqid": reqid,
        },
    }
    try:
        send_frame(ws, 0x1, 0, json.dumps(payload).encode())
        recv_frame(ws)  # config ack

        # 发 5 秒真实音频
        audio = load_audio(SAMPLE_AUDIO_PATH)[:80000]  # 5 秒
        chunk_size = 6400
        for i in range(0, len(audio), chunk_size):
            chunk = audio[i:i+chunk_size]
            flags = 0x2 if i + chunk_size >= len(audio) else 0
            send_frame(ws, 0x2, flags, chunk)

        ws.settimeout(15)
        for _ in range(20):
            try:
                frame = recv_frame(ws)
                if not frame: continue
                mt, flags, seq, decoded = frame
                result = decoded.get("result", {})
                if isinstance(result, dict) and result.get("utterances"):
                    text = result.get("text", "")
                    utts = result.get("utterances", [])
                    speakers = set()
                    for u in utts:
                        add = u.get("additions", {})
                        sid = add.get("speaker_id") or u.get("speaker_id")
                        if sid: speakers.add(sid)
                    ws.close()
                    return "ready", f"text='{text[:80]}' utts={len(utts)} speakers={list(speakers)}"
            except Exception:
                break
        ws.close()
        return "waiting", "audio sent but no utterance received"
    except Exception as e:
        return "error", str(e)[:120]


def main():
    print(f"🔍 探测火山引擎 v3/sauc/bigmodel_async 后端")
    print(f"   API_KEY: {API_KEY[:8]}...")
    print(f"   Resource: {RESOURCE_ID}")
    print(f"   Sample audio: {SAMPLE_AUDIO_PATH}")
    print(f"   间隔: {PROBE_INTERVAL}s")
    print(f"   按 Ctrl+C 停止\n")

    attempt = 0
    start = time.time()
    while True:
        attempt += 1
        elapsed_min = (time.time() - start) / 60
        ts = time.strftime("%H:%M:%S")
        status, msg = try_one()
        if status == "ready":
            print(f"\n🎉🎉🎉 [{ts}] #{attempt} (t={elapsed_min:.0f}min) 成功!")
            print(f"   {msg}")
            ready = {
                "status": "ready",
                "endpoint": URL,
                "resource_id": RESOURCE_ID,
                "timestamp": ts,
                "attempt": attempt,
                "elapsed_min": round(elapsed_min, 1),
                "message": msg,
            }
            with open("/tmp/volc_ready.json", "w") as f:
                json.dump(ready, f, ensure_ascii=False, indent=2)
            print(f"\n✅ 写入 /tmp/volc_ready.json")
            print(f"   现在浏览器打开 http://localhost:3000, 点'开始录音'")
            return 0
        # 显示状态
        short = msg[:80].replace("\n", " ")
        print(f"  [{ts}] #{attempt} (t={elapsed_min:.0f}min) [{status}]: {short}")
        print(f"  --- 等 {PROBE_INTERVAL}s ---")
        time.sleep(PROBE_INTERVAL)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n⏹️  停止探测")
        sys.exit(0)
