"""
火山引擎会话 (VolcengineSession) — v3 协议

每个 sid 一条独立 WSS 长连接, 后台读线程负责解析服务端响应并回调。

协议: v3/sauc/bigmodel_async
- 端点: wss://openspeech.bytedance.com/api/v3/sauc/{resource_id}
- 鉴权: X-Api-App-Key + X-Api-Access-Key + X-Api-Resource-Id (+ Request-Id / Connect-Id)
- 二进制帧: 4B header + 4B size + gzip(payload)
- payload JSON 顶层只有 user/audio/request
- 第一帧: 0x1 full request (config only, 不带音频)
- 后续: 0x2 audio-only (PCM + gzip), 最后一帧 flags=0x2 (LAST)

生命周期:
    sess = VolcengineSession(sid, config, on_partial, on_final, on_error)
    sess.start()                  # 异步握手 + 发 full request
    sess.send_audio(chunk)        # 持续推 audio-only 帧
    sess.finalize(last_chunk)     # 发 LAST 帧, 通知服务端结束
    sess.close()                  # 关闭 WSS, 回收读线程

回调签名:
    on_partial(text: str, sid: str)
    on_final(text: str, utterances: list, speakers: list, latency_ms: float = None, sid: str = None)
    on_error(code: int, message: str, sid: str = None)
"""
from __future__ import annotations

import json
import threading
import time
import traceback
from typing import Callable, Optional

# websocket-client 提供同步 API, 用 thread 跑读循环最简单
try:
    from websocket import create_connection, WebSocketTimeoutException, WebSocketConnectionClosedException
except ImportError:
    create_connection = None  # 测试时会被 mock

from volcengine_engine import (
    build_full_request_payload,
    build_ws_headers,
    encode_audio_last,
    encode_audio_only,
    encode_full_client_request,
    parse_server_response,
    parse_server_response_v3,
    extract_utterances as _extract_utterances_and_speakers,
)


# ============================================================================
# Session 类
# ============================================================================
class VolcengineSession:
    """
    单 sid 的火山引擎会话 (v3)。

    注意:
    - 所有回调在读线程里调用, 业务侧应自行保证线程安全
      (Flask-SocketIO 在 threading 模式下天然安全)
    - send_audio 不阻塞, 直接 send_binary
    - finalize 后, WSS 不会主动关闭, 仍可继续 recv 直到 on_final 触发
    """

    def __init__(
        self,
        sid: str,
        config: dict,
        on_partial: Callable,
        on_final: Callable,
        on_error: Callable,
        enable_diarization: bool = True,
        extra_request: dict = None,
        platform: str = "Web",
    ):
        self.sid = sid
        self.config = config
        self.on_partial = on_partial
        self.on_final = on_final
        self.on_error = on_error
        self.enable_diarization = enable_diarization
        self.extra_request = extra_request
        self.platform = platform

        self._ws = None
        self._reader_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._opened = False
        self._opened_at: Optional[float] = None

        # 可观测: 内部 metrics
        self._audio_bytes_sent = 0
        self._frames_sent = 0

    # ------------------------------------------------------------------
    # 公开 API
    # ------------------------------------------------------------------
    def start(self) -> None:
        """非阻塞启动: 握手 + 发 full request + 起读线程"""
        if self._reader_thread and self._reader_thread.is_alive():
            return
        self._stop_event.clear()
        self._reader_thread = threading.Thread(
            target=self._run, daemon=True, name=f"volc-{self.sid[:6]}"
        )
        self._reader_thread.start()

    def send_audio(self, audio: bytes) -> None:
        """发送一段音频 (audio-only 帧, 不含 LAST)"""
        if not self._ws or not self._opened:
            return
        if not audio:
            return
        with self._lock:
            try:
                self._ws.send_binary(encode_audio_only(audio))
                self._audio_bytes_sent += len(audio)
                self._frames_sent += 1
            except Exception as e:
                self.on_error(0, f"send_audio failed: {e}", sid=self.sid)
                self._stop_event.set()

    def finalize(self, last_audio: bytes = b"") -> None:
        """发送最后一帧 (带 LAST flag), 通知服务端结束"""
        if not self._ws or not self._opened:
            return
        with self._lock:
            try:
                payload = last_audio if last_audio else b"\x00\x00"
                self._ws.send_binary(encode_audio_last(payload))
                self._frames_sent += 1
            except Exception as e:
                self.on_error(0, f"finalize failed: {e}", sid=self.sid)

    def close(self) -> None:
        """关闭 WSS + 回收线程"""
        self._stop_event.set()
        try:
            if self._ws:
                self._ws.close()
        except Exception:
            pass
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=1.0)
        self._reader_thread = None
        self._opened = False

    def is_alive(self) -> bool:
        return self._reader_thread is not None and self._reader_thread.is_alive() and self._opened

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------
    def _run(self) -> None:
        """读线程主循环"""
        try:
            self._handshake_and_send_config()
        except Exception as e:
            self.on_error(0, f"handshake failed: {e}", sid=self.sid)
            return

        # 读循环
        try:
            while not self._stop_event.is_set():
                if not self._ws:
                    break
                try:
                    self._ws.settimeout(0.5)
                    data = self._ws.recv()
                except WebSocketTimeoutException:
                    continue
                except WebSocketConnectionClosedException:
                    break
                except Exception as e:
                    err_str = str(e)
                    if "timeout" in err_str.lower():
                        continue
                    self.on_error(0, f"recv error: {e}", sid=self.sid)
                    break
                self._handle_frame(data)
        except Exception as e:
            self.on_error(0, f"reader crashed: {e}\n{traceback.format_exc()}", sid=self.sid)

    def _handshake_and_send_config(self) -> None:
        """握手 + 发 0x1 full request (v3 风格: config only, 不带音频)"""
        if create_connection is None:
            raise RuntimeError("websocket-client not installed")

        url = self.config["endpoint"]
        headers = build_ws_headers(
            app_key=self.config["app_key"],
            access_token=self.config["access_token"],
            resource_id=self.config["resource_id"],
            api_key=self.config.get("api_key"),  # 新控制台 X-Api-Key
        )
        self._ws = create_connection(url, header=headers, timeout=10)
        self._opened = True
        self._opened_at = time.time()

        payload = build_full_request_payload(
            app_key=self.config["app_key"],
            access_token=self.config["access_token"],
            model_name=self.config.get("model_name", "bigmodel"),
            uid=f"web-{self.sid[:12]}",
            enable_diarization=self.enable_diarization,
            enable_punc=True,
            enable_itn=True,
            platform=self.platform,
            extra_request=self.extra_request,
            # ⭐ 自动检测任意数量说话人 (默认 -1)
            diarization_speaker_count=-1,
        )
        with self._lock:
            self._ws.send_binary(encode_full_client_request(payload))
            self._frames_sent += 1

    def _handle_frame(self, data) -> None:
        """解析单帧并分发到回调"""
        if isinstance(data, str):
            try:
                obj = json.loads(data)
                self.on_error(0, f"server text frame: {obj}", sid=self.sid)
            except Exception:
                pass
            return
        if not isinstance(data, (bytes, bytearray)):
            return

        try:
            # v3/sauc/bigmodel_async 端点 (实测确认), flags bit0 = has seq
            parsed = parse_server_response_v3(bytes(data))
        except Exception as e:
            self.on_error(0, f"parse failed: {e}", sid=self.sid)
            return

        ptype = parsed["type"]
        payload = parsed["payload"]

        if ptype == "error":
            code = payload.get("code", 0) or payload.get("backend_code", 0)
            msg = payload.get("message") or payload.get("_raw") or json.dumps(payload, ensure_ascii=False)
            self.on_error(code, str(msg), sid=self.sid)
            return

        if ptype == "partial":
            text = (payload.get("result") or {}).get("text", "")
            if text:
                self.on_partial(text, sid=self.sid)
            return

        if ptype == "final":
            latency_ms = (time.time() - self._opened_at) * 1000 if self._opened_at else 0
            result = payload.get("result") or payload
            text = result.get("text", "")
            utterances, speakers = _extract_utterances_and_speakers(result)
            self.on_final(text, utterances, speakers, latency_ms=latency_ms, sid=self.sid)
            return

        if ptype == "full":
            # 0x9 ack / partial full result; 都忽略 (等 final)
            # 但是如果 full 帧里已经有 utterances, 当作 final 处理
            result = payload.get("result") or {}
            if isinstance(result, dict) and result.get("utterances"):
                latency_ms = (time.time() - self._opened_at) * 1000 if self._opened_at else 0
                text = result.get("text", "")
                utterances, speakers = _extract_utterances_and_speakers(result)
                self.on_final(text, utterances, speakers, latency_ms=latency_ms, sid=self.sid)
            return

        # 未知类型, 忽略
        return
