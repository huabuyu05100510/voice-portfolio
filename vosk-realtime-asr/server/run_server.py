"""
火山引擎实时语音转写 - 启动入口
模块级副作用全部放在 if __name__ == '__main__' 下, 避免 multiprocessing.spawn 重新执行
"""
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

# 加载 .env
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# DIAG 日志落地文件 — 方便离线分析多说话人 utterance/speaker 协议帧
# 默认写入 /tmp/asr_diag.log (旋转 5MB × 3 份)
_DIAG_LOG_PATH = os.environ.get('ASR_DIAG_LOG', '/tmp/asr_diag.log')
if not logging.getLogger('volc-server').handlers:
    _h = RotatingFileHandler(_DIAG_LOG_PATH, maxBytes=5_000_000, backupCount=3, encoding='utf-8')
    _h.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    _root = logging.getLogger('volc-server')
    _root.setLevel(logging.INFO)
    _root.addHandler(_h)
    # 同时打到 stdout 一份, 方便 live 观察
    _sh = logging.StreamHandler(sys.stdout)
    _sh.setFormatter(logging.Formatter('[DIAG] %(message)s'))
    _root.addHandler(_sh)

from app import app, socketio, boot_app, shutdown_app
from config import Config


if __name__ == '__main__':
    boot_app()
    try:
        socketio.run(
            app,
            host=Config.HOST,
            port=Config.PORT,
            debug=Config.DEBUG,
            use_reloader=False,
            allow_unsafe_werkzeug=True,
        )
    finally:
        shutdown_app()
