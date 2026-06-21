"""
E2E: Flask + SocketIO 火山引擎模式
- /health 返回 volcengine_configured / endpoint
- /metrics/summary 含 volcengine 字段
- start_recording → audio_data → transcription_result 包含 speaker_id / speakers / utterances

需要先 boot 后端: cd server && python3 run_server.py
注意: 此 E2E 不调用真实火山引擎 (需要 token), 仅验证应用层协议
"""
import os
import time
import pytest
import requests
import socketio


SERVER_URL = 'http://localhost:5000'


def _wait(predicate, timeout=3.0, interval=0.05, message='timeout'):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    raise AssertionError(message)


def _connect():
    sio = socketio.Client(reconnection=False)
    sio.connect(SERVER_URL, transports=['polling', 'websocket'])
    return sio


class TestHealthEndpointVolc:
    def test_health_engine_is_volcengine(self):
        r = requests.get(f'{SERVER_URL}/health', timeout=3)
        assert r.status_code == 200
        data = r.json()
        assert data['engine'] == 'volcengine_v3'
        assert 'volcengine_endpoint' in data
        assert 'volcengine_resource_id' in data
        assert 'volcengine_configured' in data
        assert 'volcengine_connections_active' in data

    def test_metrics_summary_has_volcengine_block(self):
        r = requests.get(f'{SERVER_URL}/metrics/summary', timeout=3)
        assert r.status_code == 200
        data = r.json()
        assert data['engine'] == 'volcengine_v3'
        assert 'volcengine' in data
        assert 'endpoint' in data['volcengine']
        assert 'resource_id' in data['volcengine']
        assert 'model' in data['volcengine']
        assert 'configured' in data['volcengine']


class TestConnectedEventVolcReady:
    def test_connected_event_has_volcengine_ready_flag(self):
        sio = socketio.Client(reconnection=False)
        received = {}
        sio.on('connected', lambda d: received.update(d))
        sio.connect(SERVER_URL, transports=['polling', 'websocket'])
        try:
            _wait(lambda: 'session_id' in received, message='no connected event')
            assert 'volcengine_ready' in received
            assert isinstance(received['volcengine_ready'], bool)
        finally:
            sio.disconnect()
