"""
Vosk 实时语音转写 - Flask + SocketIO 应用对象
仅定义 app / socketio / handlers, 不做任何模块级副作用.
启动逻辑见 run_server.py
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

# 模型与启动依赖 (由 run_server.py 注入, 这里只取)
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'vosk-model-cn-0.22')

# 运行期对象 (由 boot_app() 填充)
logger: StructuredLogger = None  # type: ignore
metrics: MetricsCollector = None  # type: ignore
worker_proc = None
worker_request_q = None
worker_response_q = None
sessions: dict = {}
WORKER_LOCK = threading.Lock()
listener_thread: threading.Thread = None  # type: ignore


def boot_app():
    """
    应用启动函数 (替代模块级副作用, 避免 multiprocessing.spawn 重新执行时冲突)
    由 run_server.py 在 if __name__ == '__main__' 下调用
    """
    global logger, metrics, worker_proc, worker_request_q, worker_response_q, listener_thread

    # 延迟导入, 避免在 spawn re-import 时加载
    from prometheus_client import start_http_server
    from vosk_worker import start_worker

    logger = StructuredLogger('vosk-server')
    metrics = MetricsCollector()

    # Prometheus
    start_http_server(9092)
    logger.info("Prometheus metrics server started on port 9092")

    # Vosk worker
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Vosk model not found at {MODEL_PATH}")
    worker_proc, worker_request_q, worker_response_q = start_worker(MODEL_PATH, 16000)
    logger.info(f"Vosk worker started, pid={worker_proc.pid}")

    listener_thread = threading.Thread(target=_worker_listener, daemon=True, name="worker-listener")
    listener_thread.start()


def shutdown_app():
    """关闭 worker (供测试 / 优雅退出使用)"""
    global worker_proc
    if worker_proc and worker_proc.is_alive():
        try:
            worker_request_q.put_nowait({"cmd": "shutdown"})
        except Exception:
            pass
        worker_proc.terminate()
        worker_proc.join(timeout=2)


# ============================================================================
# Worker 监听: 把 worker 事件路由回对应 sid 的 socket
# ============================================================================
def _worker_listener():
    while True:
        try:
            evt = worker_response_q.get(timeout=1.0)
        except Exception:
            if worker_proc and not worker_proc.is_alive():
                logger.error("Vosk worker died, attempting restart...")
                _restart_worker()
            continue

        if not isinstance(evt, dict):
            continue

        event_type = evt.get("event")
        sid = evt.get("sid")

        if event_type == "ready":
            logger.info("Vosk worker ready")
            continue

        if event_type == "fatal":
            logger.error(f"Vosk worker fatal: {evt.get('message')}")
            continue

        if event_type == "error":
            err_msg = evt.get("message", "unknown")
            logger.error(
                f"Worker error for {sid}: {err_msg}",
                extra={
                    'session_id': sid, 'event_type': 'worker_error',
                    'metadata': {'error': err_msg}
                }
            )
            metrics.transcription_errors_total.labels(error_type='worker').inc()
            if sid and sid in sessions:
                with WORKER_LOCK:
                    socketio.emit('error', {'message': err_msg}, to=sid)
            continue

        if event_type == "transcription_result":
            text = evt.get("text", "")
            is_final = evt.get("is_final", False)
            latency = evt.get("latency_ms", 0)
            words = evt.get("words") or []

            if not sid or sid not in sessions:
                continue

            session = sessions[sid]

            if is_final:
                session['text_buffer'] += text + ' '
                session['metrics']['transcription_chars'] += len(text)
                metrics.transcription_chars_total.labels(language='zh').inc(len(text))
                metrics.transcription_results_total.labels(is_final='true').inc()
                # 累计 final 词级时间戳 (用于客户端的卡拉OK字幕)
                # 注意: 每次 final 重新开始计字, 因为 KaldiRecognizer 在 reset 后会从 0s 开始
                # 但同一段 session 内的多个 final 片段, start/end 是相对当前识别的局部时间
                # 客户端要把每段 final 的 words 拼起来, 时间偏移按段索引线性外推
                if words:
                    # 累加 buffer, 用 chunk_index 标识段号
                    chunk_index = session['metrics'].get('final_chunk_index', 0)
                    session['metrics']['final_chunk_index'] = chunk_index + 1
                    # 用当前 final 的最早 start 作为段偏移
                    chunk_offset = min((w.get('start', 0.0) for w in words), default=0.0)
                    # 把段内 words 的 start/end 转成全局 (相对 session 起点)
                    accumulated = session.setdefault('words_buffer', [])
                    # 计算本段相对上一段的偏移
                    last_end = accumulated[-1]['end'] if accumulated else 0.0
                    # 本段第一词相对段内起始 = 0, 加到 last_end
                    for w in words:
                        accumulated.append({
                            'word': w.get('word', ''),
                            'start': last_end + (w.get('start', 0.0) - chunk_offset),
                            'end': last_end + (w.get('end', 0.0) - chunk_offset),
                            'conf': w.get('conf', 0.0),
                        })
            else:
                metrics.transcription_results_total.labels(is_final='false').inc()

            if latency > 0:
                session['metrics']['latencies'].append(latency)
                metrics.transcription_latency.observe(latency)

            with WORKER_LOCK:
                emit_payload = {
                    'text': text,
                    'is_final': is_final,
                    'full_text': session['text_buffer'],
                    'latency_ms': round(latency, 2),
                    'timestamp': datetime.utcnow().isoformat(),
                }
                # final 时下发累积的 words_buffer (给客户端做卡拉OK)
                if is_final:
                    emit_payload['words'] = list(session.get('words_buffer', []))
                else:
                    # partial 不下发 (Vosk partial 没 words), 客户端继续用旧的
                    emit_payload['words'] = list(session.get('words_buffer', []))
                socketio.emit('transcription_result', emit_payload, to=sid)


def _restart_worker():
    global worker_proc, worker_request_q, worker_response_q
    from vosk_worker import start_worker
    try:
        if worker_proc.is_alive():
            worker_proc.terminate()
            worker_proc.join(timeout=2)
    except Exception:
        pass
    worker_proc, worker_request_q, worker_response_q = start_worker(MODEL_PATH, 16000)
    logger.info(f"Vosk worker restarted, new pid={worker_proc.pid}")


# ============================================================================
# 会话管理
# ============================================================================
def create_session(session_id: str, client_type: str = 'web') -> dict:
    session = {
        'id': session_id,
        'start_time': time.time(),
        'status': 'ready',
        'text_buffer': '',
        'metrics': {
            'audio_bytes': 0,
            'transcription_chars': 0,
            'latencies': [],
            'chunks_processed': 0,
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
        duration = time.time() - session['start_time']
        try:
            metrics.connections_active.dec()
        except ValueError:
            pass
        metrics.connection_duration.observe(duration)
        try:
            worker_request_q.put_nowait({"cmd": "finalize", "sid": session_id})
        except Exception:
            pass
        logger.info("Session ended", extra={
            'session_id': session_id, 'event_type': 'session_end',
            'metadata': {
                'duration_seconds': round(duration, 2),
                'total_chars': session['metrics']['transcription_chars'],
                'total_audio_bytes': session['metrics']['audio_bytes'],
            }
        })
    return session


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
    session['status'] = 'recording'
    emit('recording_started', {
        'session_id': session_id,
        'timestamp': datetime.utcnow().isoformat(),
    })
    logger.info("Recording started", extra={
        'session_id': session_id, 'event_type': 'recording_start',
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

    if audio_bytes > 0:
        try:
            worker_request_q.put_nowait({
                "cmd": "process", "sid": session_id, "audio": data,
            })
        except Exception as e:
            logger.error(f"Failed to enqueue audio: {e}", extra={
                'session_id': session_id, 'event_type': 'queue_full',
            })
            metrics.transcription_errors_total.labels(error_type='queue_full').inc()

    emit('session_status', {
        'status': session['status'],
        'metrics': {
            'audio_bytes': session['metrics']['audio_bytes'],
            'transcription_chars': session['metrics']['transcription_chars'],
            'chunks_processed': session['metrics']['chunks_processed'],
            'avg_latency': round(
                sum(session['metrics']['latencies']) / len(session['metrics']['latencies'])
                if session['metrics']['latencies'] else 0, 2
            ),
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
    try:
        worker_request_q.put_nowait({"cmd": "finalize", "sid": session_id})
    except Exception:
        pass
    session['status'] = 'completed'
    avg_latency = round(
        sum(session['metrics']['latencies']) / len(session['metrics']['latencies'])
        if session['metrics']['latencies'] else 0, 2
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
        },
        'timestamp': datetime.utcnow().isoformat(),
    })
    logger.info("Recording stopped", extra={
        'session_id': session_id, 'event_type': 'recording_stop',
        'metadata': {
            'total_chars': session['metrics']['transcription_chars'],
            'avg_latency_ms': avg_latency,
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
    emit('metrics_update', {
        'session_metrics': session['metrics'],
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
    return {
        'status': 'healthy',
        'vosk_model_loaded': os.path.exists(MODEL_PATH),
        'worker_alive': bool(worker_proc and worker_proc.is_alive()),
        'active_sessions': len(sessions),
        'timestamp': datetime.utcnow().isoformat(),
    }


@app.route('/metrics/summary')
def metrics_summary():
    return {
        'connections': {
            'total': safe_value(metrics.connections_total) if metrics else 0,
            'active': len(sessions),
        },
        'transcription': {
            'total_chars': safe_value(metrics.transcription_chars_total) if metrics else 0,
            'errors': safe_value(metrics.transcription_errors_total) if metrics else 0,
        },
        'audio': {
            'bytes_received': safe_value(metrics.audio_bytes_received) if metrics else 0,
            'chunks_processed': safe_value(metrics.audio_chunks_processed) if metrics else 0,
        },
        'worker': {
            'alive': bool(worker_proc and worker_proc.is_alive()),
            'pid': worker_proc.pid if worker_proc else None,
        },
        'timestamp': datetime.utcnow().isoformat(),
    }
