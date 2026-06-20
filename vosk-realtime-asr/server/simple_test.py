#!/usr/bin/env python3
"""最简单的 Socket.IO 测试服务"""

from flask import Flask
from flask_socketio import SocketIO

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

@socketio.on('connect')
def handle_connect():
    print('客户端连接成功!')
    socketio.emit('connected', {'session_id': 'test-session'})

@socketio.on('disconnect')
def handle_disconnect():
    print('客户端断开')

@socketio.on('message')
def handle_message(data):
    print(f'收到消息: {data}')
    socketio.emit('response', {'data': f'收到: {data}'})

@app.route('/')
def index():
    return 'Socket.IO 服务运行中'

if __name__ == '__main__':
    print('启动服务在 http://localhost:5000')
    socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)