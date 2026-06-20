"""
结构化日志模块
支持 JSON 格式日志输出，便于日志分析和检索
"""

import json
import logging
import sys
from datetime import datetime
from typing import Any, Dict, Optional
import uuid

class StructuredLogger:
    """结构化日志类"""

    def __init__(self, name: str, level: str = 'INFO'):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, level.upper()))

        # 使用自定义 Handler
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(StructuredFormatter())
        self.logger.addHandler(handler)

        # 上下文信息
        self.trace_id = str(uuid.uuid4())

    def _log(self, level: str, message: str, extra: Optional[Dict] = None):
        """内部日志方法"""
        extra = extra or {}

        # 添加默认字段
        extra['trace_id'] = self.trace_id

        # 添加时间戳
        extra['timestamp'] = datetime.utcnow().isoformat() + 'Z'

        log_method = getattr(self.logger, level.lower())
        log_method(message, extra={'structured': extra})

    def info(self, message: str, extra: Optional[Dict] = None):
        self._log('INFO', message, extra)

    def warning(self, message: str, extra: Optional[Dict] = None):
        self._log('WARNING', message, extra)

    def error(self, message: str, extra: Optional[Dict] = None):
        self._log('ERROR', message, extra)

    def debug(self, message: str, extra: Optional[Dict] = None):
        self._log('DEBUG', message, extra)

    def trace(self, event_type: str, metadata: Optional[Dict] = None, session_id: str = None):
        """追踪事件"""
        extra = {
            'event_type': event_type,
            'metadata': metadata or {}
        }
        if session_id:
            extra['session_id'] = session_id
        self._log('INFO', f"Event: {event_type}", extra)


class StructuredFormatter(logging.Formatter):
    """结构化格式化器"""

    def format(self, record: logging.LogRecord) -> str:
        """格式化日志记录"""
        log_data = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
        }

        # 添加结构化数据
        if hasattr(record, 'structured'):
            log_data.update(record.structured)

        # 添加异常信息
        if record.exc_info:
            log_data['exception'] = self.formatException(record.exc_info)

        return json.dumps(log_data, ensure_ascii=False)


# ============================================================================
# 日志使用示例
# ============================================================================
if __name__ == '__main__':
    logger = StructuredLogger('test')

    logger.info("Server started")
    logger.info(
        "User connected",
        extra={
            'user_id': 'user001',
            'session_id': 'session001',
            'event_type': 'connection'
        }
    )

    logger.trace(
        event_type='transcription_result',
        metadata={
            'text_length': 50,
            'latency_ms': 150
        },
        session_id='session001'
    )