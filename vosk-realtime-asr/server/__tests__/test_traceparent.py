"""
Module B — 服务端 traceparent 提取 + logger 注入测试 (pytest)

覆盖:
- logger.traceparent_to_trace_id 正确解析 W3C traceparent
- StructuredLogger 接受外部 trace_id, 日志含正确 trace_id
- StructuredLogger 处理无效 traceparent 时降级 (不抛异常)
"""
import sys
import os

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)

from logger import StructuredLogger, traceparent_to_trace_id  # noqa: E402


# ----------------------------------------------------------------------------
# traceparent_to_trace_id 纯函数
# ----------------------------------------------------------------------------
def test_traceparent_to_trace_id_valid():
    """标准 W3C traceparent 格式: 00-{32 hex trace_id}-{16 hex span_id}-{flags}"""
    tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
    assert traceparent_to_trace_id(tp) == "0af7651916cd43dd8448eb211c80319c"


def test_traceparent_to_trace_id_with_extra_flags():
    """flags=01 表示 sampled, 我们只取 trace_id 不取 flags"""
    tp = "00-deadbeefdeadbeefdeadbeefdeadbeef-1234567890abcdef-00"
    assert traceparent_to_trace_id(tp) == "deadbeefdeadbeefdeadbeefdeadbeef"


def test_traceparent_to_trace_id_invalid_returns_none():
    """格式错误 → 返回 None (不抛异常)"""
    assert traceparent_to_trace_id("not-a-traceparent") is None
    assert traceparent_to_trace_id("") is None
    assert traceparent_to_trace_id("00-tooshort-tooshort-01") is None
    # trace_id 不是 32 hex
    assert traceparent_to_trace_id("00-XX-short-XXXXXXXXXXXXXXXX-01") is None


def test_traceparent_to_trace_id_wrong_version():
    """W3C spec: version != 00 视为无效 (但仍尝试解析)"""
    tp = "ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
    # 不抛异常, 返回值 (当前实现按位置取, 仍然返回 32 hex 字段)
    # 关键: 不抛异常, 函数鲁棒
    try:
        result = traceparent_to_trace_id(tp)
        # 不强制要求格式, 只确保不抛异常
        assert result is None or isinstance(result, str)
    except Exception as e:
        assert False, f"traceparent_to_trace_id should not raise, got: {e}"


# ----------------------------------------------------------------------------
# StructuredLogger 接受外部 trace_id
# ----------------------------------------------------------------------------
def test_logger_default_trace_id_is_uuid():
    """默认 (不传 trace_id) 时, 使用 uuid 兜底"""
    import logging
    logger = StructuredLogger('test')
    # trace_id 是 32-36 字符的 uuid 字符串
    assert logger.trace_id is not None
    assert isinstance(logger.trace_id, str)
    assert 8 <= len(logger.trace_id) <= 36


def test_logger_explicit_trace_id_overrides_uuid():
    """外部 trace_id 优先于 uuid 兜底"""
    logger = StructuredLogger('test', trace_id='my-custom-trace-1234')
    assert logger.trace_id == 'my-custom-trace-1234'


def test_logger_logs_contain_trace_id(caplog):
    """日志输出包含外部传入的 trace_id"""
    import logging
    logger = StructuredLogger('test', trace_id='abc-12345-trace')
    with caplog.at_level(logging.INFO):
        logger.info('hello world')
    # caplog 捕获到的 record 应包含 structured['trace_id']
    assert any(
        getattr(r, 'structured', {}).get('trace_id') == 'abc-12345-trace'
        for r in caplog.records
    ), f"Expected trace_id 'abc-12345-trace' in log records, got: {[getattr(r, 'structured', {}) for r in caplog.records]}"


def test_logger_with_traceparent_kwarg():
    """StructuredLogger 接受 traceparent 参数, 内部解析后存 trace_id"""
    tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
    logger = StructuredLogger('test', traceparent=tp)
    assert logger.trace_id == '0af7651916cd43dd8448eb211c80319c'


def test_logger_with_invalid_traceparent_falls_back_to_uuid():
    """无效 traceparent → 兜底 uuid (不抛异常)"""
    logger = StructuredLogger('test', traceparent='garbage')
    # 兜底, trace_id 应仍然存在 (uuid)
    assert logger.trace_id is not None
    assert isinstance(logger.trace_id, str)
