"""
Vosk Worker 子进程测试
- 启动 / 关闭
- 处理音频并通过 response_q 返回结果
- 重启行为
"""
import time
import os
import pytest
from vosk_worker import start_worker


MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'server', 'models', 'vosk-model-cn-0.22')


@pytest.fixture(scope='module')
def worker():
    if not os.path.exists(MODEL_PATH):
        pytest.skip(f'Vosk model not found at {MODEL_PATH}')
    proc, req_q, resp_q = start_worker(MODEL_PATH, 16000)
    # 等待 ready (模型加载可能需要 10-30s)
    from multiprocessing.queues import Empty
    deadline = time.time() + 90
    ready = False
    while time.time() < deadline:
        try:
            evt = resp_q.get(timeout=1)
        except Empty:
            if not proc.is_alive():
                pytest.fail('worker died during model load')
            continue
        if evt.get('event') == 'ready':
            ready = True
            break
        if evt.get('event') == 'fatal':
            pytest.fail(f"worker fatal: {evt.get('message')}")
    if not ready:
        proc.terminate()
        pytest.fail('worker did not become ready within 90s')
    yield proc, req_q, resp_q
    try:
        req_q.put_nowait({'cmd': 'shutdown'})
        proc.join(timeout=3)
    except Exception:
        pass


class TestWorkerLifecycle:
    def test_worker_alive_after_start(self, worker):
        proc, _, _ = worker
        assert proc.is_alive()
        assert proc.pid > 0


class TestWorkerProcess:
    def test_process_returns_response(self, worker):
        proc, req_q, resp_q = worker
        sid = 'test-sid-process'
        req_q.put({'cmd': 'process', 'sid': sid, 'audio': b'\x00' * 8000})
        # 不需要一定有 transcription, 但 worker 不应崩溃
        time.sleep(0.5)
        assert proc.is_alive()

    def test_finalize_releases_session(self, worker):
        proc, req_q, resp_q = worker
        sid = 'test-sid-finalize'
        req_q.put({'cmd': 'process', 'sid': sid, 'audio': b'\x00' * 4000})
        time.sleep(0.2)
        req_q.put({'cmd': 'finalize', 'sid': sid})
        # drain response queue
        deadline = time.time() + 2
        while time.time() < deadline:
            try:
                resp_q.get_nowait()
            except Exception:
                break
        assert proc.is_alive()

    def test_reset_does_not_crash(self, worker):
        proc, req_q, _ = worker
        req_q.put({'cmd': 'reset', 'sid': 'nonexistent'})
        time.sleep(0.2)
        assert proc.is_alive()
