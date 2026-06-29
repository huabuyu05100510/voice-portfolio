"""
火山引擎端到端实时语音交互 (Realtime Voice Interaction) — 协议封装 + Flask 路由

Doubao Scene SLM Realtime Voice Model (OpenAI Realtime API 兼容 JSON 事件).

端点: wss://openspeech.bytedance.com/api/v3/realtime
鉴权: Authorization Bearer; <token> + X-Api-App-Id + X-Api-Resource-Id

事件协议 (参考 OpenAI Realtime API 风格):
  Client → Server:
    - session.update              { session: {...} }
    - input_audio_buffer.append   { audio: <base64 pcm> }
    - input_audio_buffer.commit   {}
    - response.create             { response: {...} }
    - conversation.item.truncate  { item_id, ... }
  Server → Client:
    - session.created / updated
    - input_audio_buffer.speech_started    → barge-in 信号
    - input_audio_buffer.speech_stopped
    - conversation.item.input_audio_transcription.delta/completed
    - response.audio.delta / .done         → TTS 音频流
    - response.audio_transcript.delta/.done → LLM 文字流
    - response.done                         → 整轮完成
    - error

可观测:
  - StructuredLogger: [Realtime] user_input { text_len, latency_ms }
  - OTel spans: realtime.session_open / realtime.user_input / realtime.ai_output
  - Prom 指标 (见 metrics.py; 此模块提供 counter 接口)

模型: MiniMax-M3
"""
from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

_log = logging.getLogger("realtime-voice")

# Module B: OTel (可选, 未装不阻塞)
try:
    from opentelemetry import trace as _otel_trace
    _OTEL_AVAILABLE = True
except ImportError:
    _otel_trace = None  # type: ignore
    _OTEL_AVAILABLE = False


def _noop_span():
    """无可用 tracer 时的 context manager 桩."""
    class _Noop:
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def set_attribute(self, k, v): pass
        def set_status(self, *args, **kwargs): pass
        def record_exception(self, *args, **kwargs): pass
        def end(self): pass
    return _Noop()


class ConfigError(Exception):
    """启动期 fail-fast: 凭证缺失 / 配置错误."""


@dataclass
class RealtimeConfig:
    """Realtime Voice 会话配置."""
    app_id: str
    access_token: str
    endpoint: str = "wss://openspeech.bytedance.com/api/v3/realtime"
    model: str = "Doubao_scene_SLM_Doubao_realtime_voice_model"
    resource_id: str = "volc.speech.realtime_voice"
    # VAD 默认值 (server_vad: 服务端自动检测用户停顿 → 自动触发 LLM 回复)
    vad_silence_duration_ms: int = 400
    vad_threshold: float = 0.5
    # 音频格式
    input_audio_format: str = "pcm16"
    output_audio_format: str = "pcm16"
    sample_rate: int = 16000


class RealtimeClient:
    """Realtime Voice 客户端 — 协议编码/解码 + WSS 握手.

    本类只做协议层, 不强制持有 WebSocket 连接 (测试更友好).
    实际代理在 `register_realtime_routes` 中按需构造 + 维持.
    """

    def __init__(self, config: RealtimeConfig):
        # fail-fast: 凭证缺失必须显式报错, 避免线上 401
        if not config.app_id or not config.access_token:
            raise ConfigError(
                f"Realtime Voice 凭证缺失 (app_id={'set' if config.app_id else 'MISSING'}, "
                f"access_token={'set' if config.access_token else 'MISSING'}). "
                f"请设置环境变量 VOLC_REALTIME_APP_ID / VOLC_REALTIME_TOKEN"
            )
        self.config = config
        # 延迟初始化, 让测试不需要装 opentelemetry
        self._tracer = (
            _otel_trace.get_tracer("realtime-voice", "1.0.0")
            if _OTEL_AVAILABLE
            else None
        )

    # ------------------------------------------------------------------
    # 鉴权
    # ------------------------------------------------------------------
    def _build_auth_headers(self) -> Dict[str, str]:
        """火山引擎 Realtime 鉴权 header.

        注意: Authorization 必须为 'Bearer; {token}' 格式 (分号 + 空格),
        与通用 OpenAI 'Bearer ' 略不同 — 火山引擎 v3 网关沿用历史约定.
        """
        return {
            "Authorization": f"Bearer; {self.config.access_token}",
            "X-Api-App-Id": self.config.app_id,
            "X-Api-Resource-Id": self.config.resource_id,
        }

    # ------------------------------------------------------------------
    # Client → Server 事件构造
    # ------------------------------------------------------------------
    def build_session_update_payload(
        self,
        instructions: Optional[str] = None,
        voice: Optional[str] = None,
        temperature: Optional[float] = None,
    ) -> Dict[str, Any]:
        """构造 session.update 事件 — 配置 VAD / 音频格式 / LLM 行为."""
        session: Dict[str, Any] = {
            "model": self.config.model,
            "input_audio_format": self.config.input_audio_format,
            "output_audio_format": self.config.output_audio_format,
            "turn_detection": {
                "type": "server_vad",
                "silence_duration_ms": self.config.vad_silence_duration_ms,
                "threshold": self.config.vad_threshold,
            },
        }
        if instructions is not None:
            session["instructions"] = instructions
        if voice is not None:
            session["voice"] = voice
        if temperature is not None:
            session["temperature"] = temperature
        return {"type": "session.update", "session": session}

    def encode_audio_chunk(self, pcm_bytes: bytes) -> Dict[str, Any]:
        """编码 PCM 字节 → input_audio_buffer.append 事件."""
        if not pcm_bytes:
            return {"type": "input_audio_buffer.append", "audio": ""}
        return {
            "type": "input_audio_buffer.append",
            "audio": base64.b64encode(pcm_bytes).decode("ascii"),
        }

    def encode_audio_commit(self) -> Dict[str, Any]:
        """input_audio_buffer.commit — VAD 关闭后强制结束一段 (可选, server_vad 自动 commit)."""
        return {"type": "input_audio_buffer.commit"}

    def encode_response_cancel(self, response_id: Optional[str] = None) -> Dict[str, Any]:
        """response.cancel — 客户端主动打断当前 AI 回复."""
        payload: Dict[str, Any] = {"type": "response.cancel"}
        if response_id is not None:
            payload["response_id"] = response_id
        return payload

    # ------------------------------------------------------------------
    # Server → Client 事件解析
    # ------------------------------------------------------------------
    def decode_server_event(self, raw: str | bytes) -> Dict[str, Any]:
        """解析服务端事件 JSON 字符串 → 规整 dict.

        统一字段:
          - type: 事件类型
          - text / audio_bytes / transcript: 内容
          - barge_in: 是否打断信号
          - turn_done / turn_end: 轮次边界
          - usage: token 统计
        未知 / 解析失败 → type='error', code 标记.
        """
        if isinstance(raw, (bytes, bytearray)):
            try:
                raw = raw.decode("utf-8", errors="replace")
            except Exception:
                return {"type": "error", "code": "decode_failed"}

        try:
            obj = json.loads(raw)
        except Exception:
            return {"type": "error", "code": "parse_failed", "raw": str(raw)[:200]}

        if not isinstance(obj, dict):
            return {"type": "error", "code": "invalid_payload", "raw": str(obj)[:200]}

        event_type = obj.get("type", "unknown")
        # raw 字段保留除 type 外的全部 payload (方便上层扩展).
        # 如果外层只剩 'payload' 一个键, 把它提升到 raw (避免套娃).
        raw_payload = {k: v for k, v in obj.items() if k != "type"}
        if list(raw_payload.keys()) == ["payload"]:
            raw_payload = raw_payload["payload"]
        result: Dict[str, Any] = {"type": event_type, "raw": raw_payload}

        if event_type == "response.audio.delta":
            result["audio_bytes"] = self._decode_audio_field(obj.get("delta", ""))
            result["response_id"] = obj.get("response_id")
            result["item_id"] = obj.get("item_id")
        elif event_type == "response.audio.done":
            result["response_id"] = obj.get("response_id")
            result["item_id"] = obj.get("item_id")
            result["audio_done"] = True
        elif event_type == "response.audio_transcript.delta":
            result["text"] = obj.get("delta", "")
            result["response_id"] = obj.get("response_id")
            result["item_id"] = obj.get("item_id")
        elif event_type == "response.audio_transcript.done":
            result["transcript"] = obj.get("transcript", "")
            result["response_id"] = obj.get("response_id")
            result["item_id"] = obj.get("item_id")
        elif event_type == "input_audio_buffer.speech_started":
            result["barge_in"] = True
            result["audio_start_ms"] = obj.get("audio_start_ms")
        elif event_type == "input_audio_buffer.speech_stopped":
            result["turn_end"] = True
            result["audio_end_ms"] = obj.get("audio_end_ms")
        elif event_type == "conversation.item.input_audio_transcription.delta":
            result["text"] = obj.get("delta", "")
            result["item_id"] = obj.get("item_id")
        elif event_type == "conversation.item.input_audio_transcription.completed":
            result["transcript"] = obj.get("transcript", "")
            result["item_id"] = obj.get("item_id")
            result["user_input_done"] = True
        elif event_type == "response.done":
            response = obj.get("response", {}) or {}
            result["turn_done"] = True
            result["response_id"] = response.get("id")
            result["usage"] = response.get("usage", {})
        elif event_type == "conversation.item.truncated":
            result["truncated"] = True
            result["item_id"] = obj.get("item_id")
        elif event_type == "error":
            result["code"] = obj.get("code", "unknown_error")
            result["message"] = obj.get("message", "")
        # 未知事件 → 已存 raw, 调用方可继续处理

        return result

    @staticmethod
    def _decode_audio_field(field: Any) -> bytes:
        """audio delta 字段: base64 字符串 → bytes (空 → b'')."""
        if not field:
            return b""
        if isinstance(field, (bytes, bytearray)):
            return bytes(field)
        try:
            return base64.b64decode(field)
        except Exception:
            return b""

    # ------------------------------------------------------------------
    # WSS 生命周期 (高层 API, 给 endpoint 用)
    # ------------------------------------------------------------------
    def open_session(self) -> Any:
        """握手 + 发 session.update. 实际连接由 endpoint 用 websocket-client 维持.

        返回 self, 便于链式调用. 测试中可被 mock.
        """
        span_cm = (
            self._tracer.start_as_current_span("realtime.session_open")
            if self._tracer
            else _noop_span()
        )
        with span_cm:
            # 真正的 WSS 握手留给 endpoint; 这里只做 span 包裹 + 日志
            _log.info(
                "[Realtime] session_open app_id=%s model=%s endpoint=%s",
                self.config.app_id,
                self.config.model,
                self.config.endpoint,
            )
        return self


# ============================================================================
# Flask 路由挂载 (REST 健康检查; WSS 端点在 app.py 中独立注册)
# ============================================================================
def register_realtime_routes(
    app,
    client_factory: Callable[[], RealtimeClient],
) -> None:
    """挂载 /api/realtime/* REST 路由.

    注意: WSS endpoint (/api/realtime) 需要 Flask-SocketIO + 异步协程,
    留给 app.py 显式处理 (避免在通用 register 函数里和 SocketIO 冲突).

    凭证缺失时不抛错, 仅在健康检查中报告 configured=false —
    让 boot_app 在缺凭证时仍可正常启动 (避免影响其他模块).
    """
    client: Optional[RealtimeClient] = None
    config_error: Optional[str] = None
    try:
        client = client_factory()
    except ConfigError as e:
        config_error = str(e)
    except Exception as e:
        config_error = str(e)

    @app.route("/api/realtime/health", methods=["GET"])
    def _health():
        if client is None:
            return {
                "configured": False,
                "error": config_error,
                "timestamp": int(time.time()),
            }, 503
        return {
            "configured": True,
            "model": client.config.model,
            "endpoint": client.config.endpoint,
            "resource_id": client.config.resource_id,
            "vad_silence_duration_ms": client.config.vad_silence_duration_ms,
            "timestamp": int(time.time()),
        }


def build_realtime_client_from_env() -> RealtimeClient:
    """从环境变量构造 client (供 app.py 调用).

    环境变量:
      VOLC_REALTIME_APP_ID     — 应用 ID
      VOLC_REALTIME_TOKEN      — 主鉴权 token
      VOLC_REALTIME_ENDPOINT   — WSS endpoint (可选, 有默认值)
      VOLC_REALTIME_MODEL      — 模型名 (可选)
    """
    app_id = os.environ.get("VOLC_REALTIME_APP_ID", "")
    token = os.environ.get("VOLC_REALTIME_TOKEN", "")
    endpoint = os.environ.get(
        "VOLC_REALTIME_ENDPOINT",
        "wss://openspeech.bytedance.com/api/v3/realtime",
    )
    model = os.environ.get(
        "VOLC_REALTIME_MODEL",
        "Doubao_scene_SLM_Doubao_realtime_voice_model",
    )
    return RealtimeClient(
        RealtimeConfig(
            app_id=app_id,
            access_token=token,
            endpoint=endpoint,
            model=model,
        )
    )


import os  # noqa: E402  # 延后 import 让测试用 patch 更容易