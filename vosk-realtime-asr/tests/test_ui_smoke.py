"""
UI 回归冒烟测试
1. Vite dev server 响应 200, 主入口 JS 可加载
2. AudioWorklet 静态文件可加载
3. 主页包含关键文本
4. Vite 生产构建无 TS 错误
"""
import os
import re
import subprocess
import time
import requests
import pytest


VITE_URL = 'http://localhost:3000'
VITE_DIR = os.path.join(os.path.dirname(__file__), '..', 'client')


def test_vite_dev_server_responsive():
    """Vite dev server 200"""
    r = requests.get(VITE_URL, timeout=5)
    assert r.status_code == 200
    assert '<div id="root">' in r.text
    assert 'Vosk' in r.text


def test_vite_main_entry_loads():
    """主入口 .tsx 可加载 (Vite dev mode 转译)"""
    r = requests.get(f'{VITE_URL}/src/index.tsx', timeout=5)
    assert r.status_code == 200
    assert 'createRoot' in r.text or 'App' in r.text


def test_vite_audioworklet_served():
    """AudioWorklet 文件由 Vite 提供"""
    r = requests.get(f'{VITE_URL}/audio-processor.js', timeout=5)
    # 200 或 304 都可
    assert r.status_code in (200, 304)
    if r.status_code == 200:
        assert 'AudioWorkletProcessor' in r.text or 'registerProcessor' in r.text


def test_vite_app_tsx_compiles():
    """App.tsx 编译返回有效 JS"""
    r = requests.get(f'{VITE_URL}/src/App.tsx', timeout=5)
    assert r.status_code == 200
    # Vite 把 tsx 编译成 js, 不应再出现 TS 语法
    assert 'TranscriptionRenderer' in r.text
    assert 'ObservabilityPanel' in r.text


@pytest.mark.skipif(not os.path.exists(os.path.join(VITE_DIR, 'node_modules')), reason='node_modules not installed')
def test_vite_production_build():
    """Vite 生产构建应无 TS 错误"""
    result = subprocess.run(
        ['npm', 'run', 'build'],
        cwd=VITE_DIR,
        capture_output=True,
        text=True,
        timeout=120,
    )
    # 出现 TS 错误时 build 退出码非 0
    if result.returncode != 0:
        print('STDOUT:', result.stdout[-2000:])
        print('STDERR:', result.stderr[-2000:])
    assert result.returncode == 0, 'vite build failed'
    # 检查产物
    dist = os.path.join(VITE_DIR, 'dist', 'index.html')
    assert os.path.exists(dist), 'dist/index.html not generated'
