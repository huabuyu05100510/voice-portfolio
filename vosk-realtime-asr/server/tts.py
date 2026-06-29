"""
SeedTTS 2.0 (火山引擎"语音合成 2.0" / 大模型语音合成) 服务端代理

设计目标:
- 隐藏凭证 (服务端持有 VOLC_TTS_APP_ID / TOKEN, 前端不直连火山)
- 避开 CORS (浏览器只调 /api/tts/* 同源 endpoint)
- 流式响应转发 (chunked MP3 → 累积 → 一并回传)
- 计量 + 日志 (Prometheus 计数 / Histogram, structured logger)
- 失败可观测: TTSError 携带 status + body, 便于前端 error 文案

API 协议 (基于火山引擎 1.0 / 2.0 通用格式, 参考 docs/universal-asr-architecture.md):
  POST {endpoint}
  Authorization: Bearer; {token}
  Content-Type: application/json
  Body:
    {
      "app":   { "appid": "...", "token": "...", "cluster": "volcano_tts" },
      "user":  { "uid": "voice-portfolio-web" },
      "audio": { "voice_type": "BV001_streaming", "encoding": "mp3",
                 "speed_ratio": 1.0, "pitch_ratio": 1.0, "volume_ratio": 1.0,
                 "sample_rate": 24000, "bit_rate": 160000, "channel": 1 },
      "request": { "reqid": "<uuid>:text", "text": "...",
                   "text_type": "plain|ssml", "operation": "query", "with_frontend": 1,
                   "frontend_type": "unitTson" }
    }
  Response 200: audio/mpeg bytes (single-shot, non-streaming JSON-encoded)
  错误码: 401 unauthorized / 429 rate-limit / 5xx server

火山引擎单次合成硬限: text 长度 ≤ 1024 字节; 超过需前端分片.

Author: voice-portfolio TTS 2.0 agent
"""
import os
import json
import time
import uuid
import logging
import urllib.request
import urllib.error
from typing import Optional, List, Dict, Any

# 模块级 logger (避免 module-load 时副作用 boot)
_logger = logging.getLogger('tts')

# 暴露 urlopen 作为模块属性, 便于单测 mock (mock.patch('tts.urlopen'))
urlopen = urllib.request.urlopen

# 限速: speed_ratio / pitch_ratio / volume_ratio 范围 (火山引擎 1.0 文档)
_SPEED_RANGE = (0.5, 2.0)
_PITCH_RANGE = (0.5, 2.0)
_VOLUME_RANGE = (0.5, 2.0)
_TEXT_MAX_BYTES = 1024  # 火山引擎单次硬限

# ---------------------------------------------------------------------------
# 异常类型
# ---------------------------------------------------------------------------
class TTSError(Exception):
    """语音合成 2.0 业务错误 (HTTP 非 2xx / 业务错误码)"""
    def __init__(self, status_code: int, body: str, message: str = ''):
        self.status_code = status_code
        self.body = body
        self.message = message or f'TTS request failed (status={status_code})'
        super().__init__(self.message)


class MisconfiguredError(TTSError):
    """服务端未配 VOLC_TTS_* 环境变量"""
    def __init__(self, missing: List[str]):
        self.missing = missing
        super().__init__(status_code=500, body='', message=f'TTS misconfigured: missing {missing}')


class ValidationError(TTSError):
    """客户端参数非法 (长度 / 范围)"""
    def __init__(self, field: str, detail: str):
        self.field = field
        super().__init__(status_code=400, body='', message=f'TTS validation: {field} {detail}')


# ---------------------------------------------------------------------------
# 凭证 / 配置
# ---------------------------------------------------------------------------
def _env_config() -> Dict[str, str]:
    """读 .env / os.environ, 缺关键项抛 MisconfiguredError"""
    cfg = {
        'appid': os.environ.get('VOLC_TTS_APP_ID', '').strip(),
        'token': os.environ.get('VOLC_TTS_TOKEN', '').strip(),
        'cluster': os.environ.get('VOLC_TTS_CLUSTER', 'volcano_tts').strip(),
        'endpoint': os.environ.get('VOLC_TTS_ENDPOINT', 'https://openspeech.bytedance.com/api/v1/tts').strip(),
        'default_voice': os.environ.get('VOLC_TTS_VOICE', 'BV001_streaming').strip(),
        'default_format': os.environ.get('VOLC_TTS_DEFAULT_FORMAT', 'mp3').strip(),
    }
    missing = [k for k in ('appid', 'token', 'cluster') if not cfg[k]]
    if missing:
        raise MisconfiguredError(missing)
    return cfg


# ---------------------------------------------------------------------------
# 计量 (可选注入)
# ---------------------------------------------------------------------------
# 由 app.py 在 boot_app() 注入; 未注入时用 no-op 替代, 保证单测不依赖全局
metrics = None  # type: ignore


class _NoopMetrics:
    @property
    def tts_requests_total(self):
        class _C:
            def labels(self, **kw):
                class _L:
                    def inc(s, n=1): pass
                return _L()
        return _C()
    @property
    def tts_latency_seconds(self):
        class _H:
            def observe(self, v): pass
        return _H()


def _get_metrics():
    return metrics or _NoopMetrics()


# ---------------------------------------------------------------------------
# 请求构造
# ---------------------------------------------------------------------------
def _build_request(
    text: str,
    voice: Optional[str],
    speed: float = 1.0,
    pitch: float = 1.0,
    volume: float = 1.0,
    audio_format: str = 'mp3',
    sample_rate: int = 24000,
    text_type: str = 'plain',
) -> str:
    """构造火山引擎语音合成标准 JSON body (返回 JSON 字符串, 由 urllib 编码)"""
    cfg = _env_config()
    voice = voice or cfg['default_voice']
    # 文本长度 / 编码探测: <speak> 开头视为 ssml
    if text.lstrip().startswith('<speak'):
        text_type = 'ssml'
    return json.dumps({
        'app': {
            'appid': cfg['appid'],
            'token': cfg['token'],
            'cluster': cfg['cluster'],
        },
        'user': {'uid': 'voice-portfolio-web'},
        'audio': {
            'voice_type': voice,
            'encoding': audio_format,
            'speed_ratio': float(speed),
            'pitch_ratio': float(pitch),
            'volume_ratio': float(volume),
            'sample_rate': int(sample_rate),
            'bit_rate': 160000,
            'channel': 1,
        },
        'request': {
            'reqid': f'{uuid.uuid4().hex}:text',
            'text': text,
            'text_type': text_type,
            'operation': 'query',
            'with_frontend': 1,
            'frontend_type': 'unitTson',
        },
    }, ensure_ascii=False)


# ---------------------------------------------------------------------------
# 参数校验
# ---------------------------------------------------------------------------
def _validate(text: str, speed: float, pitch: float, volume: float) -> None:
    if not text or not text.strip():
        raise ValidationError('text', 'must be non-empty')
    if len(text.encode('utf-8')) > _TEXT_MAX_BYTES:
        raise ValidationError('text', f'exceeds {_TEXT_MAX_BYTES} bytes')
    for name, v, rng in (('speed', speed, _SPEED_RANGE),
                         ('pitch', pitch, _PITCH_RANGE),
                         ('volume', volume, _VOLUME_RANGE)):
        if not (rng[0] <= v <= rng[1]):
            raise ValidationError(name, f'out of range [{rng[0]}, {rng[1]}]')


# ---------------------------------------------------------------------------
# 核心: synthesize / list_voices
# ---------------------------------------------------------------------------
def _post_json(url: str, body: str, token: str) -> bytes:
    """POST JSON body, 流式 read, 累积返回 bytes"""
    req = urllib.request.Request(
        url,
        data=body.encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer; {token}',
            'User-Agent': 'voice-portfolio-tts/2.0',
        },
        method='POST',
    )
    out = bytearray()
    # 使用模块级 urlopen 便于单测 patch
    with urlopen(req, timeout=30) as resp:
        while True:
            chunk = resp.read(8192)
            if not chunk:
                break
            out.extend(chunk)
    return bytes(out)


def synthesize(
    text: str,
    voice: Optional[str] = None,
    speed: float = 1.0,
    pitch: float = 1.0,
    volume: float = 1.0,
    audio_format: str = 'mp3',
    sample_rate: int = 24000,
) -> bytes:
    """
    合成语音 → 完整音频 bytes (MP3/PCM/WAV).

    错误:
      MisconfiguredError  - 缺凭证
      ValidationError     - 参数非法
      TTSError            - 火山引擎 4xx/5xx
    """
    cfg = _env_config()
    _validate(text, speed, pitch, volume)
    body = _build_request(
        text=text, voice=voice,
        speed=speed, pitch=pitch, volume=volume,
        audio_format=audio_format, sample_rate=sample_rate,
    )
    m = _get_metrics()
    start = time.perf_counter()
    try:
        audio = _post_json(cfg['endpoint'], body, cfg['token'])
    except urllib.error.HTTPError as e:
        body_bytes = e.read() if hasattr(e, 'read') else b''
        body_text = body_bytes.decode('utf-8', errors='replace') if body_bytes else ''
        try:
            m.tts_requests_total.labels(status='error', reason=str(e.code)).inc()
        except Exception:
            pass
        _logger.error(
            f'[TTS] synthesize http_error status={e.code} voice={voice} '
            f'text_len={len(text)} body={body_text[:200]}',
            extra={'event_type': 'tts_http_error', 'metadata': {
                'status': e.code, 'voice': voice, 'text_len': len(text),
            }},
        )
        raise TTSError(status_code=e.code, body=body_text)
    except urllib.error.URLError as e:
        try:
            m.tts_requests_total.labels(status='error', reason='network').inc()
        except Exception:
            pass
        _logger.error(f'[TTS] synthesize network_error reason={e.reason} voice={voice}')
        raise TTSError(status_code=503, body=str(e.reason), message=f'network: {e.reason}')
    except Exception as e:
        try:
            m.tts_requests_total.labels(status='error', reason='exception').inc()
        except Exception:
            pass
        _logger.exception(f'[TTS] synthesize unexpected_error voice={voice}')
        raise TTSError(status_code=500, body=str(e), message=f'unexpected: {e}')

    elapsed = time.perf_counter() - start
    try:
        m.tts_requests_total.labels(status='ok', voice=voice or cfg['default_voice']).inc()
        m.tts_latency_seconds.observe(elapsed)
    except Exception:
        pass
    _logger.info(
        f'[TTS] synthesize voice={voice or cfg["default_voice"]} '
        f'format={audio_format} text_len={len(text)} audio_bytes={len(audio)} '
        f'latency_ms={elapsed*1000:.1f}',
        extra={'event_type': 'tts_synthesize', 'metadata': {
            'voice': voice or cfg['default_voice'],
            'audio_format': audio_format,
            'text_len': len(text),
            'audio_bytes': len(audio),
            'latency_ms': round(elapsed * 1000, 1),
        }},
    )
    return audio


def list_voices() -> List[Dict[str, Any]]:
    """
    拉取可用音色列表 (火山引擎 ListVoices 接口, 同 header 鉴权).

    Returns:
      [{ id, name, gender, sample_rate }, ...]

    Raises:
      MisconfiguredError  - 缺凭证
      TTSError            - 4xx/5xx
    """
    cfg = _env_config()
    # 火山引擎 ListVoices endpoint (与 synthesize 同 host, 不同 path)
    list_endpoint = cfg['endpoint'].replace('/tts', '/list_voices') if '/tts' in cfg['endpoint'] \
        else 'https://openspeech.bytedance.com/api/v1/list_voices'
    body = json.dumps({
        'app': {'appid': cfg['appid'], 'token': cfg['token'], 'cluster': cfg['cluster']},
        'user': {'uid': 'voice-portfolio-web'},
    })
    req = urllib.request.Request(
        list_endpoint,
        data=body.encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer; {cfg["token"]}',
        },
        method='POST',
    )
    try:
        with urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode('utf-8', errors='replace') if hasattr(e, 'read') else ''
        raise TTSError(status_code=e.code, body=body_text)
    except urllib.error.URLError as e:
        raise TTSError(status_code=503, body=str(e.reason), message=f'network: {e.reason}')

    raw = payload.get('data') or payload.get('voices') or []
    out: List[Dict[str, Any]] = []
    for v in raw:
        out.append({
            'id': v.get('voice_type') or v.get('id') or v.get('voice_id'),
            'name': v.get('name') or v.get('voice_type') or v.get('id') or 'unknown',
            'gender': (v.get('gender') or 'unknown').lower(),
            'sample_rate': int(v.get('sample_rate') or 24000),
        })
    return out


# ---------------------------------------------------------------------------
# 兜底音色 (无 ListVoices 权限 / 测试环境): 内置 4 个豆包经典音色
# ---------------------------------------------------------------------------
FALLBACK_VOICES: List[Dict[str, Any]] = [
    {'id': 'BV001_streaming', 'name': '磁性男声', 'gender': 'male',   'sample_rate': 24000},
    {'id': 'BV002_streaming', 'name': '温柔女声', 'gender': 'female', 'sample_rate': 24000},
    {'id': 'BV003_streaming', 'name': '活力童声', 'gender': 'child',  'sample_rate': 24000},
    {'id': 'BV004_streaming', 'name': '沉稳旁白', 'gender': 'male',   'sample_rate': 24000},
]


def safe_list_voices() -> Dict[str, Any]:
    """
    安全版 list_voices: 凭证缺 / 网络失败 → 回落 FALLBACK_VOICES + degraded=true
    """
    try:
        voices = list_voices()
        return {'data': voices, 'degraded': False, 'source': 'live'}
    except MisconfiguredError as e:
        _logger.warning(f'[TTS] credentials missing, fallback to static voices: {e.missing}')
        return {'data': FALLBACK_VOICES, 'degraded': True, 'source': 'fallback', 'reason': 'misconfigured'}
    except TTSError as e:
        _logger.warning(f'[TTS] list_voices failed status={e.status_code}, fallback')
        return {'data': FALLBACK_VOICES, 'degraded': True, 'source': 'fallback', 'reason': f'http_{e.status_code}'}
