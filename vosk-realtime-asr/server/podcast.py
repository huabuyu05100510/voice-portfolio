"""
语音播客大模型 — 后端代理
==========================

封装火山引擎"语音播客大模型"API (假设端点 + 协议结构见 docs/2026-06-27-podcast-llm-tech-proposal.md).

注意: 本模块实现为可独立单测 / 可 mock. 真实 HTTPS 调用通过 call_podcast_api()
进行, 可在测试中用 monkeypatch 替换。

对外:
- STYLES, DURATIONS: 风格 / 长度枚举
- parse_script(raw): 主持脚本解析 (A/B → host_a/host_b)
- validate_request(payload): 输入校验
- PodcastConfig, PodcastResult, HostTurn, PodcastChapter: 数据类
- generate_podcast(transcript, style, duration, include_audio_clip, config): 顶层编排
- poll_podcast_task(task_id, config): 异步任务轮询
- PodcastUpstreamError, PodcastTaskNotFound: 领域异常
- podcast_metrics: Prometheus 指标聚合 (可选注入)

接入: 由 server/app.py 在 boot_app() 中调用 register_podcast_routes(app) 挂载到 /api/podcast/*.
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple


# ============================================================================
# 枚举 (供 UI 与 validate 共用)
# ============================================================================
STYLES: Dict[str, Dict[str, str]] = {
    "tech": {
        "label": "科技",
        "description": "聚焦技术原理与产品创新, 语言偏工程师向",
    },
    "business": {
        "label": "商业",
        "description": "聚焦市场趋势与商业策略, 适合投研 / 战略评审",
    },
    "entertainment": {
        "label": "娱乐",
        "description": "轻松幽默叙事, 适合大众科普与品牌营销",
    },
    "academic": {
        "label": "学术",
        "description": "严谨结构化, 适合研究汇报与论文导读",
    },
}

DURATIONS: Dict[str, Dict[str, Any]] = {
    "short": {
        "label": "短",
        "target_seconds": 60,
        "async": False,  # 同步直接返回
    },
    "medium": {
        "label": "中",
        "target_seconds": 180,
        "async": True,
    },
    "long": {
        "label": "长",
        "target_seconds": 360,
        "async": True,
    },
}

# 限制
MAX_TRANSCRIPT_CHARS = 50_000
DEFAULT_STYLE = "tech"
DEFAULT_DURATION = "short"


# ============================================================================
# 数据类
# ============================================================================
@dataclass
class PodcastConfig:
    """播客大模型凭证 + 端点配置 (从 Config / env 注入, 不在源码中写真值)"""
    app_id: str = ""
    token: str = ""
    api_key: Optional[str] = None  # 新控制台: X-Api-Key 单一鉴权
    resource_id: str = "volc.podcast.llm.duration"
    endpoint: str = "https://openspeech.bytedance.com/api/v3/podcast/generate"

    def has_credentials(self) -> bool:
        """是否配置了足够的鉴权信息"""
        return bool(self.api_key) or (bool(self.app_id) and bool(self.token))

    def is_new_console(self) -> bool:
        return bool(self.api_key)


@dataclass
class HostTurn:
    role: str  # 'host_a' | 'host_b' | 'host_other'
    text: str
    audio_url: str
    duration_ms: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PodcastChapter:
    title: str
    start_ms: int
    end_ms: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PodcastResult:
    task_id: str
    script: List[HostTurn] = field(default_factory=list)
    chapters: List[PodcastChapter] = field(default_factory=list)
    total_duration_ms: int = 0
    is_async: bool = False
    progress: float = 0.0  # 0..1, 同步路径为 1.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "script": [t.to_dict() for t in self.script],
            "chapters": [c.to_dict() for c in self.chapters],
            "total_duration_ms": self.total_duration_ms,
            "is_async": self.is_async,
            "progress": self.progress,
        }


# ============================================================================
# 异常
# ============================================================================
class PodcastError(Exception):
    """通用播客错误基类"""
    code = "podcast_error"
    http_status = 500


class PodcastUpstreamError(PodcastError):
    code = "upstream_error"
    http_status = 502


class PodcastTaskNotFound(PodcastError):
    code = "task_not_found"
    http_status = 404


class PodcastTimeout(PodcastError):
    code = "podcast_timeout"
    http_status = 504


# ============================================================================
# 纯函数: parse_script
# ============================================================================
_ROLE_MAP = {
    "A": "host_a",
    "B": "host_b",
    "host_a": "host_a",
    "host_b": "host_b",
    "host_a_alt": "host_a",
    "host_b_alt": "host_b",
}


def parse_script(raw: Optional[List[Dict[str, Any]]]) -> List[HostTurn]:
    """
    把上游脚本数组解析为 HostTurn 列表。
    - role 标准化: A→host_a, B→host_b, host_a→host_a, host_b→host_b, 其它→host_other
    - 缺失字段: text='', audio_url='', duration_ms=0
    - 输入为 None / [] → 返回 []
    """
    if not raw:
        return []
    out: List[HostTurn] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        role_raw = item.get("role", "")
        role = _ROLE_MAP.get(role_raw, "host_other" if role_raw else "host_other")
        out.append(
            HostTurn(
                role=role,
                text=str(item.get("text", "") or ""),
                audio_url=str(item.get("audio_url", "") or ""),
                duration_ms=int(item.get("duration_ms", 0) or 0),
            )
        )
    return out


# ============================================================================
# 纯函数: validate_request
# ============================================================================
def validate_request(payload: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """
    校验输入。
    返回 (ok, error_code).
    error_code ∈ {empty_transcript, transcript_too_long, invalid_option, None}.
    """
    if not isinstance(payload, dict):
        return False, "empty_transcript"
    text = payload.get("transcript")
    if not text or not isinstance(text, str) or not text.strip():
        return False, "empty_transcript"
    if len(text) > MAX_TRANSCRIPT_CHARS:
        return False, "transcript_too_long"
    style = payload.get("style", DEFAULT_STYLE)
    if style not in STYLES:
        return False, "invalid_option"
    duration = payload.get("duration", DEFAULT_DURATION)
    if duration not in DURATIONS:
        return False, "invalid_option"
    return True, None


# ============================================================================
# 纯函数: build_request_payload
# ============================================================================
def build_request_payload(
    transcript: str,
    style: str,
    duration: str,
    include_audio_clip: bool,
    config: PodcastConfig,
) -> Dict[str, Any]:
    """
    构造上游 HTTPS POST body。
    """
    payload: Dict[str, Any] = {
        "text": transcript,
        "style": style,
        "duration": duration,
        "include_audio_clip": bool(include_audio_clip),
        "speakers": 2,
    }
    # 旧控制台: 把 appid/token 一起发; 新控制台不重复发, 上游 header 已经带
    if not config.is_new_console():
        payload["appid"] = config.app_id
        payload["token"] = config.token
    return payload


# ============================================================================
# HTTPS 调用 (mockable)
# ============================================================================
def call_podcast_api(payload: Dict[str, Any], config: PodcastConfig) -> Dict[str, Any]:
    """
    同步路径: 上游立即返回完整脚本。
    - 这里默认抛 NotImplementedError (真实实现需要 urllib/requests + 鉴权)
    - 测试中通过 monkeypatch 替换。

    Raises:
        PodcastUpstreamError: 上游 5xx / 网络错误
    """
    raise NotImplementedError(
        "call_podcast_api must be patched in tests or wired to real HTTPS in production"
    )


def poll_podcast_task(task_id: str, config: PodcastConfig) -> Dict[str, Any]:
    """
    异步路径: 轮询上游 task 状态。
    - 返回 {"status": "running|done|failed", "progress": 0..1, ...}
    - 默认抛 PodcastTaskNotFound (mockable)
    """
    raise PodcastTaskNotFound(task_id)


# ============================================================================
# Prometheus 指标 (可注入)
# ============================================================================
class _PodcastMetrics:
    """
    兼容真实 Prometheus 指标 + 测试 mock.
    测试中用 MagicMock 替换实例即可。
    """

    def __init__(self):
        try:
            from prometheus_client import Counter, Histogram
            self.generate_total = Counter(
                "podcast_generate_total",
                "Total podcast generations",
                ["style", "duration"],
            )
            self.generate_latency_seconds = Histogram(
                "podcast_generate_latency_seconds",
                "Podcast generation latency",
                buckets=[1, 3, 5, 10, 20, 30, 60, 120],
            )
            self.generate_errors_total = Counter(
                "podcast_generate_errors_total",
                "Podcast generation errors",
                ["error_type"],
            )
            self.poll_total = Counter(
                "podcast_poll_total",
                "Total podcast task polls",
            )
        except Exception:
            # prometheus_client 不可用时回落到 no-op 对象 (MagicMock 在测试中替换)
            self.generate_total = _NoOpMetric()
            self.generate_latency_seconds = _NoOpMetric()
            self.generate_errors_total = _NoOpMetric()
            self.poll_total = _NoOpMetric()


class _NoOpMetric:
    """所有方法 no-op, 让 prometheus_client 不可用时也能调用 .labels().inc()"""

    def labels(self, **kw):
        return self

    def inc(self, *a, **kw):
        return self

    def observe(self, *a, **kw):
        return self


podcast_metrics = _PodcastMetrics()


# ============================================================================
# 结构化日志 (复用项目 logger)
# ============================================================================
_logger: Optional[logging.Logger] = None


def _get_logger() -> logging.Logger:
    global _logger
    if _logger is None:
        _logger = logging.getLogger("podcast")
        if not _logger.handlers:
            h = logging.StreamHandler()
            h.setFormatter(logging.Formatter(
                '{"ts":"%(asctime)s","logger":"%(name)s","level":"%(levelname)s","msg":%(message)s}'
            ))
            _logger.addHandler(h)
            _logger.setLevel(logging.INFO)
    return _logger


# ============================================================================
# 顶层编排
# ============================================================================
def generate_podcast(
    transcript: str,
    style: str,
    duration: str,
    include_audio_clip: bool,
    config: PodcastConfig,
) -> PodcastResult:
    """
    顶层播客生成。
    - short 走同步 (返回完整 script); medium/long 走异步 (返回 task_id + is_async=True)
    - 抛出 PodcastUpstreamError 由 endpoint 层捕获并转换为 502
    """
    log = _get_logger()
    payload = build_request_payload(transcript, style, duration, include_audio_clip, config)

    log.info(json.dumps({
        "event": "podcast.generate.start",
        "meeting_chars": len(transcript),
        "style": style,
        "duration": duration,
        "include_audio_clip": include_audio_clip,
        "resource_id": config.resource_id,
    }, ensure_ascii=False))

    start = time.time()
    try:
        raw = call_podcast_api(payload, config)
    except PodcastError:
        podcast_metrics.generate_errors_total.labels(error_type="upstream").inc()
        raise
    except Exception as e:
        podcast_metrics.generate_errors_total.labels(error_type="exception").inc()
        raise PodcastUpstreamError(str(e)) from e

    elapsed = time.time() - start
    podcast_metrics.generate_total.labels(style=style, duration=duration).inc()
    podcast_metrics.generate_latency_seconds.observe(elapsed)

    # 解析响应
    task_id = raw.get("task_id") or f"sync-{uuid.uuid4().hex[:8]}"
    script = parse_script(raw.get("script") or [])
    chapters = [
        PodcastChapter(
            title=c.get("title", ""),
            start_ms=int(c.get("start_ms", 0) or 0),
            end_ms=int(c.get("end_ms", 0) or 0),
        )
        for c in (raw.get("chapters") or [])
    ]
    total_ms = int(raw.get("total_duration_ms", 0) or 0)
    is_async = bool(DURATIONS.get(duration, {}).get("async", False))

    log.info(json.dumps({
        "event": "podcast.generate.success",
        "task_id": task_id,
        "latency_ms": round(elapsed * 1000, 2),
        "script_turns": len(script),
        "chapter_count": len(chapters),
        "total_duration_ms": total_ms,
        "is_async": is_async,
    }, ensure_ascii=False))

    return PodcastResult(
        task_id=task_id,
        script=script,
        chapters=chapters,
        total_duration_ms=total_ms,
        is_async=is_async,
        progress=1.0 if not is_async else 0.0,
    )


# ============================================================================
# 任务存储 (in-memory, demo 用; 生产应替换为 Redis/DB)
# ============================================================================
_task_store: Dict[str, PodcastResult] = {}
_task_store_lock_proxy = None  # 占位, 真实工程用 threading.Lock


def _store_task(result: PodcastResult) -> None:
    _task_store[result.task_id] = result


def _load_task(task_id: str) -> Optional[PodcastResult]:
    return _task_store.get(task_id)


def register_async_task(result: PodcastResult) -> None:
    """外部在拿到 task_id 后调, 把 async 结果存入内存"""
    _store_task(result)


# ============================================================================
# Flask Blueprint (由 app.py 挂载)
# ============================================================================
def register_podcast_routes(app, config: Optional[PodcastConfig] = None) -> None:
    """
    把播客相关路由注册到 Flask app。
    - /api/podcast/styles (GET)
    - /api/podcast/generate (POST)
    - /api/podcast/task/<task_id> (GET)
    """
    from flask import Blueprint, jsonify, request

    bp = Blueprint("podcast", __name__, url_prefix="/api/podcast")

    # 如果没传 config, 从 config 模块取
    if config is None:
        from config import Config
        config = PodcastConfig(
            app_id=os.environ.get("VOLC_PODCAST_APP_ID", getattr(Config, "VOLC_PODCAST_APP_ID", "")),
            token=os.environ.get("VOLC_PODCAST_TOKEN", getattr(Config, "VOLC_PODCAST_TOKEN", "")),
            api_key=os.environ.get("VOLC_PODCAST_API_KEY", getattr(Config, "VOLC_PODCAST_API_KEY", None)),
            resource_id=getattr(Config, "VOLC_PODCAST_RESOURCE_ID", "volc.podcast.llm.duration"),
            endpoint=getattr(
                Config,
                "VOLC_PODCAST_ENDPOINT",
                "https://openspeech.bytedance.com/api/v3/podcast/generate",
            ),
        )

    @bp.get("/styles")
    def list_styles():
        return jsonify({
            "styles": [
                {"id": sid, "label": s["label"], "description": s["description"]}
                for sid, s in STYLES.items()
            ],
            "durations": [
                {"id": did, "label": d["label"], "target_seconds": d["target_seconds"], "async": d["async"]}
                for did, d in DURATIONS.items()
            ],
        })

    @bp.post("/generate")
    def generate():
        payload = request.get_json(silent=True) or {}
        ok, err = validate_request(payload)
        if not ok:
            return jsonify({"error": err, "message": _err_msg(err)}), 400
        if not config.has_credentials():
            return jsonify({
                "error": "podcast_not_configured",
                "message": "VOLC_PODCAST_APP_ID/TOKEN/API_KEY 未配置",
            }), 503
        try:
            result = generate_podcast(
                transcript=payload.get("transcript", ""),
                style=payload.get("style", DEFAULT_STYLE),
                duration=payload.get("duration", DEFAULT_DURATION),
                include_audio_clip=bool(payload.get("include_audio_clip", False)),
                config=config,
            )
        except PodcastUpstreamError as e:
            return jsonify({"error": e.code, "message": str(e)}), e.http_status

        if result.is_async:
            register_async_task(result)
            return jsonify({
                "task_id": result.task_id,
                "status": "pending",
                "progress": result.progress,
            }), 202

        return jsonify(result.to_dict()), 200

    @bp.get("/task/<task_id>")
    def get_task(task_id: str):
        # 先查本地存储 (短轮询周期内的结果)
        cached = _load_task(task_id)
        if cached and not cached.is_async:
            return jsonify({
                "task_id": cached.task_id,
                "status": "done",
                "progress": 1.0,
                "script": [t.to_dict() for t in cached.script],
                "chapters": [c.to_dict() for c in cached.chapters],
                "total_duration_ms": cached.total_duration_ms,
            }), 200

        try:
            upstream = poll_podcast_task(task_id, config)
        except PodcastTaskNotFound:
            return jsonify({"error": "task_not_found", "message": f"task {task_id} 不存在"}), 404
        return jsonify(upstream), 200

    app.register_blueprint(bp)


def _err_msg(code: Optional[str]) -> str:
    return {
        "empty_transcript": "转写文本为空, 请先录制或粘贴会议转写",
        "transcript_too_long": f"转写文本超过 {MAX_TRANSCRIPT_CHARS} 字限制",
        "invalid_option": "风格或长度参数不合法",
    }.get(code or "", "请求无效")