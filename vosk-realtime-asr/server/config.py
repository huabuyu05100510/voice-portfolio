"""
配置文件
"""

import os

class Config:
    # 服务配置
    HOST = os.environ.get('HOST', '0.0.0.0')
    PORT = int(os.environ.get('PORT', 5000))
    DEBUG = os.environ.get('DEBUG', 'false').lower() == 'true'

    # WebSocket 配置
    WS_PING_TIMEOUT = 60
    WS_PING_INTERVAL = 25
    WS_MAX_MESSAGE_SIZE = 1024 * 1024  # 1MB

    # Vosk 配置
    VOSK_SAMPLE_RATE = 16000
    VOSK_MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'vosk-model-cn-0.22')

    # 音频配置
    AUDIO_CHUNK_SIZE = 4000  # 250ms @ 16kHz * 2 bytes
    AUDIO_BUFFER_SIZE = 1024

    # 可观测性配置
    PROMETHEUS_PORT = 9091
    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')
    LOG_FORMAT = 'json'  # json or text

    # CORS 配置
    CORS_ORIGINS = '*'