"""
WebSocket 端到端测试
覆盖连接 / 录音控制 / 音频流 / 指标查询 / Worker 子进程
"""
import time
import pytest
import socketio
import requests


def _wait(predicate, timeout=3.0, interval=0.05, message='timeout'):
    """轮询等待 predicate 为真, 超时抛出 AssertionError"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    raise AssertionError(message)


def _connect(server_url):
    sio = socketio.Client(reconnection=False)
    sio.connect(server_url, transports=['polling', 'websocket'])
    return sio


class TestHealthAndMetrics:
    """REST 健康检查与指标"""

    def test_health(self, server_url):
        r = requests.get(f'{server_url}/health', timeout=3)
        assert r.status_code == 200
        data = r.json()
        assert data['status'] == 'healthy'
        assert data['vosk_model_loaded'] is True
        assert data['worker_alive'] is True
        assert 'active_sessions' in data

    def test_metrics_summary(self, server_url):
        r = requests.get(f'{server_url}/metrics/summary', timeout=3)
        assert r.status_code == 200
        data = r.json()
        assert 'connections' in data
        assert 'transcription' in data
        assert 'audio' in data
        assert 'worker' in data
        assert data['worker']['alive'] is True


class TestSocketConnection:
    """WebSocket 基础连接"""

    def test_connect_emits_connected_event(self, server_url):
        sio = socketio.Client(reconnection=False)
        received = {}
        sio.on('connected', lambda d: received.update(d))
        sio.connect(server_url, transports=['polling', 'websocket'])
        try:
            _wait(lambda: 'session_id' in received, message='no connected event')
            assert received['status'] == 'ready'
            assert isinstance(received['session_id'], str)
        finally:
            sio.disconnect()

    def test_disconnect_frees_session(self, server_url):
        r1 = requests.get(f'{server_url}/metrics/summary').json()
        sio = _connect(server_url)
        time.sleep(0.3)
        r2 = requests.get(f'{server_url}/metrics/summary').json()
        active_during = r2['connections']['active']
        sio.disconnect()
        time.sleep(0.5)
        r3 = requests.get(f'{server_url}/metrics/summary').json()
        assert active_during == r1['connections']['active'] + 1
        assert r3['connections']['active'] == r1['connections']['active']


class TestRecordingFlow:
    """录音 start / audio / stop 全流程"""

    def test_start_recording_emits_event(self, server_url):
        sio = _connect(server_url)
        try:
            got = {'v': False}
            sio.on('recording_started', lambda d: got.update(v=True))
            sio.emit('start_recording')
            _wait(lambda: got['v'], message='no recording_started')
        finally:
            sio.disconnect()

    def test_audio_emits_session_status(self, server_url):
        sio = _connect(server_url)
        try:
            statuses = []
            sio.on('session_status', lambda d: statuses.append(d))
            sio.emit('start_recording')
            time.sleep(0.2)
            for _ in range(3):
                sio.emit('audio_data', b'\x00' * 8000)
                time.sleep(0.1)
            _wait(lambda: len(statuses) >= 3, message='no session_status')
            # 最后一帧应累加 audio_bytes
            last = statuses[-1]
            assert last['metrics']['chunks_processed'] >= 3
            assert last['metrics']['audio_bytes'] >= 24000
        finally:
            sio.disconnect()

    def test_stop_recording_emits_stats(self, server_url):
        sio = _connect(server_url)
        try:
            got = {}
            sio.on('recording_stopped', lambda d: got.update(d))
            sio.emit('start_recording')
            time.sleep(0.2)
            for _ in range(4):
                sio.emit('audio_data', b'\x00' * 8000)
                time.sleep(0.05)
            sio.emit('stop_recording')
            _wait(lambda: 'stats' in got, message='no recording_stopped')
            assert 'total_audio_bytes' in got['stats']
            assert 'duration_seconds' in got['stats']
        finally:
            sio.disconnect()


class TestGetMetrics:
    """get_metrics 事件"""

    def test_get_metrics_returns_summary(self, server_url):
        sio = _connect(server_url)
        try:
            got = {}
            sio.on('metrics_update', lambda d: got.update(d))
            sio.emit('get_metrics')
            _wait(lambda: 'session_metrics' in got, message='no metrics_update')
            assert 'server_metrics' in got
            assert 'total_connections' in got['server_metrics']
        finally:
            sio.disconnect()


class TestConcurrentConnections:
    """并发连接"""

    def test_five_clients(self, server_url):
        clients = []
        try:
            for _ in range(5):
                c = socketio.Client(reconnection=False)
                c.connect(server_url, transports=['polling', 'websocket'])
                clients.append(c)
            time.sleep(0.5)
            connected = sum(1 for c in clients if c.connected)
            assert connected == 5
            r = requests.get(f'{server_url}/metrics/summary').json()
            assert r['connections']['active'] >= 5
        finally:
            for c in clients:
                if c.connected:
                    c.disconnect()
