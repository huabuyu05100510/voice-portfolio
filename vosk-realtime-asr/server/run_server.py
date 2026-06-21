"""
火山引擎实时语音转写 - 启动入口
模块级副作用全部放在 if __name__ == '__main__' 下, 避免 multiprocessing.spawn 重新执行
"""
import os
import sys

# 加载 .env
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

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
