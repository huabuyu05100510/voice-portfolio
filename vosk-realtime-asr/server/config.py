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

    # Vosk 配置 (历史保留, 当前主流程已切到火山引擎)
    VOSK_SAMPLE_RATE = 16000
    VOSK_MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'vosk-model-cn-0.22')

    # 火山引擎 (字节跳动) 流式一句话识别 — v3/sauc 协议 (实测验证)
    # 端点是 v3/sauc/bigmodel_async (实测可用, 不是 v1/sauc)
    # 用户开通的是"豆包流式语音识别模型 2.0 (小时版)", resource_id = volc.seedasr.sauc.duration
    VOLC_ENDPOINT = os.environ.get(
        'VOLC_ENDPOINT',
        'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
    )
    # 新控制台 API Key (X-Api-Key, 单一鉴权 header)
    VOLC_API_KEY = os.environ.get('VOLC_API_KEY', '')
    # 旧版控制台 (双鉴权 header)
    VOLC_APP_KEY = os.environ.get('VOLC_APP_KEY', '')
    VOLC_ACCESS_TOKEN = os.environ.get('VOLC_ACCESS_TOKEN', '')
    # 资源 ID (控制台开通服务时获得):
    #   volc.seedasr.sauc.duration    → 流式语音识别 2.0 小时版 ⭐ 新
    #   volc.seedasr.sauc.concurrent  → 流式语音识别 2.0 并发版
    #   volc.bigasr.sauc.duration    → 流式语音识别 1.0 小时版
    #   volc.bigasr.sauc.concurrent  → 流式语音识别 1.0 并发版
    VOLC_RESOURCE_ID = os.environ.get('VOLC_RESOURCE_ID', 'volc.seedasr.sauc.duration')
    VOLC_MODEL_NAME = os.environ.get('VOLC_MODEL_NAME', 'bigmodel')
    # 豆包同声传译 (s2t) 需要额外参数 (mode/source_language/target_language),
    # 如需启用, 在 .env 设置 VOLC_EXTRA_REQUEST='{"mode":"s2t","source_language":"zh"}'
    VOLC_EXTRA_REQUEST = os.environ.get('VOLC_EXTRA_REQUEST', '')

    # 音频配置
    AUDIO_CHUNK_SIZE = 4000  # 250ms @ 16kHz * 2 bytes
    AUDIO_BUFFER_SIZE = 1024

    # 可观测性配置
    PROMETHEUS_PORT = 9091
    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')
    LOG_FORMAT = 'json'  # json or text

    # CORS 配置
    CORS_ORIGINS = '*'
