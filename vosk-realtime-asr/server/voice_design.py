"""
火山引擎音色设计 (Voice Design / TTS Voice Customization) 接入层

端点:
    POST https://openspeech.bytedance.com/api/v1/tts/voice_design
鉴权:
    X-Api-Key (新控制台, 推荐)  OR  X-Api-App-Key + X-Api-Access-Key
功能:
    通过调节 gender/age/emotion/style/speed/pitch/volume 描述 + 文本,
    实时生成对应声音的音频 — 用户可试听, 保存后变成自定义 voice_id。

设计:
    - 模块级常量 (VALID_*, *_RANGE, PRESETS) 供客户端导入复用
    - 纯函数 validate_params / apply_defaults / build_request_payload / parse_upstream_response
      不依赖 Flask / requests, 可独立单测
    - Flask 集成在 register_voice_design_routes(app) 里, 暴露:
        POST /api/voice-design/generate   试听生成
        POST /api/voice-design/save       保存为自定义音色
        GET  /api/voice-design/presets    预设列表
"""
from __future__ import annotations

import functools
import json
import os
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

# requests 懒导入: 未安装时不影响纯函数单测
try:
    import requests  # type: ignore
except ImportError:
    requests = None  # type: ignore


# ============================================================================
# 协议常量 — 枚举 + 范围
# ============================================================================
VALID_GENDERS = ("male", "female")
VALID_AGES = ("child", "young", "middle-aged", "senior")
VALID_EMOTIONS = (
    "neutral", "happy", "sad", "angry", "surprised", "fearful", "disgusted",
)
VALID_STYLES = (
    "assistant", "narrator", "chat", "news", "advertisement",
    "storyteller", "customer_service", "game",
)
SPEED_RANGE = (0.5, 2.0)
PITCH_RANGE = (0.5, 2.0)
VOLUME_RANGE = (0, 10)
TEXT_MAX_LEN = 300


# ============================================================================
# 预设 (客户端一键应用)
# ============================================================================
PRESETS: List[Dict[str, Any]] = [
    {
        "id": "news_anchor",
        "name": "新闻播报",
        "description": "专业稳重的新闻主播风格, 节奏明快, 信息密度高",
        "icon": "news",
        "gender": "female",
        "age": "middle-aged",
        "emotion": "neutral",
        "style": "news",
        "speed": 1.05,
        "pitch": 1.0,
        "volume": 6,
    },
    {
        "id": "gentle_female",
        "name": "温柔女声",
        "description": "温柔亲切, 适合客服 / 陪伴场景",
        "icon": "heart",
        "gender": "female",
        "age": "young",
        "emotion": "neutral",
        "style": "assistant",
        "speed": 0.95,
        "pitch": 1.1,
        "volume": 5,
    },
    {
        "id": "magnetic_male",
        "name": "磁性男声",
        "description": "低沉浑厚, 适合纪录片 / 广告",
        "icon": "mic",
        "gender": "male",
        "age": "middle-aged",
        "emotion": "neutral",
        "style": "narrator",
        "speed": 0.95,
        "pitch": 0.85,
        "volume": 6,
    },
    {
        "id": "child",
        "name": "儿童",
        "description": "活泼俏皮, 适合儿童读物 / 教学",
        "icon": "star",
        "gender": "female",
        "age": "child",
        "emotion": "happy",
        "style": "storyteller",
        "speed": 1.1,
        "pitch": 1.3,
        "volume": 5,
    },
    {
        "id": "energetic_young",
        "name": "活力青年",
        "description": "青春阳光, 适合 vlog / 短视频",
        "icon": "bolt",
        "gender": "male",
        "age": "young",
        "emotion": "happy",
        "style": "chat",
        "speed": 1.1,
        "pitch": 1.05,
        "volume": 6,
    },
    {
        "id": "mature_news",
        "name": "成熟男声新闻",
        "description": "权威稳重, 适合财经 / 时政播报",
        "icon": "shield",
        "gender": "male",
        "age": "senior",
        "emotion": "neutral",
        "style": "news",
        "speed": 1.0,
        "pitch": 0.9,
        "volume": 7,
    },
]


def get_preset_by_id(preset_id: str) -> Optional[Dict[str, Any]]:
    for p in PRESETS:
        if p["id"] == preset_id:
            return p
    return None


# ============================================================================
# 纯函数: 校验
# ============================================================================
def validate_params(params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    入参 → 错误信息 dict 或 None
    错误信息: {"status": 400, "field": str, "message": str}
    """
    # 必填
    for field in ("gender", "age", "text"):
        if field not in params or params[field] is None or params[field] == "":
            return {
                "status": 400,
                "field": field,
                "message": f"missing required field: {field}",
            }

    # 枚举
    if params["gender"] not in VALID_GENDERS:
        return {
            "status": 400, "field": "gender",
            "message": f"gender must be one of {VALID_GENDERS}",
        }
    if params["age"] not in VALID_AGES:
        return {
            "status": 400, "field": "age",
            "message": f"age must be one of {VALID_AGES}",
        }
    if "emotion" in params and params["emotion"] not in VALID_EMOTIONS:
        return {
            "status": 400, "field": "emotion",
            "message": f"emotion must be one of {VALID_EMOTIONS}",
        }
    if "style" in params and params["style"] not in VALID_STYLES:
        return {
            "status": 400, "field": "style",
            "message": f"style must be one of {VALID_STYLES}",
        }

    # 范围
    if "speed" in params and params["speed"] is not None:
        if not (SPEED_RANGE[0] <= float(params["speed"]) <= SPEED_RANGE[1]):
            return {
                "status": 400, "field": "speed",
                "message": f"speed must be in {SPEED_RANGE}",
            }
    if "pitch" in params and params["pitch"] is not None:
        if not (PITCH_RANGE[0] <= float(params["pitch"]) <= PITCH_RANGE[1]):
            return {
                "status": 400, "field": "pitch",
                "message": f"pitch must be in {PITCH_RANGE}",
            }
    if "volume" in params and params["volume"] is not None:
        if not (VOLUME_RANGE[0] <= int(params["volume"]) <= VOLUME_RANGE[1]):
            return {
                "status": 400, "field": "volume",
                "message": f"volume must be in {VOLUME_RANGE}",
            }

    # text 长度
    if len(params["text"]) > TEXT_MAX_LEN:
        return {
            "status": 400, "field": "text",
            "message": f"text too long, max {TEXT_MAX_LEN} chars",
        }

    return None


def apply_defaults(params: Dict[str, Any]) -> Dict[str, Any]:
    """补全可选参数默认值 — 必须在 validate_params 通过后调用"""
    out = dict(params)
    out.setdefault("emotion", "neutral")
    out.setdefault("style", "assistant")
    out.setdefault("speed", 1.0)
    out.setdefault("pitch", 1.0)
    out.setdefault("volume", 5)
    return out


# ============================================================================
# 纯函数: 构造请求 payload
# ============================================================================
def build_request_payload(
    app_key: str,
    access_token: str,
    cluster: str,
    params: Dict[str, Any],
    voice_id: str,
    sample_rate: int = 24000,
    audio_format: str = "mp3",
) -> Dict[str, Any]:
    """
    构造发送到火山引擎 voice_design 端点的 JSON.

    顶层 app 块: volc saas tts 要求 (与 ASR 端点格式一致)
    request.voice_config: 性别 / 年龄 / 情感 / 风格 / 语速 / 音调 / 音量
    request.text: 待合成文本
    """
    req = {
        "reqid": str(uuid.uuid4()),
        "text": params["text"],
        "format": audio_format,
        "sample_rate": sample_rate,
        "voice_config": {
            "voice_id": voice_id,
            "gender": params["gender"],
            "age": params["age"],
            "emotion": params["emotion"],
            "style": params["style"],
            "speed": params["speed"],
            "pitch": params["pitch"],
            "volume": params["volume"],
        },
    }
    return {
        "app": {
            "appid": app_key,
            "token": access_token,
            "cluster": cluster,
        },
        "request": req,
    }


def parse_upstream_response(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    把火山引擎响应 parse 成内部统一格式:
        {"ok": True, "audio_base64": ..., "duration_ms": ..., "sample_rate": ...}
        {"ok": False, "error_code": ..., "error_message": ...}
    """
    code = payload.get("code", 0)
    if code != 0 and code != 200:
        return {
            "ok": False,
            "error_code": code,
            "error_message": str(payload.get("message", "unknown error"))[:500],
        }
    data = payload.get("data") or {}
    audio = data.get("audio")
    if not audio:
        return {
            "ok": False,
            "error_code": -1,
            "error_message": "upstream returned no audio data",
        }
    return {
        "ok": True,
        "audio_base64": audio,
        "duration_ms": data.get("duration", 0),
        "sample_rate": data.get("sample_rate", 24000),
    }


# ============================================================================
# 纯函数: 实时对话 prompt voice 列表
# ============================================================================
# 音色设计必须搭配一个 seed voice_id 作为 prompt (官方要求)
# 这里使用内置 seed voices (官方文档列出的演示音色)
DEFAULT_SEED_VOICES = [
    {"voice_id": "S_prompt_zh_female_1", "name": "示例女声 A", "gender": "female"},
    {"voice_id": "S_prompt_zh_male_1", "name": "示例男声 A", "gender": "male"},
    {"voice_id": "S_prompt_en_female_1", "name": "示例女声 B (英文)", "gender": "female"},
]


# ============================================================================
# HTTP 客户端 (懒加载 requests)
# ============================================================================
def call_voice_design_api(
    endpoint: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    timeout_sec: float = 10.0,
) -> Dict[str, Any]:
    """
    实际 HTTP 调用火山引擎 voice_design 端点.
    返回: {"ok": True, ...} 或 {"ok": False, "error_code": ..., "error_message": ...}

    网络异常 / HTTP 非 2xx 都返回 ok=False, 调用方统一处理.
    """
    if requests is None:
        return {"ok": False, "error_code": -5, "error_message": "requests library not installed"}
    try:
        resp = requests.post(endpoint, headers=headers, json=payload, timeout=timeout_sec)
    except requests.Timeout:
        return {"ok": False, "error_code": -2, "error_message": "upstream timeout"}
    except requests.ConnectionError as e:
        return {"ok": False, "error_code": -3, "error_message": f"connection error: {str(e)[:200]}"}
    except Exception as e:
        return {"ok": False, "error_code": -1, "error_message": f"request failed: {str(e)[:200]}"}

    if resp.status_code != 200:
        return {
            "ok": False,
            "error_code": resp.status_code,
            "error_message": f"upstream HTTP {resp.status_code}: {resp.text[:200]}",
        }

    try:
        body = resp.json()
    except Exception as e:
        return {"ok": False, "error_code": -4, "error_message": f"invalid JSON: {str(e)[:200]}"}

    return parse_upstream_response(body)


def build_auth_headers(app_key: str, access_token: str) -> Dict[str, str]:
    """
    新控制台: X-Api-Key 单一鉴权 (app_key 当作 api_key)
    旧控制台: X-Api-App-Key + X-Api-Access-Key
    """
    # 默认按新控制台, 客户端可强制覆盖
    return {
        "Content-Type": "application/json",
        "X-Api-Key": access_token or app_key,
        "Authorization": f"Bearer; {access_token or app_key}",
    }


# ============================================================================
# Flask 集成
# ============================================================================
# 测试用: 让被装饰的 handler 能读出最后解析的参数
_last_params: Optional[Dict[str, Any]] = None
_last_save_args: Optional[Dict[str, Any]] = None


def require_credentials(fn: Callable) -> Callable:
    """装饰器: 校验服务端凭证配置, 缺失时返回 503"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        from flask import current_app, jsonify
        app_key = current_app.config.get("VOICE_DESIGN_APP_KEY") or os.environ.get(
            "VOLC_VOICE_DESIGN_APP_ID", ""
        )
        token = current_app.config.get("VOICE_DESIGN_TOKEN") or os.environ.get(
            "VOLC_VOICE_DESIGN_TOKEN", ""
        )
        if not app_key or not token:
            return jsonify({
                "ok": False,
                "message": "服务端未配置音色设计凭证 (VOLC_VOICE_DESIGN_APP_ID / VOLC_VOICE_DESIGN_TOKEN)",
                "error_code": "CREDENTIALS_MISSING",
            }), 503
        # 把凭证塞进 flask.g 供 handler 读
        from flask import g
        g.voice_design_app_key = app_key
        g.voice_design_token = token
        return fn(*args, **kwargs)
    return wrapper


def validate_request(fn: Callable) -> Callable:
    """装饰器: 解析请求 body, 校验参数, 通过则把合并后的 params 写到 flask.g / 模块 _last_params

    兼容两种调用风格:
    - handler 接受 params kwarg: def generate(params): ...
    - handler 不接受: def generate(): ...
      此时测试 / 内部代码可通过 vd._last_params 读到.
    """
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        global _last_params
        from flask import request, jsonify, g
        data = request.get_json(silent=True) or {}
        err = validate_params(data)
        if err is not None:
            return jsonify({
                "ok": False,
                **err,
            }), err["status"]
        params = apply_defaults(data)
        _last_params = params
        g.voice_design_params = params
        # 仅当 handler 接受 params 时才注入 (用 inspect 静态判别)
        import inspect
        try:
            sig = inspect.signature(fn)
            if "params" in sig.parameters:
                kwargs["params"] = params
        except (TypeError, ValueError):
            pass
        return fn(*args, **kwargs)
    return wrapper


def validate_save_request(fn: Callable) -> Callable:
    """装饰器: 校验 save 请求, 缺 voice_name / sample_audio → 400"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        global _last_save_args
        from flask import request, jsonify, g
        data = request.get_json(silent=True) or {}
        if not data.get("voice_name"):
            return jsonify({
                "ok": False, "status": 400, "field": "voice_name",
                "message": "missing required field: voice_name",
            }), 400
        if not data.get("sample_audio"):
            return jsonify({
                "ok": False, "status": 400, "field": "sample_audio",
                "message": "missing required field: sample_audio (base64)",
            }), 400
        _last_save_args = data
        g.voice_design_save_args = data
        import inspect
        try:
            sig = inspect.signature(fn)
            if "save_args" in sig.parameters:
                kwargs["save_args"] = data
        except (TypeError, ValueError):
            pass
        return fn(*args, **kwargs)
    return wrapper


# ============================================================================
# 实际 HTTP 调用: generate
# ============================================================================
def _do_generate(params: Dict[str, Any], voice_id: str) -> Dict[str, Any]:
    """
    调上游生成音频 — 失败返回 ok=False, 成功返回 ok=True + audio_base64.
    """
    from flask import g, current_app
    endpoint = current_app.config.get(
        "VOICE_DESIGN_ENDPOINT",
        "https://openspeech.bytedance.com/api/v1/tts/voice_design",
    )
    cluster = current_app.config.get("VOICE_DESIGN_CLUSTER", "volcano_tts")
    headers = build_auth_headers(g.voice_design_app_key, g.voice_design_token)
    payload = build_request_payload(
        app_key=g.voice_design_app_key,
        access_token=g.voice_design_token,
        cluster=cluster,
        params=params,
        voice_id=voice_id,
    )
    t0 = time.time()
    result = call_voice_design_api(endpoint, headers, payload)
    elapsed_ms = (time.time() - t0) * 1000
    if result.get("ok"):
        result["_elapsed_ms"] = round(elapsed_ms, 2)
    return result


def _do_save(save_args: Dict[str, Any]) -> Dict[str, Any]:
    """
    调上游保存音色 — 把生成/上传的 sample_audio 注册为自定义 voice_id.
    """
    from flask import g, current_app
    endpoint = current_app.config.get(
        "VOICE_DESIGN_SAVE_ENDPOINT",
        "https://openspeech.bytedance.com/api/v1/tts/voice_save",
    )
    cluster = current_app.config.get("VOICE_DESIGN_CLUSTER", "volcano_tts")
    headers = build_auth_headers(g.voice_design_app_key, g.voice_design_token)
    payload = {
        "app": {
            "appid": g.voice_design_app_key,
            "token": g.voice_design_token,
            "cluster": cluster,
        },
        "request": {
            "reqid": str(uuid.uuid4()),
            "voice_name": save_args["voice_name"],
            "sample_audio": save_args["sample_audio"],
            "description": save_args.get("description", ""),
            "preview_text": save_args.get("preview_text", ""),
            "format": save_args.get("format", "mp3"),
            "sample_rate": save_args.get("sample_rate", 24000),
        },
    }
    if requests is None:
        return {"ok": False, "error_code": -5, "error_message": "requests library not installed"}
    try:
        resp = requests.post(endpoint, headers=headers, json=payload, timeout=15)
    except Exception as e:
        return {"ok": False, "error_code": -1, "error_message": f"save request failed: {str(e)[:200]}"}
    if resp.status_code != 200:
        return {"ok": False, "error_code": resp.status_code, "error_message": resp.text[:200]}
    try:
        body = resp.json()
    except Exception as e:
        return {"ok": False, "error_code": -4, "error_message": f"invalid JSON: {str(e)[:200]}"}
    if body.get("code") not in (0, 200):
        return {
            "ok": False,
            "error_code": body.get("code", -1),
            "error_message": str(body.get("message", "save failed"))[:500],
        }
    data = body.get("data") or {}
    return {
        "ok": True,
        "voice_id": data.get("voice_id"),
        "voice_name": save_args["voice_name"],
        "created_at": data.get("created_at", int(time.time() * 1000)),
    }


# ============================================================================
# 注册 Flask 路由
# ============================================================================
def register_voice_design_routes(app, logger=None, metrics=None) -> None:
    """
    把 4 个端点挂到 Flask app 上.

    - POST /api/voice-design/generate
    - POST /api/voice-design/save
    - GET  /api/voice-design/presets
    - GET  /api/voice-design/seed-voices
    """
    from flask import request, jsonify

    @app.route("/api/voice-design/generate", methods=["POST"])
    @require_credentials
    @validate_request
    def _generate(params):
        # 默认 seed voice id (前端可传 voice_id 覆盖)
        voice_id = request.get_json(silent=True).get("voice_id") if request.get_json(silent=True) else None
        if not voice_id:
            voice_id = DEFAULT_SEED_VOICES[0]["voice_id"]
        if logger:
            logger.info("[VoiceDesign] generate", extra={
                "event_type": "voice_design_generate",
                "metadata": {
                    "gender": params["gender"],
                    "age": params["age"],
                    "emotion": params["emotion"],
                    "style": params["style"],
                    "speed": params["speed"],
                    "pitch": params["pitch"],
                    "text_len": len(params["text"]),
                    "voice_id": voice_id,
                },
            })
        result = _do_generate(params, voice_id)
        if metrics:
            try:
                metrics.voice_design_generated_total.labels(
                    status="ok" if result.get("ok") else "fail",
                ).inc()
                if result.get("ok"):
                    metrics.voice_design_latency_ms.observe(result.get("_elapsed_ms", 0))
            except Exception:
                pass
        if not result.get("ok"):
            return jsonify(result), 502
        return jsonify({
            "ok": True,
            "audio_base64": result["audio_base64"],
            "duration_ms": result["duration_ms"],
            "sample_rate": result["sample_rate"],
            "params": params,
        }), 200

    @app.route("/api/voice-design/save", methods=["POST"])
    @require_credentials
    @validate_save_request
    def _save(save_args):
        if logger:
            logger.info("[VoiceDesign] save", extra={
                "event_type": "voice_design_save",
                "metadata": {
                    "voice_name": save_args["voice_name"],
                    "audio_bytes": len(save_args["sample_audio"]) * 3 // 4,  # base64 → 字节 估算
                },
            })
        result = _do_save(save_args)
        if metrics:
            try:
                metrics.voice_design_saved_total.labels(
                    status="ok" if result.get("ok") else "fail",
                ).inc()
            except Exception:
                pass
        if not result.get("ok"):
            return jsonify(result), 502
        return jsonify(result), 200

    @app.route("/api/voice-design/presets", methods=["GET"])
    def _presets():
        return jsonify({"ok": True, "presets": PRESETS}), 200

    @app.route("/api/voice-design/seed-voices", methods=["GET"])
    def _seed_voices():
        return jsonify({"ok": True, "seed_voices": DEFAULT_SEED_VOICES}), 200