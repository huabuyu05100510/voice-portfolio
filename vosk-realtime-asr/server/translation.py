"""
同声传译 2.0 (Simultaneous Interpretation 2.0) 服务端代理

职责:
- 包装火山引擎翻译 API (POST / WebSocket), 不暴露明文凭证给前端
- 简单 (text, source_lang, target_lang) → translated text 的同步调用: translate_once
- 流式 (回调 partial / final / error): translate_stream
- 内置 LRU 缓存 (text, src, tgt) → translated, 避免重复请求
- Prometheus 指标: 请求计数 / 延迟 / 缓存命中率 / 错误计数
- 完整 OTel span (translation.invoke / translation.stream)
- 结构化日志 (与 transcription 一致)

凭证 (环境变量, 不写到 git):
- VOLC_TRANSLATE_APP_ID
- VOLC_TRANSLATE_TOKEN
- VOLC_TRANSLATE_ENDPOINT
- VOLC_TRANSLATE_RESOURCE_ID

**模型**: MiniMax-M3
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
import uuid
from collections import OrderedDict
from typing import Callable, Optional

_log = logging.getLogger('volc-translate')


# ---------------------------------------------------------------------------
# 自定义异常 (供前端 / 其他模块精确捕获)
# ---------------------------------------------------------------------------
class MisconfiguredError(RuntimeError):
    """同声传译 2.0 凭证未配置 (VOLC_TRANSLATE_APP_ID / VOLC_TRANSLATE_TOKEN)"""


class InvalidLanguagePairError(ValueError):
    """不支持的语言对"""


class TranslationError(RuntimeError):
    """翻译 API 调用失败 (网络 / 服务端 4xx 5xx)"""


# ---------------------------------------------------------------------------
# Prometheus 指标 — 与 metrics.py 同风格, 但用独立 collector 避免污染主模块
# ---------------------------------------------------------------------------
try:
    from prometheus_client import Counter, Histogram
    _PROM_AVAILABLE = True
except ImportError:  # 测试或未装环境
    _PROM_AVAILABLE = False

    class _NoopMetric:
        def labels(self, **kwargs):
            return self

        def inc(self, *args, **kwargs):
            pass

        def observe(self, *args, **kwargs):
            pass

        def _value(self):  # pragma: no cover
            class _V:
                def get(self):
                    return 0.0
            return _V()

    Counter = Histogram = lambda *a, **kw: _NoopMetric()  # type: ignore


class TranslationMetrics:
    """同声传译 2.0 独立 Prometheus 指标 (不污染主 server metrics)"""

    translation_requests_total = Counter(
        'translation_requests_total',
        'Total translation requests',
        ['lang_pair', 'status'],
    )
    translation_latency_ms = Histogram(
        'translation_latency_ms',
        'Translation latency in milliseconds (client-perceived)',
        buckets=[50, 100, 200, 300, 500, 800, 1200, 2000, 4000],
    )
    translation_cache_hits_total = Counter(
        'translation_cache_hits_total',
        'Translation cache hits',
        ['lang_pair'],
    )
    translation_errors_total = Counter(
        'translation_errors_total',
        'Translation errors',
        ['reason'],
    )


metrics = TranslationMetrics()


# ---------------------------------------------------------------------------
# 语言对白名单 — 仅允许服务端已开通的 pair, 防止客户端任意拼
# ---------------------------------------------------------------------------
SUPPORTED_PAIRS = frozenset({
    'zh-en', 'en-zh',
    'zh-ja', 'ja-zh',
    'zh-ko', 'ko-zh',
    'zh-ru', 'ru-zh',
    'zh-fr', 'fr-zh',
    'zh-de', 'de-zh',
    'zh-es', 'es-zh',
    'zh-id', 'id-zh',
    'zh-vi', 'vi-zh',
    'zh-ms', 'ms-zh',
    'zh-th', 'th-zh',
    'zh-ar', 'ar-zh',
    'en-ja', 'ja-en',
    'en-ko', 'ko-en',
    'en-fr', 'fr-en',
    'en-de', 'de-en',
    'en-es', 'es-en',
    'en-ru', 'ru-en',
})


def _is_valid_lang_pair(pair: str) -> bool:
    return pair in SUPPORTED_PAIRS


# ---------------------------------------------------------------------------
# 配置读取 (环境变量, 模块级)
# ---------------------------------------------------------------------------
def _get_config():
    return {
        'app_id': os.environ.get('VOLC_TRANSLATE_APP_ID', ''),
        'token': os.environ.get('VOLC_TRANSLATE_TOKEN', ''),
        'endpoint': os.environ.get(
            'VOLC_TRANSLATE_ENDPOINT',
            'https://openspeech.bytedance.com/api/v2/simultaneous',
        ),
        'resource_id': os.environ.get(
            'VOLC_TRANSLATE_RESOURCE_ID',
            'volc.translate.s2t.v2',
        ),
    }


# ---------------------------------------------------------------------------
# 缓存 (LRU, 256 条; key = sha1(text|src|tgt); 线程安全)
# ---------------------------------------------------------------------------
_CACHE_MAX = 256
_translation_cache: "OrderedDict[str, dict]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_key(text: str, source_lang: str, target_lang: str) -> str:
    raw = f"{source_lang}|{target_lang}|{text}"
    return hashlib.sha1(raw.encode('utf-8')).hexdigest()


def clear_cache() -> None:
    """清空翻译缓存 (测试 / 切换语言对时用)"""
    with _cache_lock:
        _translation_cache.clear()


def _cache_get(key: str) -> Optional[dict]:
    with _cache_lock:
        if key not in _translation_cache:
            return None
        # LRU: 移到末尾
        val = _translation_cache.pop(key)
        _translation_cache[key] = val
        return val


def _cache_set(key: str, value: dict) -> None:
    with _cache_lock:
        if key in _translation_cache:
            _translation_cache.pop(key)
        _translation_cache[key] = value
        while len(_translation_cache) > _CACHE_MAX:
            _translation_cache.popitem(last=False)


# ---------------------------------------------------------------------------
# 请求构造
# ---------------------------------------------------------------------------
def _build_request(
    text: str,
    source_lang: str,
    target_lang: str,
    session_id: str = '',
) -> str:
    """
    构造火山引擎同声传译 2.0 标准 JSON body

    顶层 keys: app / user / audio (固定) / request / session
    """
    cfg = _get_config()
    reqid = f"{uuid.uuid4().hex}:{int(time.time() * 1000)}"
    body = {
        'app': {
            'appid': cfg['app_id'],
            'token': cfg['token'],
            'resource_id': cfg['resource_id'],
        },
        'user': {
            'uid': 'voice-portfolio-translate',
        },
        'audio': {
            'encoding': 'pcm',
            'sample_rate': 16000,
        },
        'request': {
            'reqid': reqid,
            'text': text,
            'source_language': source_lang,
            'target_language': target_lang,
            'mode': 's2t',  # 文本→文本 (与 s2sa 音频对应)
        },
        'session': {
            'session_id': session_id or f"trans-{uuid.uuid4().hex[:8]}",
        },
    }
    return json.dumps(body, ensure_ascii=False)


# ---------------------------------------------------------------------------
# HTTP POST 实现 (供 translate_once 用, 注入点便于 mock)
# ---------------------------------------------------------------------------
def _post_translate(url: str, body: str, timeout: float = 5.0) -> dict:
    """
    实际发 POST 请求, 返回 parsed JSON dict.

    注入点: 测试可 mock 掉它 (test_translate_once_* 系列).
    """
    try:
        import urllib.request
        req = urllib.request.Request(
            url,
            data=body.encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'Authorization': f"Bearer; {_get_config()['token']}",
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode('utf-8')
            return json.loads(raw)
    except Exception as e:
        raise TranslationError(f"network error: {e}") from e


# ---------------------------------------------------------------------------
# OTel 桩 (与 volcengine_session.py 同模式)
# ---------------------------------------------------------------------------
try:
    from opentelemetry import trace as _otel_trace
    _OTEL_AVAILABLE = True
except ImportError:
    _otel_trace = None  # type: ignore
    _OTEL_AVAILABLE = False


def _start_outbound_span(name: str, attributes: Optional[dict] = None):
    if not _OTEL_AVAILABLE:
        class _NoopSpan:
            def __enter__(self_inner): return self_inner
            def __exit__(self_inner, *args): return False
            def set_attribute(self_inner, k, v): pass
            def set_status(self_inner, *args, **kwargs): pass
            def record_exception(self_inner, *args, **kwargs): pass
            def end(self_inner): pass
        return _NoopSpan()
    tracer = _otel_trace.get_tracer('volc-translate', '1.0.0')
    return tracer.start_span(name, attributes=attributes or {})


# ---------------------------------------------------------------------------
# 同步调用: translate_once
# ---------------------------------------------------------------------------
def translate_once(
    text: str,
    source_lang: str,
    target_lang: str,
    session_id: str = '',
    use_cache: bool = True,
) -> dict:
    """
    同步翻译: 给一段文本, 返回 {translation, source_language, target_language, latency_ms}.

    抛 MisconfiguredError / InvalidLanguagePairError / TranslationError.
    """
    cfg = _get_config()
    if not cfg['app_id'] or not cfg['token']:
        metrics.translation_errors_total.labels(reason='misconfigured').inc()
        raise MisconfiguredError('VOLC_TRANSLATE_APP_ID / VOLC_TRANSLATE_TOKEN 未配置')

    pair = f"{source_lang}-{target_lang}"
    if not _is_valid_lang_pair(pair):
        metrics.translation_errors_total.labels(reason='invalid_pair').inc()
        raise InvalidLanguagePairError(f"unsupported language pair: {pair}")

    text = (text or '').strip()
    if not text:
        return {
            'translation': '',
            'source_language': source_lang,
            'target_language': target_lang,
            'latency_ms': 0,
            'cached': False,
        }

    # 缓存命中
    if use_cache:
        ck = _cache_key(text, source_lang, target_lang)
        cached = _cache_get(ck)
        if cached is not None:
            metrics.translation_cache_hits_total.labels(lang_pair=pair).inc()
            metrics.translation_requests_total.labels(lang_pair=pair, status='cache_hit').inc()
            _log.info(
                "[Translation] cache hit text_len=%d, lang_pair=%s",
                len(text), pair,
            )
            return {**cached, 'cached': True}

    # 实际请求
    start = time.time()
    with _start_outbound_span(
        'translation.invoke',
        {'translation.text_len': len(text), 'translation.lang_pair': pair},
    ):
        body = _build_request(text, source_lang, target_lang, session_id=session_id)
        try:
            resp = _post_translate(cfg['endpoint'], body)
        except TranslationError as e:
            metrics.translation_requests_total.labels(lang_pair=pair, status='error').inc()
            metrics.translation_errors_total.labels(reason='network').inc()
            metrics.translation_latency_ms.observe((time.time() - start) * 1000)
            _log.error(
                "[Translation] network error text_len=%d, lang_pair=%s, err=%s",
                len(text), pair, e,
            )
            raise

    latency_ms = (time.time() - start) * 1000

    # API 返回 code != 0
    code = resp.get('code', 0)
    if code != 0:
        msg = resp.get('message', f'code={code}')
        metrics.translation_requests_total.labels(lang_pair=pair, status='error').inc()
        metrics.translation_errors_total.labels(reason=f'api_code_{code}').inc()
        metrics.translation_latency_ms.observe(latency_ms)
        _log.error(
            "[Translation] api error text_len=%d, lang_pair=%s, code=%s, msg=%s, latency_ms=%.1f",
            len(text), pair, code, msg, latency_ms,
        )
        raise TranslationError(f"translate api error: code={code}, msg={msg}")

    data = resp.get('data') or {}
    translated = data.get('translation', '')
    result = {
        'translation': translated,
        'source_language': data.get('source_language', source_lang),
        'target_language': data.get('target_language', target_lang),
        'latency_ms': data.get('latency_ms', round(latency_ms, 2)),
        'cached': False,
    }

    metrics.translation_requests_total.labels(lang_pair=pair, status='success').inc()
    metrics.translation_latency_ms.observe(latency_ms)

    if use_cache and translated:
        _cache_set(_cache_key(text, source_lang, target_lang), result)

    _log.info(
        "[Translation] text_len=%d, latency_ms=%.1f, lang_pair=%s, translated_len=%d",
        len(text), latency_ms, pair, len(translated),
    )
    return result


# ---------------------------------------------------------------------------
# 流式调用: translate_stream
# ---------------------------------------------------------------------------
def translate_stream(
    text: str,
    source_lang: str,
    target_lang: str,
    on_partial: Callable[[str, str], None],
    on_final: Callable[[str, str, float], None],
    on_error: Callable[[int, str], None],
    session_id: str = '',
    _ws_factory: Optional[Callable] = None,
) -> None:
    """
    流式翻译 (同步, 但通过回调发出 partial / final / error 帧).

    注入点 _ws_factory: 测试可传入 FakeWS, 跳过真实 WebSocket 连接.
    默认 _ws_factory 用 websocket-client create_connection.
    """
    cfg = _get_config()
    if not cfg['app_id'] or not cfg['token']:
        on_error(0, 'translation misconfigured')
        return

    pair = f"{source_lang}-{target_lang}"
    if not _is_valid_lang_pair(pair):
        on_error(400, f"unsupported language pair: {pair}")
        return

    text = (text or '').strip()
    if not text:
        on_final('', pair, 0.0)
        return

    # 构造 WebSocket URL (http→ws, https→wss)
    ws_url = cfg['endpoint'].replace('https://', 'wss://').replace('http://', 'ws://')
    headers = [
        f"X-Api-App-Key: {cfg['app_id']}",
        f"X-Api-Access-Key: {cfg['token']}",
        f"X-Api-Resource-Id: {cfg['resource_id']}",
        f"Authorization: Bearer; {cfg['token']}",
    ]

    with _start_outbound_span(
        'translation.stream',
        {'translation.text_len': len(text), 'translation.lang_pair': pair},
    ):
        start = time.time()

        # 建立 WS (注入点: 测试传入 _ws_factory)
        if _ws_factory is not None:
            ws = _ws_factory(ws_url, headers)
        else:
            try:
                from websocket import create_connection  # type: ignore
                ws = create_connection(ws_url, header=headers, timeout=5.0)
            except Exception as e:
                on_error(0, f"ws connect failed: {e}")
                return

        # 发请求
        body = _build_request(text, source_lang, target_lang, session_id=session_id)
        try:
            ws.send(body)
        except Exception as e:
            on_error(0, f"ws send failed: {e}")
            return

        # 读循环
        try:
            while True:
                try:
                    raw = ws.recv()
                except EOFError:
                    break
                except Exception as e:
                    on_error(0, f"ws recv error: {e}")
                    break
                if not raw:
                    continue
                try:
                    frame = json.loads(raw) if isinstance(raw, str) else json.loads(raw.decode('utf-8'))
                except Exception:
                    continue

                ftype = frame.get('type')
                if ftype == 'partial':
                    on_partial(frame.get('text', ''), pair)
                elif ftype == 'final':
                    latency_ms = frame.get('latency_ms') or ((time.time() - start) * 1000)
                    on_final(frame.get('text', ''), pair, float(latency_ms))
                    break
                elif ftype == 'error':
                    on_error(int(frame.get('code', 0)), str(frame.get('message', 'unknown')))
                    break
        finally:
            try:
                ws.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# WebSocket endpoint 适配 (供 app.py 注册)
# ---------------------------------------------------------------------------
def make_socketio_handlers(socketio, logger, get_session_id=None):
    """
    返回一组 SocketIO 事件 handler (供 app.py 挂到 /api/translate/stream)

    事件:
        translate_subscribe  → 订阅语言对, 后台起一条 translation stream
        translate_unsubscribe → 取消订阅
    """
    active_streams: dict = {}
    active_lock = threading.Lock()

    def on_translate_subscribe(data):
        sid = get_session_id() if get_session_id else None
        if not sid:
            return
        text = (data or {}).get('text', '')
        src = (data or {}).get('source_lang', 'zh')
        tgt = (data or {}).get('target_lang', 'en')
        # 推送一次同步结果 (流式在此基础上扩展)
        try:
            result = translate_once(text=text, source_lang=src, target_lang=tgt, session_id=sid)
            socketio.emit('translation_result', {
                'text': result['translation'],
                'source_language': result['source_language'],
                'target_language': result['target_language'],
                'latency_ms': result['latency_ms'],
                'cached': result.get('cached', False),
                'is_final': True,
                'timestamp': time.time(),
            }, to=sid)
        except (MisconfiguredError, InvalidLanguagePairError, TranslationError) as e:
            socketio.emit('translation_error', {
                'message': str(e),
                'source': 'translation',
            }, to=sid)
            logger.error(f"translate_subscribe failed: {e}", extra={'session_id': sid, 'event_type': 'translation_error'})

    def on_translate_unsubscribe(data=None):
        sid = get_session_id() if get_session_id else None
        with active_lock:
            for k in list(active_streams.keys()):
                if k.startswith(f"{sid}:"):
                    active_streams[k].set()
                    del active_streams[k]

    return {
        'translate_subscribe': on_translate_subscribe,
        'translate_unsubscribe': on_translate_unsubscribe,
    }