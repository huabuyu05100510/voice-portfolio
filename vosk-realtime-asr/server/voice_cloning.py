"""
火山引擎 声音复刻 2.0 (Voice Cloning 2.0) — 服务端代理

调研基础 (项目内已知 / 公网文档均适用):
  - 鉴权: X-Api-Key (新控制台) 或 X-Api-App-Key + X-Api-Access-Key (旧)
  - 训练音频: 单声道, 16kHz+, PCM/WAV/MP3, 建议 10s ~ 5min
  - 训练: 异步, 通常几秒 ~ 几分钟
  - Voice ID: S_xxx 风格 (e.g. S_f5W7pQJX1)
  - 音色管理: list / create (训练触发) / delete

API endpoints (REST, JSON over HTTPS):
  POST  /voice/upload      上传训练音频 → audio_id
  POST  /voice/train       触发训练 → task_id, voice_id, status='training'
  GET   /voice/train/status?task_id=xxx  轮询 → status (training/success/failed)
  GET   /voice/list?speaker_id=xxx       列出用户音色
  DELETE /voice/delete?voice_id=xxx      删除音色

可观测:
  - 结构化日志: logger.info("[VoiceCloning] upload {duration_s, size_bytes}")
  - OTel span: voice.upload / voice.train / voice.train.status
  - Prom 指标: voice_upload_total / voice_train_total / voice_train_duration_seconds

凭证 (env):
  VOLC_VOICE_CLONE_APP_ID     旧控制台 appid
  VOLC_VOICE_CLONE_TOKEN      旧控制台 access token
  VOLC_VOICE_CLONE_API_KEY    新控制台 API Key (优先使用)

模型: MiniMax-M3
"""
from __future__ import annotations

import io
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

try:
    import requests  # type: ignore
except ImportError:  # 让测试能 mock _http_post/_http_get/_http_delete (不需要真实 requests)
    requests = None  # type: ignore


# ============================================================================
# 错误
# ============================================================================
class VoiceCloningError(Exception):
    """声音复刻基础错误."""
    pass


class VoiceCloningConfigError(VoiceCloningError):
    """凭证 / 配置缺失 — 启动期 fail-fast."""
    pass


class VoiceCloningHttpError(VoiceCloningError):
    """HTTP 非 2xx — 含 status_code + body 摘要."""
    def __init__(self, status_code: int, body: Any, message: Optional[str] = None):
        self.status_code = status_code
        self.body = body
        super().__init__(message or f"HTTP {status_code}: {str(body)[:200]}")


# ============================================================================
# 配置
# ============================================================================
@dataclass
class VoiceCloningConfig:
    app_id: str = ""
    access_token: str = ""
    api_key: str = ""
    endpoint: str = "https://openspeech.bytedance.com/api/voice_cloning"
    resource_id: str = "volc.voice_cloning.2_0"
    timeout: float = 30.0
    poll_interval_sec: float = 2.0
    poll_max_wait_sec: float = 600.0  # 训练最长等 10 min

    def has_credentials(self) -> bool:
        return bool(self.api_key) or bool(self.app_id and self.access_token)

    def validate(self) -> None:
        if not self.endpoint:
            raise VoiceCloningConfigError("endpoint 不能为空")
        if not self.has_credentials():
            raise VoiceCloningConfigError(
                "声音复刻凭证缺失 — 请配置 VOLC_VOICE_CLONE_API_KEY "
                "(或 VOLC_VOICE_CLONE_APP_ID + VOLC_VOICE_CLONE_TOKEN)"
            )


# ============================================================================
# OTel tracer (兼容未安装场景 — no-op)
# ============================================================================
class _NoopSpan:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def set_attribute(self, k, v):
        pass


class _NoopTracer:
    def start_as_current_span(self, name: str):
        return _NoopSpan()


def _build_tracer() -> Any:
    try:
        from opentelemetry import trace  # type: ignore
        return trace.get_tracer("voice_cloning")
    except Exception:
        return _NoopTracer()


# ============================================================================
# 客户端
# ============================================================================
class VoiceCloningClient:
    """
    声音复刻 2.0 客户端 — 纯函数式 (便于 mock).
    HTTP 层用 _http_post / _http_get / _http_delete 三个可注入方法.
    """

    def __init__(self, config: VoiceCloningConfig):
        config.validate()
        self.config = config
        self._tracer = _build_tracer()

    # ------------------------------------------------------------------ 鉴权
    def _build_auth_headers(self) -> Dict[str, str]:
        cfg = self.config
        headers: Dict[str, str] = {
            "X-Api-Resource-Id": cfg.resource_id,
            "Authorization": f"Bearer; {cfg.api_key or cfg.access_token}",
        }
        if cfg.api_key:
            # 新控制台: 单一 X-Api-Key
            headers["X-Api-Key"] = cfg.api_key
        else:
            # 旧控制台: 双 header
            headers["X-Api-App-Key"] = cfg.app_id
            headers["X-Api-Access-Key"] = cfg.access_token
        return headers

    # ------------------------------------------------------------------ HTTP 层 (可注入)
    def _http_post(self, url: str, *, data=None, files=None, json=None,
                   headers=None, timeout=None):
        if requests is None:
            raise VoiceCloningError("requests 库未安装, 无法发送 HTTP 请求")
        merged_headers = dict(self._build_auth_headers())
        if headers:
            merged_headers.update(headers)
        return requests.post(
            url,
            data=data, files=files, json=json,
            headers=merged_headers,
            timeout=timeout if timeout is not None else self.config.timeout,
        )

    def _http_get(self, url: str, *, params=None, headers=None, timeout=None):
        if requests is None:
            raise VoiceCloningError("requests 库未安装, 无法发送 HTTP 请求")
        merged_headers = dict(self._build_auth_headers())
        if headers:
            merged_headers.update(headers)
        return requests.get(
            url, params=params, headers=merged_headers,
            timeout=timeout if timeout is not None else self.config.timeout,
        )

    def _http_delete(self, url: str, *, params=None, headers=None, timeout=None):
        if requests is None:
            raise VoiceCloningError("requests 库未安装, 无法发送 HTTP 请求")
        merged_headers = dict(self._build_auth_headers())
        if headers:
            merged_headers.update(headers)
        return requests.delete(
            url, params=params, headers=merged_headers,
            timeout=timeout if timeout is not None else self.config.timeout,
        )

    # ------------------------------------------------------------------ 业务方法
    def upload_audio(self, pcm_bytes: bytes, sample_rate: int = 16000,
                     speaker_id: str = "") -> Dict[str, Any]:
        """
        上传训练音频 (multipart/form-data).

        Returns: { audio_id, duration, sample_rate }
        """
        if not pcm_bytes:
            raise ValueError("音频数据为空 (empty PCM), 请先录制")
        if sample_rate < 16000:
            raise ValueError(
                f"采样率 {sample_rate} 低于 16000 — 声音复刻 2.0 要求 ≥ 16kHz 单声道 PCM"
            )

        # PCM bytes 转 WAV (16-bit mono) — 火山引擎 audio 字段期望标准容器
        wav_bytes = _pcm_to_wav(pcm_bytes, sample_rate=sample_rate, channels=1, sample_width=2)
        duration = len(pcm_bytes) / (sample_rate * 2)  # 16-bit = 2 bytes/sample

        with self._tracer.start_as_current_span("voice.upload") as span:
            span.set_attribute("audio.duration_s", duration)
            span.set_attribute("audio.size_bytes", len(wav_bytes))
            span.set_attribute("audio.sample_rate", sample_rate)
            url = f"{self.config.endpoint}/voice/upload"
            resp = self._http_post(
                url,
                files={"audio": ("voice_sample.wav", io.BytesIO(wav_bytes), "audio/wav")},
                data={"speaker_id": speaker_id, "sample_rate": str(sample_rate)},
            )
            body = _parse_response(resp)
            return body.get("data", body)

    def train(self, audio_id: str, speaker_id: str = "",
              voice_name: str = "我的声音") -> Dict[str, Any]:
        """
        触发训练 (异步). 返回 { task_id, voice_id, status }.
        """
        body = {
            "audio_id": audio_id,
            "speaker_id": speaker_id,
            "voice_name": voice_name,
        }
        with self._tracer.start_as_current_span("voice.train") as span:
            span.set_attribute("voice.name", voice_name)
            span.set_attribute("voice.speaker_id", speaker_id)
            url = f"{self.config.endpoint}/voice/train"
            resp = self._http_post(url, json=body)
            data = _parse_response(resp).get("data", {})
            span.set_attribute("voice.voice_id", data.get("voice_id", ""))
            span.set_attribute("voice.task_id", data.get("task_id", ""))
            return data

    def get_train_status(self, task_id: str) -> Dict[str, Any]:
        """轮询训练状态 — 返回 { status: training|success|failed, voice_id?, error? }."""
        with self._tracer.start_as_current_span("voice.train.status") as span:
            span.set_attribute("voice.task_id", task_id)
            url = f"{self.config.endpoint}/voice/train/status"
            resp = self._http_get(url, params={"task_id": task_id})
            data = _parse_response(resp).get("data", {})
            span.set_attribute("voice.status", data.get("status", ""))
            return data

    def list_voices(self, speaker_id: str = "") -> List[Dict[str, Any]]:
        """列出某用户下所有音色."""
        with self._tracer.start_as_current_span("voice.list") as span:
            span.set_attribute("voice.speaker_id", speaker_id)
            url = f"{self.config.endpoint}/voice/list"
            resp = self._http_get(url, params={"speaker_id": speaker_id})
            data = _parse_response(resp).get("data", {})
            return data.get("voices", [])

    def delete_voice(self, voice_id: str) -> Dict[str, Any]:
        """删除指定音色 (返回 { code, message })."""
        with self._tracer.start_as_current_span("voice.delete") as span:
            span.set_attribute("voice.voice_id", voice_id)
            url = f"{self.config.endpoint}/voice/delete"
            resp = self._http_delete(url, params={"voice_id": voice_id})
            return _parse_response(resp)

    # ------------------------------------------------------------------ 高层便捷
    def train_and_wait(self, audio_id: str, speaker_id: str = "",
                       voice_name: str = "我的声音",
                       on_progress: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
        """触发训练 + 轮询, 直到 success / failed / 超时."""
        started = time.time()
        initial = self.train(audio_id, speaker_id=speaker_id, voice_name=voice_name)
        task_id = initial.get("task_id", "")
        voice_id = initial.get("voice_id", "")
        deadline = started + self.config.poll_max_wait_sec
        attempt = 0
        while time.time() < deadline:
            attempt += 1
            state = self.get_train_status(task_id)
            status = state.get("status", "training")
            if on_progress:
                try:
                    on_progress(status)
                except Exception:
                    pass
            if status == "success":
                return {
                    "voice_id": state.get("voice_id") or voice_id,
                    "task_id": task_id,
                    "status": "success",
                    "duration_sec": round(time.time() - started, 2),
                    "poll_attempts": attempt,
                }
            if status == "failed":
                return {
                    "voice_id": voice_id,
                    "task_id": task_id,
                    "status": "failed",
                    "error": state.get("error"),
                    "duration_sec": round(time.time() - started, 2),
                    "poll_attempts": attempt,
                }
            time.sleep(self.config.poll_interval_sec)
        return {
            "voice_id": voice_id,
            "task_id": task_id,
            "status": "timeout",
            "duration_sec": round(time.time() - started, 2),
            "poll_attempts": attempt,
        }


# ============================================================================
# 工具
# ============================================================================
def _parse_response(resp) -> Dict[str, Any]:
    """解析火山引擎 HTTP 响应 — 失败抛 VoiceCloningHttpError."""
    status = getattr(resp, "status_code", 0)
    if status < 200 or status >= 300:
        try:
            body = resp.json()
        except Exception:
            body = {"raw": getattr(resp, "text", "")[:500]}
        raise VoiceCloningHttpError(status, body)
    try:
        body = resp.json()
    except Exception as e:
        raise VoiceCloningError(f"响应 JSON 解析失败: {e}")
    # 火山引擎: code=0 表示成功
    if isinstance(body, dict) and body.get("code", 0) != 0:
        raise VoiceCloningHttpError(status, body, message=f"业务错误: code={body.get('code')}")
    return body


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 16000,
                channels: int = 1, sample_width: int = 2) -> bytes:
    """
    裸 PCM → WAV (44 字节 RIFF header + PCM data).
    声音复刻 2.0 接受 WAV 容器, 直接喂 PCM raw 易被某些版本拒.
    """
    import struct
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(sample_width)
        w.setframerate(sample_rate)
        w.writeframes(pcm_bytes)
    return buf.getvalue()


# ============================================================================
# Flask 路由注册
# ============================================================================
def register_voice_cloning_routes(flask_app, *,
                                  client_factory: Callable[[], VoiceCloningClient]) -> None:
    """
    把 4 个 endpoint 挂到 flask_app.

    启动期会调 client_factory() 一次以验证凭证 (fail-fast).
    """
    # 启动期 fail-fast — 凭证缺失立刻报错, 避免线上 401
    client_factory()

    from flask import request, jsonify

    @flask_app.route("/api/voice/upload", methods=["POST"])
    def api_voice_upload():
        if "audio" not in request.files:
            return jsonify({"error": "缺少 audio 字段 (multipart/form-data)"}), 400
        f = request.files["audio"]
        speaker_id = request.form.get("speaker_id", "")
        try:
            sample_rate = int(request.form.get("sample_rate", "16000"))
        except ValueError:
            sample_rate = 16000
        audio_bytes = f.read()
        try:
            client = client_factory()
            result = client.upload_audio(
                audio_bytes,
                sample_rate=sample_rate,
                speaker_id=speaker_id,
            )
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except VoiceCloningHttpError as e:
            return jsonify({"error": str(e), "status_code": e.status_code}), e.status_code
        return jsonify(result), 200

    @flask_app.route("/api/voice/train", methods=["POST"])
    def api_voice_train():
        body = request.get_json(silent=True) or {}
        audio_id = body.get("audio_id", "")
        voice_name = body.get("voice_name", "我的声音")
        speaker_id = body.get("speaker_id", "")
        if not audio_id:
            return jsonify({"error": "缺少 audio_id"}), 400
        try:
            client = client_factory()
            result = client.train(audio_id=audio_id, speaker_id=speaker_id, voice_name=voice_name)
        except VoiceCloningHttpError as e:
            return jsonify({"error": str(e), "status_code": e.status_code}), e.status_code
        return jsonify(result), 200

    @flask_app.route("/api/voice/train/status", methods=["GET"])
    def api_voice_train_status():
        task_id = request.args.get("task_id", "")
        if not task_id:
            return jsonify({"error": "缺少 task_id (query param)"}), 400
        try:
            client = client_factory()
            result = client.get_train_status(task_id=task_id)
        except VoiceCloningHttpError as e:
            return jsonify({"error": str(e), "status_code": e.status_code}), e.status_code
        return jsonify(result), 200

    @flask_app.route("/api/voice/list", methods=["GET"])
    def api_voice_list():
        speaker_id = request.args.get("speaker_id", "")
        try:
            client = client_factory()
            voices = client.list_voices(speaker_id=speaker_id)
        except VoiceCloningHttpError as e:
            return jsonify({"error": str(e), "status_code": e.status_code}), e.status_code
        return jsonify({"voices": voices}), 200

    @flask_app.route("/api/voice/delete", methods=["DELETE"])
    def api_voice_delete():
        voice_id = request.args.get("voice_id", "")
        if not voice_id:
            return jsonify({"error": "缺少 voice_id (query param)"}), 400
        try:
            client = client_factory()
            result = client.delete_voice(voice_id=voice_id)
        except VoiceCloningHttpError as e:
            return jsonify({"error": str(e), "status_code": e.status_code}), e.status_code
        return jsonify(result), 200


# ============================================================================
# 工厂: 从 env 构造 client (供 app.py 用)
# ============================================================================
def make_voice_cloning_client_from_env() -> VoiceCloningClient:
    """从环境变量读凭证, 构造 client. 凭证缺失会抛 VoiceCloningConfigError."""
    cfg = VoiceCloningConfig(
        app_id=os.environ.get("VOLC_VOICE_CLONE_APP_ID", ""),
        access_token=os.environ.get("VOLC_VOICE_CLONE_TOKEN", ""),
        api_key=os.environ.get("VOLC_VOICE_CLONE_API_KEY", ""),
        endpoint=os.environ.get(
            "VOLC_VOICE_CLONE_ENDPOINT",
            "https://openspeech.bytedance.com/api/voice_cloning",
        ),
        resource_id=os.environ.get(
            "VOLC_VOICE_CLONE_RESOURCE_ID", "volc.voice_cloning.2_0"
        ),
    )
    return VoiceCloningClient(cfg)
