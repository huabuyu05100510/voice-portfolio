"""
火山引擎实时语音转写 - Flask + SocketIO 应用对象
仅定义 app / socketio / handlers, 不做任何模块级副作用.
启动逻辑见 run_server.py

替代之前的 Vosk 实现: 每个 sid 对应一条独立的火山引擎 WSS 长连接
(VolcengineSession), 由后台读线程解析服务端响应, 路由回对应 sid 的 socket.
"""
import os
import time
import json
import threading
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response
from flask_socketio import SocketIO, emit

from config import Config
from logger import StructuredLogger, traceparent_to_trace_id
from metrics import MetricsCollector, safe_value, safe_observe_sum
from rate_limiter import RateLimiter
import tts as tts_module  # SeedTTS 2.0 (语音合成 2.0) 代理

# Flask + SocketIO 单例 (无副作用)
app = Flask(__name__, static_folder='../client/dist', template_folder='../client/public', static_url_path='/static')
app.config.from_object(Config)

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='threading',
    ping_timeout=60,
    ping_interval=25,
    allow_upgrades=True,
    transports=['websocket', 'polling'],
)

# 火山引擎配置 (由 boot_app() 校验)
# 路径: app.py 在 server/ 目录
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))

# 运行期对象 (由 boot_app() 填充)
logger: StructuredLogger = None  # type: ignore
metrics: MetricsCollector = None  # type: ignore
rate_limiter: RateLimiter = None  # type: ignore
volc_config: dict = None  # type: ignore

# sid → 会话对象 (启动后才填充)
sessions: dict = {}
sessions_lock = threading.Lock()


def boot_app():
    """
    应用启动函数 (替代模块级副作用, 避免 multiprocessing.spawn 重新执行时冲突)
    由 run_server.py 在 if __name__ == '__main__' 下调用
    """
    global logger, metrics, rate_limiter, volc_config

    # 延迟导入, 避免在 spawn re-import 时加载
    from prometheus_client import start_http_server
    from volcengine_session import VolcengineSession

    logger = StructuredLogger('volc-server')
    metrics = MetricsCollector()
    rate_limiter = RateLimiter()
    # 把 metrics 注入 tts 模块 (否则 tts._get_metrics() 走 noop)
    tts_module.metrics = metrics

    # 录音文件识别 2.0 路由 (异步任务式, 不依赖 volcengine_session)
    from file_asr import register_routes as _file_asr_register
    _file_asr_register(app)

    # 校验火山引擎配置
    if not Config.VOLC_APP_KEY or not Config.VOLC_ACCESS_TOKEN:
        logger.warning(
            "VOLC_APP_KEY / VOLC_ACCESS_TOKEN 未配置, 火山引擎会话将无法建立",
            extra={'event_type': 'volcengine_misconfigured'},
        )

    volc_config = {
        'app_key': Config.VOLC_APP_KEY,
        'access_token': Config.VOLC_ACCESS_TOKEN,
        'api_key': Config.VOLC_API_KEY,  # 新控制台: X-Api-Key 单一鉴权
        'resource_id': Config.VOLC_RESOURCE_ID,
        'model_name': Config.VOLC_MODEL_NAME,
        'endpoint': Config.VOLC_ENDPOINT,
    }
    # 解析 VOLC_EXTRA_REQUEST (JSON 字符串), 用于豆包同声传译 s2t 模式
    import json
    extra_request = None
    if Config.VOLC_EXTRA_REQUEST:
        try:
            extra_request = json.loads(Config.VOLC_EXTRA_REQUEST)
        except Exception as e:
            logger.warning(f"VOLC_EXTRA_REQUEST 解析失败: {e}, 忽略")
    volc_config['extra_request'] = extra_request

    # 音色设计 (Voice Design) 路由 — 不依赖 volcengine_session, 纯 HTTP 转发
    try:
        import voice_design as _vd_module
        app.config['VOICE_DESIGN_APP_KEY'] = Config.VOLC_VOICE_DESIGN_APP_ID
        app.config['VOICE_DESIGN_TOKEN'] = Config.VOLC_VOICE_DESIGN_TOKEN
        app.config['VOICE_DESIGN_ENDPOINT'] = Config.VOLC_VOICE_DESIGN_ENDPOINT
        app.config['VOICE_DESIGN_CLUSTER'] = Config.VOLC_VOICE_DESIGN_CLUSTER
        _vd_module.register_voice_design_routes(app, logger=logger, metrics=metrics)
        logger.info(
            f"音色设计路由已挂载: endpoint={Config.VOLC_VOICE_DESIGN_ENDPOINT}, "
            f"cluster={Config.VOLC_VOICE_DESIGN_CLUSTER}, "
            f"app_id_set={bool(Config.VOLC_VOICE_DESIGN_APP_ID)}",
            extra={'event_type': 'voice_design_mounted'},
        )
    except Exception as e:
        logger.warning(f"音色设计路由挂载失败: {e}", extra={
            'event_type': 'voice_design_mount_failed',
        })

    # Prometheus
    start_http_server(Config.PROMETHEUS_PORT)
    logger.info(f"Prometheus metrics server started on port {Config.PROMETHEUS_PORT}")
    logger.info(
        f"火山引擎配置: endpoint={Config.VOLC_ENDPOINT}, "
        f"resource_id={Config.VOLC_RESOURCE_ID}, model={Config.VOLC_MODEL_NAME}, "
        f"app_key={'set' if Config.VOLC_APP_KEY else 'MISSING'}",
        extra={'event_type': 'volcengine_config', 'metadata': volc_config_safe()},
    )

    # 语音播客大模型路由 (P0 注册, 凭证从环境变量 / Config 注入)
    from podcast import register_podcast_routes
    register_podcast_routes(app)
    logger.info(
        "Podcast routes registered: /api/podcast/{styles,generate,task/<id>}",
        extra={'event_type': 'podcast_routes_registered'},
    )

    # 端到端实时语音交互路由 (Sprint 13 / MiniMax-M3)
    # 凭证从环境变量注入, 缺失时仅记录警告, 启动不中断
    # (健康检查端点 /api/realtime/health 会报告 configured=false).
    try:
        from realtime_voice import register_realtime_routes, build_realtime_client_from_env
        rt_client = build_realtime_client_from_env()
        register_realtime_routes(app, client_factory=lambda: rt_client)
        logger.info(
            f"Realtime Voice 路由已挂载: endpoint={Config.VOLC_REALTIME_ENDPOINT}, "
            f"model={Config.VOLC_REALTIME_MODEL}, "
            f"app_id_set={bool(Config.VOLC_REALTIME_APP_ID)}, "
            f"token_set={bool(Config.VOLC_REALTIME_TOKEN)}",
            extra={'event_type': 'realtime_voice_mounted'},
        )
    except Exception as e:
        logger.warning(f"Realtime Voice 路由挂载失败: {e}", extra={
            'event_type': 'realtime_voice_mount_failed',
            'metadata': {'reason': str(e)[:200]},
        })

    # ========================================================================
    # Realtime Voice WSS proxy via SocketIO (Sprint 19 fix)
    # Browser connects via SocketIO → server proxies to Volcengine Realtime WSS.
    # Events:
    #   realtime_start  → connect to Volcengine WSS, send session.update
    #   realtime_audio  → forward audio bytes (base64) to Volcengine WSS
    #   realtime_stop   → close Volcengine WSS
    #   disconnect      → cleanup
    # Server pushes Volcengine events back via realtime_event → client.
    # ========================================================================
    global _rt_sessions, _rt_sessions_lock
    _rt_sessions = {}  # sid → ws, thread, config
    _rt_sessions_lock = threading.Lock()

    @socketio.on('realtime_start')
    def _on_realtime_start(data=None):
        sid = request.sid
        if not Config.VOLC_REALTIME_APP_ID or not Config.VOLC_REALTIME_TOKEN:
            emit('realtime_event', {
                'type': 'error',
                'message': '火山引擎 Realtime 凭证未配置 (VOLC_REALTIME_APP_ID / VOLC_REALTIME_TOKEN)',
            })
            logger.warning("Realtime start rejected: credentials missing", extra={
                'session_id': sid, 'event_type': 'realtime_creds_missing',
            })
            return

        # Clean up any existing connection for this sid
        with _rt_sessions_lock:
            _cleanup_rt_session(sid)

        try:
            from websocket import create_connection as _ws_create_connection
        except ImportError:
            emit('realtime_event', {
                'type': 'error',
                'message': 'websocket-client 未安装',
            })
            logger.error("websocket-client not installed", extra={
                'session_id': sid, 'event_type': 'realtime_wsclient_missing',
            })
            return

        # Auth headers for Volcengine Realtime WSS
        headers = {
            "Authorization": f"Bearer; {Config.VOLC_REALTIME_TOKEN}",
            "X-Api-App-Id": Config.VOLC_REALTIME_APP_ID,
            "X-Api-Resource-Id": "volc.speech.realtime_voice",
        }
        ws_url = Config.VOLC_REALTIME_ENDPOINT
        model = Config.VOLC_REALTIME_MODEL

        def _reader_thread(sid2, ws2, stop_event):
            """Background thread: read Volcengine WSS events → emit to SocketIO client."""
            try:
                while not stop_event.is_set():
                    try:
                        ws2.settimeout(0.5)
                        raw = ws2.recv()
                    except Exception as e:
                        err_str = str(e).lower()
                        if 'timeout' in err_str:
                            continue
                        break
                    if isinstance(raw, (bytes, bytearray)):
                        raw = raw.decode('utf-8', errors='replace')
                    try:
                        obj = json.loads(raw)
                    except Exception:
                        continue
                    # Push to browser client
                    socketio.emit('realtime_event', obj, to=sid2)
                    if obj.get('type') == 'error':
                        logger.warning(f"Volcengine Realtime error: {obj}", extra={
                            'session_id': sid2, 'event_type': 'realtime_volc_error',
                        })
            except Exception as e:
                logger.warning(f"Realtime reader thread exit: {e}", extra={
                    'session_id': sid2, 'event_type': 'realtime_reader_exit',
                })
            finally:
                try:
                    ws2.close()
                except Exception:
                    pass

        try:
            ws = _ws_create_connection(ws_url, header=headers, timeout=10)
        except Exception as e:
            logger.error(f"Realtime WSS connect failed: {e}", extra={
                'session_id': sid, 'event_type': 'realtime_wss_connect_failed',
                'metadata': {'endpoint': ws_url, 'error': str(e)[:200]},
            })
            emit('realtime_event', {
                'type': 'error',
                'message': f'连接火山引擎 Realtime 失败: {str(e)[:200]}',
            })
            return

        # Send session.update
        session_update = {
            "type": "session.update",
            "session": {
                "model": model,
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "turn_detection": {
                    "type": "server_vad",
                    "silence_duration_ms": 400,
                    "threshold": 0.5,
                },
            },
        }
        try:
            ws.send(json.dumps(session_update))
        except Exception as e:
            logger.error(f"Realtime session.update failed: {e}", extra={
                'session_id': sid, 'event_type': 'realtime_session_update_failed',
            })
            try:
                ws.close()
            except Exception:
                pass
            emit('realtime_event', {
                'type': 'error',
                'message': f'session.update 发送失败: {str(e)[:200]}',
            })
            return

        stop_event = threading.Event()
        reader = threading.Thread(
            target=_reader_thread,
            args=(sid, ws, stop_event),
            daemon=True,
            name=f'rt-reader-{sid[:12]}',
        )
        reader.start()

        with _rt_sessions_lock:
            _rt_sessions[sid] = {'ws': ws, 'thread': reader, 'stop_event': stop_event}

        emit('realtime_event', {
            'type': 'realtime_ready',
            'model': model,
            'endpoint': ws_url,
        })
        logger.info("Realtime WSS connected", extra={
            'session_id': sid, 'event_type': 'realtime_wss_connected',
            'metadata': {'endpoint': ws_url, 'model': model},
        })

    @socketio.on('realtime_audio')
    def _on_realtime_audio(data=None):
        """Forward audio chunk (base64) from browser to Volcengine Realtime WSS."""
        sid = request.sid
        with _rt_sessions_lock:
            sess = _rt_sessions.get(sid)
        if not sess or not sess.get('ws'):
            logger.warning("realtime_audio: no WSS session for sid", extra={
                'session_id': sid, 'event_type': 'realtime_audio_no_session',
            })
            return
        ws = sess['ws']
        audio_b64 = (data or {}).get('audio', '')
        if not audio_b64:
            return
        try:
            payload = json.dumps({
                "type": "input_audio_buffer.append",
                "audio": audio_b64,
            })
            ws.send(payload)
        except Exception as e:
            logger.error(f"realtime_audio send failed: {e}", extra={
                'session_id': sid, 'event_type': 'realtime_audio_send_failed',
            })
            emit('realtime_event', {
                'type': 'error',
                'message': f'音频发送失败: {str(e)[:200]}',
            })

    @socketio.on('realtime_stop')
    def _on_realtime_stop(data=None):
        """Close the Volcengine Realtime WSS connection."""
        sid = request.sid
        with _rt_sessions_lock:
            sess = _rt_sessions.pop(sid, None)
        if sess:
            _cleanup_rt_session_from_dict(sid, sess)
            emit('realtime_event', {'type': 'realtime_stopped'})
        logger.info("Realtime session stopped", extra={
            'session_id': sid, 'event_type': 'realtime_stopped',
        })

    def _cleanup_rt_session(sid):
        """Remove and clean up a realtime session (caller holds _rt_sessions_lock)."""
        sess = _rt_sessions.pop(sid, None)
        if sess:
            _cleanup_rt_session_from_dict(sid, sess)

    def _cleanup_rt_session_from_dict(sid, sess):
        """Clean up a realtime session dict without holding the lock."""
        stop_event = sess.get('stop_event')
        if stop_event:
            stop_event.set()
        # Give reader thread a moment to exit
        if sess.get('thread') and sess['thread'].is_alive():
            sess['thread'].join(timeout=1.0)
        try:
            if sess.get('ws'):
                sess['ws'].close()
        except Exception:
            pass


def volc_config_safe():
    """用于日志的配置快照 (脱敏)"""
    return {
        'endpoint': Config.VOLC_ENDPOINT,
        'resource_id': Config.VOLC_RESOURCE_ID,
        'model_name': Config.VOLC_MODEL_NAME,
        'app_key_set': bool(Config.VOLC_APP_KEY),
        'token_set': bool(Config.VOLC_ACCESS_TOKEN),
    }


def shutdown_app():
    """关闭所有 volcengine session (供测试 / 优雅退出使用)"""
    with sessions_lock:
        for sid, sess in list(sessions.items()):
            try:
                sess.close()
            except Exception:
                pass
        sessions.clear()
    # Clean up realtime voice WSS sessions
    with _rt_sessions_lock:
        for sid in list(_rt_sessions.keys()):
            _cleanup_rt_session(sid)


# ============================================================================
# 会话管理
# ============================================================================
def create_session(session_id: str, client_type: str = 'web') -> dict:
    session = {
        'id': session_id,
        'start_time': time.time(),
        'status': 'ready',
        'text_buffer': '',
        'volc_session': None,
        'speakers_seen': {},  # speaker_id → {label, first_seen_at}
        'current_speaker_id': None,
        'last_known_speaker_id': None,  # P0-3: sticky speaker, partial fallback 用
        'last_metrics_emit_at': 0.0,  # F6: 节流 session_status 推送
        'metrics': {
            'audio_bytes': 0,
            'transcription_chars': 0,
            'latencies': [],
            'chunks_processed': 0,
            'volc_frames_sent': 0,
            'speaker_count': 0,
        },
    }
    sessions[session_id] = session
    metrics.connections_total.labels(client_type=client_type).inc()
    metrics.connections_active.inc()
    logger.info("Session created", extra={
        'session_id': session_id, 'event_type': 'session_create',
    })
    return session


def get_session(session_id: str):
    return sessions.get(session_id)


def end_session(session_id: str):
    session = sessions.pop(session_id, None)
    if session:
        # 关闭火山会话
        vs = session.get('volc_session')
        if vs:
            try:
                vs.close()
            except Exception:
                pass
        duration = time.time() - session['start_time']
        try:
            metrics.connections_active.dec()
        except ValueError:
            pass
        metrics.connection_duration.observe(duration)
        logger.info("Session ended", extra={
            'session_id': session_id, 'event_type': 'session_end',
            'metadata': {
                'duration_seconds': round(duration, 2),
                'total_chars': session['metrics']['transcription_chars'],
                'total_audio_bytes': session['metrics']['audio_bytes'],
                'speaker_count': session['metrics']['speaker_count'],
            }
        })
    return session


# ============================================================================
# 火山回调 → SocketIO emit
# ============================================================================
def _on_volc_partial(text: str, sid: str):
    session = sessions.get(sid)
    if not session:
        return
    metrics.transcription_results_total.labels(is_final='false').inc()
    # partial 没有 speaker_id, fallback: 当前说话人 → 最近已知说话人
    speaker_id = session.get('current_speaker_id') or session.get('last_known_speaker_id')
    payload = {
        'text': text,
        'is_final': False,
        'full_text': session['text_buffer'],
        'latency_ms': 0,
        'speaker_id': speaker_id,
        'speakers': list(session.get('speakers_seen', {}).values()),
        'timestamp': datetime.utcnow().isoformat(),
    }
    socketio.emit('transcription_result', payload, to=sid)


def _on_volc_final(text: str, utterances: list, speakers: list, latency_ms: float = 0, sid: str = None):
    session = sessions.get(sid) if sid else None
    if not session:
        return

    metrics.transcription_results_total.labels(is_final='true').inc()
    metrics.transcription_chars_total.labels(language='zh').inc(len(text))
    session['metrics']['transcription_chars'] += len(text)  # F4: 修复 chars 计数从未增加的 bug

    from text_buffer import smart_append, get_last_speaker, extract_text_from_utterances

    # F5: 去除双重 smart_append 导致的内容重复
    # 优先用 utterances 拼接（多说话人场景更精确），没有时才用 result.text
    if utterances:
        utt_text = extract_text_from_utterances(utterances)
        merge_text = utt_text if utt_text else text
    else:
        merge_text = text

    # 火山引擎 v3 sauc 是累积协议: 同一轮发言内每次 final 返回当前这句话的全文,
    # 文本单调增长 (实测 3→8→...→74), 轮次切换/句号后才重置.
    # is_cumulative=True 让 reducer path A (前缀扩展 → 就地更新) 工作,
    # 同一说话人的连续语音只在一张卡片里增长, 不再裂成几十段.
    session['text_buffer'], _ = smart_append(session['text_buffer'], merge_text)
    is_cumulative = True

    # 更新说话人池 (前端需要稳定 id→label 映射)
    # Sprint 10: 按首次出现顺序分配 label
    speaker_pool = session.setdefault('speakers_seen', {})
    for s in speakers or []:
        spk_id = s.get('id')
        if spk_id and spk_id not in speaker_pool:
            speaker_pool[spk_id] = {
                'id': spk_id,
                'label': s.get('label', f"发言人 {len(speaker_pool) + 1}"),
            }
    # 还要扫描 utterances 里的所有 speaker_id, 避免遗漏
    for u in utterances or []:
        additions = u.get('additions') or {}
        spk_id = additions.get('speaker_id') or u.get('speaker_id')
        if spk_id and spk_id not in speaker_pool:
            speaker_pool[spk_id] = {
                'id': spk_id,
                'label': f"发言人 {len(speaker_pool) + 1}",
            }
    session['metrics']['speaker_count'] = len(speaker_pool)

    # Sprint 10: current_speaker 取最后一个 utterance 的 speaker (当前正在说话的人)
    current_speaker = get_last_speaker(utterances) if utterances else None
    if not current_speaker:
        # fallback 到 result-level speaker_id
        current_speaker = None
    session['current_speaker_id'] = current_speaker
    # P0-3: sticky speaker — 只在确实解析到时才覆盖, partial 帧据此 fallback
    if current_speaker:
        session['last_known_speaker_id'] = current_speaker
    # 累积中间帧 (utterance_count=1) 火山引擎不返 speaker_id,
    # final payload 必须也 fallback 到 last_known, 否则 UI 全是"未知说话人".
    resolved_speaker = current_speaker or session.get('last_known_speaker_id')

    if latency_ms and latency_ms > 0:
        session['metrics']['latencies'].append(latency_ms)
        metrics.transcription_latency.observe(latency_ms)

    payload = {
        'text': text,
        'is_final': True,
        'is_cumulative': is_cumulative,  # F2: 客户端据此选择合并策略
        'full_text': session['text_buffer'],
        'latency_ms': round(latency_ms or 0, 2),
        'speaker_id': resolved_speaker,
        'speakers': list(speaker_pool.values()),
        'utterances': utterances or [],
        'timestamp': datetime.utcnow().isoformat(),
    }
    socketio.emit('transcription_result', payload, to=sid)
    logger.info("Transcription final", extra={
        'session_id': sid, 'event_type': 'transcription_final',
        'metadata': {
            'text_length': len(text),
            'utterance_count': len(utterances or []),
            'speaker_id': resolved_speaker,
            'is_unknown_speaker': resolved_speaker is None,
            'speaker_count': len(speaker_pool),
            'latency_ms': round(latency_ms or 0, 2),
        }
    })


def _on_volc_error(code: int, message: str, sid: str = None):
    logger.error(f"火山引擎错误: code={code}, msg={message}", extra={
        'session_id': sid, 'event_type': 'volcengine_error',
        'metadata': {'error_code': code, 'error_message': str(message)[:200]},
    })
    metrics.transcription_errors_total.labels(error_type=f'volc_{code}').inc()
    if sid:
        socketio.emit('error', {
            'message': f'火山引擎错误 ({code}): {str(message)[:200]}',
            'source': 'volcengine',
            'code': code,
        }, to=sid)


# ============================================================================
# WebSocket 事件
# ============================================================================
@socketio.on('connect')
def handle_connect(auth=None):
    if not metrics:
        return False  # 还没启动完, 拒绝连接
    session_id = request.sid
    client_type = 'web'
    # Module B: 从 Socket.IO auth 提取 W3C traceparent (跨进程 trace 关联)
    traceparent = None
    if isinstance(auth, dict):
        client_type = auth.get('client_type', 'web')
        traceparent = auth.get('traceparent')

    # Task 13.8: 连接池容量限制
    with sessions_lock:
        current_count = len(sessions)
    if current_count >= Config.MAX_CONCURRENT_SESSIONS:
        logger.warning(
            'connection_rejected: server at capacity',
            extra={
                'session_id': session_id,
                'event_type': 'connection_rejected',
                'metadata': {
                    'reason': 'at_capacity',
                    'current': current_count,
                    'max': Config.MAX_CONCURRENT_SESSIONS,
                },
            },
        )
        if metrics:
            metrics.connections_rejected_total.inc()
        emit('error', {
            'message': 'Server at capacity. Please try again later.',
            'code': 'AT_CAPACITY',
            'retry_after_ms': 5000,
        })
        return False  # reject the connection

    session = create_session(session_id, client_type=client_type)
    # Module B: 把解析后的 trace_id 挂到 session, 后续日志关联用
    if traceparent and session is not None:
        parsed_tid = traceparent_to_trace_id(traceparent)
        if parsed_tid:
            session['trace_id'] = parsed_tid
    emit('connected', {
        'session_id': session_id,
        'status': 'ready',
        'timestamp': datetime.utcnow().isoformat(),
        'volcengine_ready': bool(Config.VOLC_APP_KEY and Config.VOLC_ACCESS_TOKEN),
    })
    log_extra = {
        'session_id': session_id, 'event_type': 'connection',
        'metadata': {'client_type': client_type},
    }
    if traceparent and session is not None and session.get('trace_id'):
        log_extra['trace_id'] = session['trace_id']
        log_extra['metadata']['traceparent'] = traceparent
    logger.info("Client connected", extra=log_extra)


@socketio.on('disconnect')
def handle_disconnect(reason=None):
    if not metrics:
        return
    session_id = request.sid
    end_session(session_id)
    # Clean up realtime voice session if active
    try:
        with _rt_sessions_lock:
            _cleanup_rt_session(session_id)
    except NameError:
        pass  # _rt_sessions_lock not yet initialized (boot_app not called)
    if logger:
        logger.info("Client disconnected", extra={
            'session_id': session_id, 'event_type': 'disconnect',
        })


@socketio.on('start_recording')
def handle_start_recording(data=None):
    if not metrics:
        emit('error', {'message': 'Server not ready'})
        return
    session_id = request.sid
    session = get_session(session_id)
    if not session:
        emit('error', {'message': 'Session not found'})
        return

    # 检查配置
    if not Config.VOLC_APP_KEY or not Config.VOLC_ACCESS_TOKEN:
        emit('error', {
            'message': '火山引擎凭据未配置 (VOLC_APP_KEY / VOLC_ACCESS_TOKEN)',
            'source': 'config',
        })
        return

    # 懒加载 VolcengineSession
    from volcengine_session import VolcengineSession

    # v3 协议: 第一帧只发 config (full request 不带音频), 后续 audio-only 帧独立发送
    volc_sess = VolcengineSession(
        sid=session_id,
        config=volc_config,
        on_partial=_on_volc_partial,
        on_final=_on_volc_final,
        on_error=_on_volc_error,
        enable_diarization=True,
        extra_request=volc_config.get('extra_request'),
    )
    session['volc_session'] = volc_sess
    volc_sess.start()

    # F1: 等待 WSS 握手 + full request 发送完成，再告知客户端
    ready = volc_sess.wait_until_ready(timeout=5.0)
    if not ready:
        emit('error', {
            'message': '火山引擎连接超时，请重试',
            'source': 'volcengine',
            'code': 'HANDSHAKE_TIMEOUT',
        })
        logger.error("Volcengine handshake timeout", extra={
            'session_id': session_id, 'event_type': 'handshake_timeout',
        })
        return

    session['status'] = 'recording'
    emit('recording_started', {
        'session_id': session_id,
        'timestamp': datetime.utcnow().isoformat(),
    })
    logger.info("Recording started", extra={
        'session_id': session_id, 'event_type': 'recording_start',
        'metadata': {'volcengine_endpoint': Config.VOLC_ENDPOINT}
    })


@socketio.on('audio_data')
def handle_audio_data(data):
    if not metrics:
        return
    session_id = request.sid
    session = get_session(session_id)
    if not session:
        emit('error', {'message': 'Session not found'})
        return

    # Task 13.7: 音频数据速率限制 (per-session token bucket)
    if rate_limiter and not rate_limiter.is_allowed(
        f'audio:{session_id}',
        rate=Config.RATE_LIMIT_AUDIO_RATE,
        burst=Config.RATE_LIMIT_AUDIO_BURST,
    ):
        emit('rate_limited', {
            'event': 'audio_data',
            'retry_after_ms': 100,
        }, to=session_id)
        return

    session['status'] = 'transcribing'
    audio_bytes = len(data) if data else 0
    session['metrics']['audio_bytes'] += audio_bytes
    session['metrics']['chunks_processed'] += 1
    metrics.audio_bytes_received.inc(audio_bytes)
    metrics.audio_chunks_processed.inc()

    volc_sess = session.get('volc_session')
    if volc_sess and audio_bytes > 0:
        try:
            volc_sess.send_audio(data)
            session['metrics']['volc_frames_sent'] += 1
        except Exception as e:
            logger.error(f"volc send_audio failed: {e}", extra={
                'session_id': session_id, 'event_type': 'send_audio_failed',
            })
            metrics.transcription_errors_total.labels(error_type='send_audio').inc()

    # F6: 节流 session_status，每 2s 最多推送一次
    METRICS_EMIT_INTERVAL = 2.0
    now = time.time()
    if now - session['last_metrics_emit_at'] >= METRICS_EMIT_INTERVAL:
        session['last_metrics_emit_at'] = now
        avg_latency = 0
        if session['metrics']['latencies']:
            avg_latency = round(
                sum(session['metrics']['latencies']) / len(session['metrics']['latencies']), 2
            )
        emit('session_status', {
            'status': session['status'],
            'metrics': {
                'audio_bytes': session['metrics']['audio_bytes'],
                'transcription_chars': session['metrics']['transcription_chars'],
                'chunks_processed': session['metrics']['chunks_processed'],
                'avg_latency': avg_latency,
                'volc_frames_sent': session['metrics']['volc_frames_sent'],
                'speaker_count': session['metrics']['speaker_count'],
            },
        })


@socketio.on('stop_recording')
def handle_stop_recording():
    if not metrics:
        return
    session_id = request.sid
    session = get_session(session_id)
    if not session:
        emit('error', {'message': 'Session not found'})
        return
    volc_sess = session.get('volc_session')
    if volc_sess:
        try:
            volc_sess.finalize()
        except Exception:
            pass

    # F7: 不立即设 completed，而是保持 transcribing 等服务端 final 到来
    # recording_stopped 仍然立即发出（告知客户端录音已停），但 status 保持 transcribing
    # 客户端在收到 recording_stopped 后继续等待最后一条 transcription_result(is_final=True)
    session['status'] = 'transcribing'
    avg_latency = 0
    if session['metrics']['latencies']:
        avg_latency = round(
            sum(session['metrics']['latencies']) / len(session['metrics']['latencies']), 2
        )
    emit('recording_stopped', {
        'session_id': session_id,
        'full_text': session['text_buffer'],
        'stats': {
            'total_chars': session['metrics']['transcription_chars'],
            'total_audio_bytes': session['metrics']['audio_bytes'],
            'total_chunks': session['metrics']['chunks_processed'],
            'avg_latency_ms': avg_latency,
            'duration_seconds': round(time.time() - session['start_time'], 2),
            'speaker_count': session['metrics']['speaker_count'],
        },
        'timestamp': datetime.utcnow().isoformat(),
    })
    logger.info("Recording stopped", extra={
        'session_id': session_id, 'event_type': 'recording_stop',
        'metadata': {
            'total_chars': session['metrics']['transcription_chars'],
            'avg_latency_ms': avg_latency,
            'speaker_count': session['metrics']['speaker_count'],
        }
    })


@socketio.on('get_metrics')
def handle_get_metrics():
    if not metrics:
        return
    session_id = request.sid
    session = get_session(session_id)
    if not session:
        emit('error', {'message': 'Session not found'})
        return
    volc_alive = False
    volc_sess = session.get('volc_session')
    if volc_sess:
        volc_alive = volc_sess.is_alive()
    emit('metrics_update', {
        'session_metrics': session['metrics'],
        'volcengine_session_alive': volc_alive,
        'server_metrics': {
            'active_connections': len(sessions),
            'total_connections': safe_value(metrics.connections_total),
            'total_chars': safe_value(metrics.transcription_chars_total),
            'total_audio_bytes': safe_value(metrics.audio_bytes_received),
            'total_errors': safe_value(metrics.transcription_errors_total),
        }
    })


# ============================================================================
# 同声传译 2.0 (Simultaneous Interpretation 2.0) — SocketIO events
# 接收源文本 → 调用火山引擎翻译 API → 推送 translation_result / translation_error
# ============================================================================
@socketio.on('translate_text')
def handle_translate_text(data=None):
    """
    客户端 → 服务端: 请求翻译一段文本
    data: { text: str, source_lang: 'zh', target_lang: 'en' }
    服务端 → 客户端: translation_result / translation_error
    """
    if not metrics:
        emit('translation_error', {'message': 'Server not ready', 'source': 'translation'})
        return
    session_id = request.sid

    # Task 13.7: 翻译请求速率限制 (per-session)
    if rate_limiter and not rate_limiter.is_allowed(
        f'translate:{session_id}',
        rate=Config.RATE_LIMIT_TRANSLATE_RATE,
        burst=Config.RATE_LIMIT_TRANSLATE_BURST,
    ):
        emit('rate_limited', {
            'event': 'translate_text',
            'retry_after_ms': 100,
        }, to=session_id)
        return

    from translation import (
        translate_once,
        MisconfiguredError,
        InvalidLanguagePairError,
        TranslationError,
    )

    text = (data or {}).get('text', '')
    src = (data or {}).get('source_lang', 'zh')
    tgt = (data or {}).get('target_lang', 'en')

    try:
        result = translate_once(text=text, source_lang=src, target_lang=tgt, session_id=session_id)
        emit('translation_result', {
            'text': result['translation'],
            'source_language': result['source_language'],
            'target_language': result['target_language'],
            'latency_ms': result['latency_ms'],
            'cached': result.get('cached', False),
            'is_final': True,
            'source_text': text,
            'timestamp': datetime.utcnow().isoformat(),
        })
        logger.info("Translation success", extra={
            'session_id': session_id, 'event_type': 'translation_success',
            'metadata': {
                'source_lang': src, 'target_lang': tgt,
                'source_len': len(text), 'target_len': len(result['translation']),
                'latency_ms': result['latency_ms'], 'cached': result.get('cached', False),
            }
        })
    except MisconfiguredError as e:
        emit('translation_error', {'message': str(e), 'source': 'translation', 'code': 'MISCONFIGURED'})
        logger.warning("Translation misconfigured", extra={
            'session_id': session_id, 'event_type': 'translation_misconfigured',
        })
    except InvalidLanguagePairError as e:
        emit('translation_error', {'message': str(e), 'source': 'translation', 'code': 'INVALID_PAIR'})
    except TranslationError as e:
        emit('translation_error', {'message': str(e), 'source': 'translation', 'code': 'API_ERROR'})
        logger.error(f"Translation error: {e}", extra={
            'session_id': session_id, 'event_type': 'translation_error',
        })


@socketio.on('translation_clear_cache')
def handle_translation_clear_cache(data=None):
    """客户端请求清空翻译缓存 (切换语言对时)"""
    from translation import clear_cache
    clear_cache()
    emit('translation_cache_cleared', {'cleared': True, 'timestamp': datetime.utcnow().isoformat()})


# ============================================================================
# REST API
# ============================================================================
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/health')
def health():
    volc_alive_count = 0
    with sessions_lock:
        for sid, session in sessions.items():
            vs = session.get('volc_session')
            if vs and vs.is_alive():
                volc_alive_count += 1
    return {
        'status': 'healthy',
        'engine': 'volcengine_v3',
        'volcengine_configured': bool(Config.VOLC_APP_KEY and Config.VOLC_ACCESS_TOKEN),
        'volcengine_endpoint': Config.VOLC_ENDPOINT,
        'volcengine_resource_id': Config.VOLC_RESOURCE_ID,
        'volcengine_connections_active': volc_alive_count,
        'active_sessions': len(sessions),
        'timestamp': datetime.utcnow().isoformat(),
    }


@app.route('/api/translate/stream', methods=['POST'])
def translate_stream_endpoint():
    """
    同声传译 2.0 REST 入口 (POST JSON, 返回 translation JSON).
    推荐生产环境使用 SocketIO 'translate_text' 事件获得流式体验;
    本 REST endpoint 适合调试 / curl 测试.

    Body: {"text": "...", "source_lang": "zh", "target_lang": "en"}
    """
    from translation import (
        translate_once,
        MisconfiguredError,
        InvalidLanguagePairError,
        TranslationError,
    )

    data = request.get_json(silent=True) or {}
    text = data.get('text', '')
    src = data.get('source_lang', 'zh')
    tgt = data.get('target_lang', 'en')
    try:
        result = translate_once(text=text, source_lang=src, target_lang=tgt)
        return {
            'ok': True,
            'text': result['translation'],
            'source_language': result['source_language'],
            'target_language': result['target_language'],
            'latency_ms': result['latency_ms'],
            'cached': result.get('cached', False),
            'timestamp': datetime.utcnow().isoformat(),
        }
    except MisconfiguredError as e:
        return {'ok': False, 'error': 'misconfigured', 'message': str(e)}, 503
    except InvalidLanguagePairError as e:
        return {'ok': False, 'error': 'invalid_pair', 'message': str(e)}, 400
    except TranslationError as e:
        return {'ok': False, 'error': 'api_error', 'message': str(e)}, 502


@app.route('/metrics/summary')
def metrics_summary():
    volc_alive_count = 0
    with sessions_lock:
        for sid, session in sessions.items():
            vs = session.get('volc_session')
            if vs and vs.is_alive():
                volc_alive_count += 1
    return {
        'engine': 'volcengine_v3',
        'connections': {
            'total': safe_value(metrics.connections_total) if metrics else 0,
            'active': len(sessions),
            'volcengine_alive': volc_alive_count,
        },
        'transcription': {
            'total_chars': safe_value(metrics.transcription_chars_total) if metrics else 0,
            'errors': safe_value(metrics.transcription_errors_total) if metrics else 0,
        },
        'audio': {
            'bytes_received': safe_value(metrics.audio_bytes_received) if metrics else 0,
            'chunks_processed': safe_value(metrics.audio_chunks_processed) if metrics else 0,
        },
        'volcengine': {
            'endpoint': Config.VOLC_ENDPOINT,
            'resource_id': Config.VOLC_RESOURCE_ID,
            'model': Config.VOLC_MODEL_NAME,
            'configured': bool(Config.VOLC_APP_KEY and Config.VOLC_ACCESS_TOKEN),
        },
        'file_asr': {
            'configured': bool(Config.VOLC_FILE_ASR_APP_ID and Config.VOLC_FILE_ASR_TOKEN),
            'cluster': Config.VOLC_FILE_ASR_CLUSTER,
        },
        'tts': {
            'requests_total': safe_value(metrics.tts_requests_total) if metrics else 0,
            'latency_avg_seconds': (
                safe_observe_sum(metrics.tts_latency_seconds) / max(safe_observe_sum(metrics.tts_latency_seconds, 'count'), 1)
            ) if metrics else 0,
            'configured': bool(os.environ.get('VOLC_TTS_APP_ID') and os.environ.get('VOLC_TTS_TOKEN')),
        },
        'timestamp': datetime.utcnow().isoformat(),
    }


# ============================================================================
# SeedTTS 2.0 REST API (server/tts.py 封装)
# ============================================================================
@app.route('/api/tts/synthesize', methods=['POST'])
def api_tts_synthesize():
    """
    POST { text, voice?, speed?, pitch?, volume?, audio_format?, sample_rate? }
    → 200 audio/* bytes  |  4xx JSON {error}  |  5xx JSON {error}
    """
    # Task 13.7: TTS 速率限制 (per-IP, 用 remote_addr 做 bucket key)
    if rate_limiter:
        client_ip = request.remote_addr or 'unknown'
        if not rate_limiter.is_allowed(
            f'tts:{client_ip}',
            rate=Config.RATE_LIMIT_TTS_RATE,
            burst=Config.RATE_LIMIT_TTS_BURST,
        ):
            logger.warning('TTS rate limited', extra={
                'event_type': 'tts_rate_limited',
                'metadata': {'client_ip': client_ip},
            })
            return jsonify({
                'error': 'Too many TTS requests. Please slow down.',
                'retry_after_ms': 200,
            }), 429

    try:
        payload = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({'error': 'invalid JSON body'}), 400
    text = (payload.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'text is required'}), 400

    try:
        audio = tts_module.synthesize(
            text=text,
            voice=payload.get('voice'),
            speed=float(payload.get('speed', 1.0) or 1.0),
            pitch=float(payload.get('pitch', 1.0) or 1.0),
            volume=float(payload.get('volume', 1.0) or 1.0),
            audio_format=payload.get('audio_format') or 'mp3',
            sample_rate=int(payload.get('sample_rate', 24000) or 24000),
        )
    except tts_module.ValidationError as e:
        return jsonify({'error': e.message, 'field': e.field}), 400
    except tts_module.MisconfiguredError as e:
        logger.error('TTS misconfigured', extra={
            'event_type': 'tts_misconfigured',
            'metadata': {'missing': e.missing},
        })
        return jsonify({'error': e.message, 'missing': e.missing}), 503
    except tts_module.TTSError as e:
        return jsonify({'error': e.message, 'status_code': e.status_code}), \
            (e.status_code if 400 <= e.status_code < 600 else 502)
    except Exception as e:
        logger.exception('TTS synthesize unexpected error')
        return jsonify({'error': f'unexpected: {e}'}), 500

    fmt = (payload.get('audio_format') or 'mp3').lower()
    mime = {'mp3': 'audio/mpeg', 'pcm': 'audio/pcm', 'wav': 'audio/wav',
            'ogg': 'audio/ogg', 'opus': 'audio/ogg'}.get(fmt, 'application/octet-stream')
    return Response(audio, mimetype=mime, headers={
        'Content-Length': str(len(audio)),
        'Cache-Control': 'no-store',
        'X-TTS-Format': fmt,
    })


@app.route('/api/tts/voices', methods=['GET'])
def api_tts_voices():
    """
    GET → { data: [{id, name, gender, sample_rate}, ...], degraded, source }
    """
    result = tts_module.safe_list_voices()
    return jsonify(result)



# ============================================================================
# 声音复刻 2.0 REST API (server/voice_cloning.py 封装) — 2026-06-27
# ============================================================================
# 凭证缺失时不挂载真实路由 — 但为 /api/voice/* 提供 503 降级,
# 避免前端请求甩给 404 误导用户.
_VOICE_CLONING_MOUNTED = False
try:
    from voice_cloning import (
        register_voice_cloning_routes as _register_voice_cloning,
        make_voice_cloning_client_from_env as _make_voice_client,
        VoiceCloningConfigError as _VoiceCloningConfigError,
    )
    try:
        _register_voice_cloning(app, client_factory=_make_voice_client)
        _VOICE_CLONING_MOUNTED = True
        if logger is not None:
            logger.info("声音复刻 2.0 路由已挂载", extra={'event_type': 'voice_cloning_mounted'})
    except _VoiceCloningConfigError as e:
        if logger is not None:
            logger.warning(
                f"声音复刻 2.0 凭证缺失, /api/voice/* 未挂载: {e}",
                extra={'event_type': 'voice_cloning_disabled'},
            )
except ImportError as e:
    if logger:
        logger.warning(f"voice_cloning 模块未加载: {e}")

if not _VOICE_CLONING_MOUNTED:
    # 降级路由: 返回 503 而非 404, 告知前端 "服务未配置"
    @app.route("/api/voice/list", methods=["GET"])
    @app.route("/api/voice/upload", methods=["POST"])
    @app.route("/api/voice/train/status", methods=["GET"])
    @app.route("/api/voice/delete", methods=["DELETE"])
    @app.route("/api/voice/synthesize", methods=["POST"])
    def _voice_cloning_disabled():
        return jsonify({
            "error": "voice_cloning_not_configured",
            "message": "声音复刻凭证未配置 (VOLC_VOICE_CLONE_API_KEY 或 VOLC_VOICE_CLONE_APP_ID+TOKEN)",
        }), 503
