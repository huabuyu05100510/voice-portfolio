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
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit

from config import Config
from logger import StructuredLogger
from metrics import MetricsCollector, safe_value

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
volc_config: dict = None  # type: ignore

# sid → 会话对象 (启动后才填充)
sessions: dict = {}
sessions_lock = threading.Lock()


def boot_app():
    """
    应用启动函数 (替代模块级副作用, 避免 multiprocessing.spawn 重新执行时冲突)
    由 run_server.py 在 if __name__ == '__main__' 下调用
    """
    global logger, metrics, volc_config

    # 延迟导入, 避免在 spawn re-import 时加载
    from prometheus_client import start_http_server
    from volcengine_session import VolcengineSession

    logger = StructuredLogger('volc-server')
    metrics = MetricsCollector()

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

    # Prometheus
    start_http_server(Config.PROMETHEUS_PORT)
    logger.info(f"Prometheus metrics server started on port {Config.PROMETHEUS_PORT}")
    logger.info(
        f"火山引擎配置: endpoint={Config.VOLC_ENDPOINT}, "
        f"resource_id={Config.VOLC_RESOURCE_ID}, model={Config.VOLC_MODEL_NAME}, "
        f"app_key={'set' if Config.VOLC_APP_KEY else 'MISSING'}",
        extra={'event_type': 'volcengine_config', 'metadata': volc_config_safe()},
    )


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
    # partial 没有 speaker_id, 用 session 当前的
    payload = {
        'text': text,
        'is_final': False,
        'full_text': session['text_buffer'],
        'latency_ms': 0,
        'speaker_id': session.get('current_speaker_id'),
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

    # Sprint 10: 智能拼接 text_buffer
    # 火山引擎在不同模式下, result.text 可能是:
    #   - 一句一返 (single mode): 只有最新一句
    #   - 累积模式: 整个会话的所有内容 (增量)
    # 不管哪种, 我们都要保持 buffer 单调递增且去重
    from text_buffer import smart_append, get_last_speaker, extract_text_from_utterances
    session['text_buffer'], _ = smart_append(session['text_buffer'], text)
    # 如果有 utterances, 用 utterances 拼接更可靠 (多说话人场景)
    if utterances:
        utt_text = extract_text_from_utterances(utterances)
        if utt_text:
            session['text_buffer'], _ = smart_append(session['text_buffer'], utt_text)

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

    if latency_ms and latency_ms > 0:
        session['metrics']['latencies'].append(latency_ms)
        metrics.transcription_latency.observe(latency_ms)

    payload = {
        'text': text,
        'is_final': True,
        'full_text': session['text_buffer'],
        'latency_ms': round(latency_ms or 0, 2),
        'speaker_id': current_speaker,
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
            'speaker_id': current_speaker,
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
    if isinstance(auth, dict):
        client_type = auth.get('client_type', 'web')
    create_session(session_id, client_type=client_type)
    emit('connected', {
        'session_id': session_id,
        'status': 'ready',
        'timestamp': datetime.utcnow().isoformat(),
        'volcengine_ready': bool(Config.VOLC_APP_KEY and Config.VOLC_ACCESS_TOKEN),
    })
    logger.info("Client connected", extra={
        'session_id': session_id, 'event_type': 'connection',
        'metadata': {'client_type': client_type}
    })


@socketio.on('disconnect')
def handle_disconnect():
    if not metrics:
        return
    session_id = request.sid
    end_session(session_id)
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

    session['status'] = 'completed'
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
        'timestamp': datetime.utcnow().isoformat(),
    }
