"""
file_asr.py — 火山引擎 录音文件识别 2.0 代理

提供三段式 API:
  - submit_file_url(cfg, file_url, ...)  → POST /api/v3/recognitions/bigmodel
  - query_task(cfg, task_id)             → GET  /api/v3/recognitions/bigmodel/query
  - parse_result(raw)                    → 纯函数: 把 raw 响应转成 {text, utterances, speakers}

鉴权:
  - Authorization: Bearer; {token}        (注意分号 + 空格, 火山文档原样)
  - X-Api-Key:    {app_id}
  - X-Cluster:    {cluster}

支持文件: mp3 / wav / m4a / mp4 / mov
限制: 100MB (官方限制), 时长 12h

可观测:
  - 每个外部调用起 OTel span: file_asr.submit / file_asr.query
  - 结构化日志: [FileASR] submit {filename, size} / status {task_id, status}

Author: MiniMax-M3 (2026-06-27)
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

# 可选依赖: requests (外部 HTTP), opentelemetry (trace)
try:
    import requests  # type: ignore
    _REQUESTS_AVAILABLE = True
except ImportError:  # 测试时会被 mock
    requests = None  # type: ignore
    _REQUESTS_AVAILABLE = False

try:
    from opentelemetry import trace as _otel_trace  # type: ignore
    _OTEL_AVAILABLE = True
except ImportError:
    _OTEL_AVAILABLE = False
    _otel_trace = None  # type: ignore

_log = logging.getLogger("file-asr")


# ============================================================================
# 错误
# ============================================================================
class FileAsrError(RuntimeError):
    """统一错误类型, 方便上层 try/except"""

    def __init__(self, message: str, *, code: Optional[str] = None, status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status


# ============================================================================
# 限制
# ============================================================================
MAX_FILE_BYTES = 100 * 1024 * 1024      # 100MB, 官方限制
MAX_DURATION_SEC = 12 * 3600            # 12h
SUPPORTED_EXTS = {".mp3", ".wav", ".m4a", ".mp4", ".mov", ".aac", ".ogg", ".flac"}


# ============================================================================
# 凭据
# ============================================================================
def load_config() -> Dict[str, Any]:
    """
    从环境变量加载配置. 缺关键凭据时抛 RuntimeError.
    """
    app_id = os.environ.get("VOLC_FILE_ASR_APP_ID", "").strip()
    token = os.environ.get("VOLC_FILE_ASR_TOKEN", "").strip()
    cluster = os.environ.get("VOLC_FILE_ASR_CLUSTER", "volc").strip() or "volc"
    if not app_id or not token:
        raise RuntimeError(
            "VOLC_FILE_ASR_APP_ID / VOLC_FILE_ASR_TOKEN 未配置, "
            "请在 .env 写入后重启 server"
        )
    endpoint = os.environ.get(
        "VOLC_FILE_ASR_ENDPOINT",
        "https://openspeech.bytedance.com/api/v3/recognitions/bigmodel",
    ).strip()
    # 默认 submit/query 路径: 同根, query 拼 /query
    submit_path = endpoint
    if not submit_path.endswith("/"):
        submit_path += "/"
    query_path = submit_path + "query"
    return {
        "app_id": app_id,
        "token": token,
        "cluster": cluster,
        "endpoint": endpoint,
        "submit_path": submit_path,
        "query_path": query_path,
    }


# ============================================================================
# OTel
# ============================================================================
def _start_span(name: str, attrs: Optional[Dict[str, Any]] = None):
    if not _OTEL_AVAILABLE:
        class _Noop:
            def __enter__(self_): return self_
            def __exit__(self_, *a): return False
            def set_attribute(self_, k, v): pass
            def set_status(self_, *a, **k): pass
            def record_exception(self_, e): pass
            def end(self_): pass
        return _Noop()
    tracer = _otel_trace.get_tracer("file-asr", "1.0.0")
    return tracer.start_span(name, attributes=attrs or {})


# ============================================================================
# 格式推断
# ============================================================================
_FORMAT_RE = re.compile(r"\.(mp3|wav|m4a|mp4|mov|aac|ogg|flac)(?:\?.*)?$", re.I)


def _infer_format(url: str) -> str:
    m = _FORMAT_RE.search(url)
    return m.group(1).lower() if m else "mp3"


# ============================================================================
# Header 构造
# ============================================================================
def _build_headers(cfg: Dict[str, Any]) -> Dict[str, str]:
    # 官方: "Authorization: Bearer; {token}" (注意分号 + 空格, 不是 "Bearer ")
    # 也有写法 "Bearer {token}" — 用前者优先, 失败 fallback
    return {
        "Authorization": f"Bearer; {cfg['token']}",
        "X-Api-Key": cfg["app_id"],
        "X-Cluster": cfg["cluster"],
        "Content-Type": "application/json",
    }


# ============================================================================
# Submit (POST)
# ============================================================================
def submit_file_url(
    cfg: Dict[str, Any],
    file_url: str,
    *,
    enable_diarization: bool = True,
    speaker_count: int = -1,
    enable_itn: bool = True,
    enable_punc: bool = True,
    model: str = "bigmodel",
    callback_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    提交一个 URL 音频/视频给火山引擎做异步识别.

    Returns:
        dict {task_id, status, raw}
    """
    fmt = _infer_format(file_url)
    body: Dict[str, Any] = {
        "audio": {
            "url": file_url,
            "format": fmt,
        },
        "request": {
            "model": model,
            "enable_diarization": bool(enable_diarization),
            "diarization_speaker_count": int(speaker_count),
            "enable_itn": bool(enable_itn),
            "enable_punc": bool(enable_punc),
            # 词级时间戳 — 客户端可用作高亮 / 跳读
            "enable_word_time_offset": True,
        },
    }
    if callback_url:
        body["request"]["callback_url"] = callback_url

    _log.info(
        "[FileASR] submit { url=%s, format=%s, size_bytes=%d, speaker_count=%d }",
        file_url, fmt, 0, speaker_count,
        extra={"event_type": "file_asr_submit", "metadata": {
            "url": file_url, "format": fmt, "speaker_count": speaker_count,
        }},
    )

    with _start_span("file_asr.submit", {
        "audio.format": fmt, "audio.url": file_url,
        "diarization.speaker_count": speaker_count,
    }) as span:
        try:
            resp = requests.post(
                cfg["submit_path"],
                headers=_build_headers(cfg),
                json=body,
                timeout=30,
            )
            resp.raise_for_status()
        except Exception as e:
            if span and _OTEL_AVAILABLE:
                try:
                    span.record_exception(e)
                    span.set_status(_otel_trace.Status(_otel_trace.StatusCode.ERROR))
                except Exception:
                    pass
            raise FileAsrError(f"submit failed: {e}", status=getattr(getattr(e, 'response', None), 'status_code', None))

        try:
            data = resp.json()
        except Exception as e:
            raise FileAsrError(f"submit invalid json: {e}")

    if data.get("code") != 0:
        raise FileAsrError(
            f"submit business error: {data.get('message', 'unknown')}",
            code=str(data.get("code")),
        )

    d = data.get("data") or {}
    task_id = d.get("task_id")
    if not task_id:
        raise FileAsrError("submit missing task_id in response")
    return {
        "task_id": task_id,
        "status": (d.get("status") or "queued").lower(),
        "raw": data,
    }


# ============================================================================
# Query (GET)
# ============================================================================
def query_task(cfg: Dict[str, Any], task_id: str) -> Dict[str, Any]:
    """
    查询任务状态 / 结果. 当 status=done 时, data 还会带 utterances.
    """
    with _start_span("file_asr.query", {"task.id": task_id}) as span:
        try:
            resp = requests.get(
                cfg["query_path"],
                headers=_build_headers(cfg),
                params={"task_id": task_id},
                timeout=20,
            )
            resp.raise_for_status()
        except Exception as e:
            if span and _OTEL_AVAILABLE:
                try:
                    span.record_exception(e)
                    span.set_status(_otel_trace.Status(_otel_trace.StatusCode.ERROR))
                except Exception:
                    pass
            raise FileAsrError(
                f"query failed: {e}",
                status=getattr(getattr(e, 'response', None), 'status_code', None),
            )
        try:
            data = resp.json()
        except Exception as e:
            raise FileAsrError(f"query invalid json: {e}")

    if data.get("code") != 0:
        raise FileAsrError(
            f"query business error: {data.get('message', 'unknown')}",
            code=str(data.get("code")),
        )

    d = data.get("data") or {}
    raw_status = (d.get("status") or "unknown").lower()
    out: Dict[str, Any] = {
        "task_id": d.get("task_id") or task_id,
        "status": _normalize_status(raw_status),
        "raw": data,
    }
    if "utterances" in d:
        out["utterances"] = d["utterances"]
    if "error" in d:
        out["error"] = d["error"]
    if "audio_info" in d:
        out["audio_info"] = d["audio_info"]
    return out


def _normalize_status(s: str) -> str:
    """火山引擎状态字符串归一化到小写枚举"""
    s = (s or "").lower()
    mapping = {
        "queued": "queued",
        "queueing": "queued",
        "pending": "queued",
        "running": "running",
        "processing": "running",
        "in_progress": "running",
        "done": "done",
        "succeeded": "done",
        "success": "done",
        "completed": "done",
        "failed": "failed",
        "failure": "failed",
        "error": "failed",
    }
    return mapping.get(s, s)


# ============================================================================
# 纯函数: 解析结果
# ============================================================================
def parse_result(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    把 query 任务的 raw data 转成与实时转写 reducer 兼容的格式:
        {text, utterances, speakers}
    utterances: [{text, start_time, end_time, speaker_id, words}]
    speakers:   [{id}]

    缺字段 / 错格式不抛, 走兜底空值. 纯函数, 易测.
    """
    utterances: List[Dict[str, Any]] = []
    speakers_seen: List[str] = []
    speaker_idx: Dict[str, int] = {}

    raw_utts = (raw or {}).get("utterances") or []
    for u in raw_utts:
        if not isinstance(u, dict):
            continue
        utt: Dict[str, Any] = {
            "text": u.get("text") or "",
            "start_time": u.get("start_time") or u.get("startTime") or 0,
            "end_time": u.get("end_time") or u.get("endTime") or 0,
            "speaker_id": u.get("speaker_id") or u.get("speakerId") or "unknown",
            "definite": u.get("definite", True),
        }
        # 词级时间戳: 火山 raw words 字段是 {text, start_time, end_time} 或 {word, start, end}
        if isinstance(u.get("words"), list):
            ws = []
            for w in u["words"]:
                if not isinstance(w, dict):
                    continue
                ws.append({
                    "word": w.get("text") or w.get("word") or "",
                    "start": w.get("start_time") or w.get("startTime") or w.get("start") or 0,
                    "end": w.get("end_time") or w.get("endTime") or w.get("end") or 0,
                    "confidence": w.get("confidence", 1.0),
                })
            if ws:
                utt["words"] = ws
        utterances.append(utt)
        spk = utt["speaker_id"]
        if spk and spk not in speaker_idx:
            speaker_idx[spk] = len(speakers_seen)
            speakers_seen.append(spk)

    # 拼文本
    text = "".join((u["text"] for u in utterances))
    return {
        "text": text,
        "utterances": utterances,
        "speakers": [{"id": s} for s in speakers_seen],
    }


# ============================================================================
# 校验
# ============================================================================
def validate_file_meta(
    *,
    filename: str,
    size_bytes: int,
    duration_sec: Optional[float] = None,
) -> Tuple[bool, str]:
    """
    上传前校验: 扩展名 + 大小 + 可选时长.
    Returns: (ok, reason). reason 永远是非空字符串 (失败时是错误原因).
    """
    if not filename:
        return False, "filename is required"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in SUPPORTED_EXTS:
        return False, f"unsupported format: {ext or '(none)'} (supported: {', '.join(sorted(SUPPORTED_EXTS))})"
    if size_bytes <= 0:
        return False, "file is empty"
    if size_bytes > MAX_FILE_BYTES:
        return False, f"file too large: {size_bytes} > {MAX_FILE_BYTES} bytes"
    if duration_sec is not None and duration_sec > MAX_DURATION_SEC:
        return False, f"file too long: {duration_sec}s > {MAX_DURATION_SEC}s"
    return True, "ok"


# ============================================================================
# Flask 路由注册
# ============================================================================
def register_routes(app):
    """
    把 /api/file-asr/* 三个 endpoint 挂到 Flask app.
    行为:
      POST /api/file-asr/submit   { file_url?, file_meta? }  → { task_id, status }
      GET  /api/file-asr/status/<task_id>                    → { task_id, status, utterances? }
      GET  /api/file-asr/result/<task_id>                    → { text, utterances, speakers }

    submit 支持两种入参:
      A) JSON:  { file_url, enable_diarization, speaker_count }
      B) multipart: file=@audio.mp3   (先存到 /tmp 再走本地 URL, 当前版本仅支持 A)
    """
    from flask import request, jsonify

    def _cfg():
        try:
            return load_config(), None
        except RuntimeError as e:
            return None, str(e)

    @app.post("/api/file-asr/submit")
    def _submit():
        cfg, err = _cfg()
        if cfg is None:
            return jsonify({"error": err, "code": "config_missing"}), 503
        data = request.get_json(silent=True) or {}
        file_url = data.get("file_url") or data.get("url")
        if not file_url:
            return jsonify({"error": "file_url is required"}), 400
        try:
            r = submit_file_url(
                cfg,
                file_url=file_url,
                enable_diarization=bool(data.get("enable_diarization", True)),
                speaker_count=int(data.get("speaker_count", -1)),
                enable_itn=bool(data.get("enable_itn", True)),
                enable_punc=bool(data.get("enable_punc", True)),
                model=str(data.get("model", "bigmodel")),
                callback_url=data.get("callback_url"),
            )
            return jsonify(r)
        except FileAsrError as e:
            _log.error("[FileASR] submit error: %s", e)
            return jsonify({"error": str(e), "code": e.code}), e.status or 502

    @app.get("/api/file-asr/status/<task_id>")
    def _status(task_id: str):
        cfg, err = _cfg()
        if cfg is None:
            return jsonify({"error": err, "code": "config_missing"}), 503
        try:
            r = query_task(cfg, task_id)
            return jsonify(r)
        except FileAsrError as e:
            _log.error("[FileASR] query error: %s", e)
            return jsonify({"error": str(e), "code": e.code}), e.status or 502

    @app.get("/api/file-asr/result/<task_id>")
    def _result(task_id: str):
        cfg, err = _cfg()
        if cfg is None:
            return jsonify({"error": err, "code": "config_missing"}), 503
        try:
            r = query_task(cfg, task_id)
            parsed = parse_result(r.get("raw", {}).get("data") or {})
            return jsonify({
                "task_id": task_id,
                "status": r["status"],
                **parsed,
            })
        except FileAsrError as e:
            _log.error("[FileASR] result error: %s", e)
            return jsonify({"error": str(e), "code": e.code}), e.status or 502
