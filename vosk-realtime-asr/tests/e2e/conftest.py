"""
E2E 测试配置 + 共享 fixture

约定:
  - 前端默认运行在 http://localhost:3001 (与 production 不同, 避免冲突)
  - 后端默认运行在 http://localhost:5000
  - 浏览器: chromium (Playwright 内部)
  - 视频录制: 默认开启, 存到 e2e/videos/
  - 截图: 失败时自动截到 e2e/artifacts/

启动方式 (tests 目录):
  # 1. 启动后端 (一个终端)
  cd ../server && python3 app.py

  # 2. 启动前端, 端口 3001 (另一个终端)
  cd ../client && npx vite --port 3001

  # 3. 跑 E2E
  cd ../tests
  python3 -m pytest e2e/ -v --browser chromium
"""
import os
import sys
import socket
import subprocess
import time
import signal
import pathlib
import pytest

E2E_DIR = pathlib.Path(__file__).parent.resolve()
TESTS_DIR = E2E_DIR.parent
PROJECT_ROOT = TESTS_DIR.parent
CLIENT_DIR = PROJECT_ROOT / 'client'
SERVER_DIR = PROJECT_ROOT / 'server'

# E2E 专用端口 (避免与 dev:3000 / build:5000 冲突)
CLIENT_URL = os.environ.get('E2E_CLIENT_URL', 'http://localhost:3001')
SERVER_URL = os.environ.get('E2E_SERVER_URL', 'http://localhost:5000')


def _port_open(host: str, port: int, timeout: float = 1.0) -> bool:
    """检测 TCP 端口是否已开放"""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _wait_port(host: str, port: int, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _port_open(host, port, timeout=0.5):
            return True
        time.sleep(0.3)
    return False


@pytest.fixture(scope='session')
def client_url() -> str:
    return CLIENT_URL


@pytest.fixture(scope='session')
def server_url() -> str:
    return SERVER_URL


@pytest.fixture(scope='session', autouse=True)
def ensure_services():
    """
    启动前端 (端口 3001) + 验证后端 (5000) 在跑
    - 后端由用户启动, 这里仅做健康检查
    - 前端: 如果 3001 未开, 自动 spawn vite
    """
    # 后端健康检查
    import urllib.request
    try:
        urllib.request.urlopen(SERVER_URL + '/health', timeout=2).read()
        backend_ok = True
    except Exception:
        backend_ok = False

    if not backend_ok:
        # 容许某些 E2E 在无后端时跑 (例如纯前端主题切换测试)
        # 不强制失败, 留给具体测试自己 skip
        print(f'\n[E2E] WARNING: backend not reachable at {SERVER_URL}', file=sys.stderr)

    # 前端: 自动启动 vite
    vite_proc = None
    if not _port_open('localhost', 3001, timeout=0.5):
        print('\n[E2E] starting vite on :3001', file=sys.stderr)
        vite_proc = subprocess.Popen(
            ['npx', 'vite', '--port', '3001', '--strictPort'],
            cwd=str(CLIENT_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            preexec_fn=os.setsid,
        )
        if not _wait_port('localhost', 3001, timeout=30):
            print('[E2E] FATAL: vite failed to start on :3001', file=sys.stderr)
            if vite_proc:
                os.killpg(os.getpgid(vite_proc.pid), signal.SIGTERM)
            pytest.exit('vite startup failed', returncode=1)

    yield  # === 测试运行 ===

    # 清理
    if vite_proc is not None:
        try:
            os.killpg(os.getpgid(vite_proc.pid), signal.SIGTERM)
            vite_proc.wait(timeout=5)
        except Exception:
            try:
                os.killpg(os.getpgid(vite_proc.pid), signal.SIGKILL)
            except Exception:
                pass


# 失败自动截图
@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    if rep.when == 'call' and rep.failed:
        # 拿到 page fixture (如果存在)
        page = item.funcargs.get('page')
        if page is not None:
            try:
                shot_path = E2E_DIR / 'artifacts' / f'{item.name}-FAIL.png'
                shot_path.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(shot_path), full_page=True)
                print(f'\n[E2E] saved failure screenshot: {shot_path}', file=sys.stderr)
            except Exception as exc:
                print(f'\n[E2E] could not screenshot: {exc}', file=sys.stderr)
