"""
pytest 全局配置
添加 server/ 到 sys.path, 暴露 SERVER_URL 等常量
"""
import os
import sys
import pytest

# 把 server/ 和 tests/ 加入 sys.path
SERVER_DIR = os.path.join(os.path.dirname(__file__), '..', 'server')
TESTS_DIR = os.path.dirname(__file__)
for p in (SERVER_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

SERVER_URL = 'http://localhost:5000'
# 火山引擎版: PROMETHEUS_PORT = 9091 (从 server/config.py 读 env)
PROM_URL = 'http://localhost:9091'


@pytest.fixture(scope='session')
def server_url():
    return SERVER_URL


@pytest.fixture(scope='session')
def prom_url():
    return PROM_URL
