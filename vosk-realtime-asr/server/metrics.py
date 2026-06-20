"""
Prometheus 指标收集模块
定义和收集所有监控指标
"""

from prometheus_client import Counter, Gauge, Histogram
import psutil
import time
from typing import Iterable


def safe_value(metric) -> float:
    """
    安全读取 Counter / Gauge 值。
    - 对无 label 的指标: 返回 _value
    - 对带 label 的指标: 聚合所有 label 子项的样本值
    修复: prometheus_client 0.17+ 上 labeled Counter 没有 _value 属性
    """
    try:
        # 先尝试直接取值 (无 label 场景)
        if hasattr(metric, "_value") and hasattr(metric._value, "get"):
            return metric._value.get()
    except Exception:
        pass

    total = 0.0
    try:
        for sample in metric.collect()[0].samples:
            # 跳过 _created 时间戳样本, 只累加真正的数值样本
            if sample.name.endswith("_total") or sample.name.endswith("_count"):
                total += sample.value
            elif sample.name.endswith("_sum") is False and "created" not in sample.name:
                # Gauge 类直接累加
                if not sample.name.endswith("_created"):
                    total += sample.value
    except Exception:
        pass
    return total


def safe_observe_sum(histogram, attr: str = "_sum") -> float:
    """
    安全读取 Histogram 的 sum / count
    """
    try:
        for metric in histogram.collect():
            for sample in metric.samples:
                if sample.name.endswith(f"_{attr}"):
                    return sample.value
    except Exception:
        pass
    return 0.0

class MetricsCollector:
    """指标收集器"""

    # ========================================================================
    # 连接指标
    # ========================================================================
    connections_total = Counter(
        'ws_connections_total',
        'Total number of WebSocket connections',
        ['client_type']
    )

    connections_active = Gauge(
        'ws_connections_active',
        'Number of currently active WebSocket connections'
    )

    connection_duration = Histogram(
        'ws_connection_duration_seconds',
        'Duration of WebSocket connections in seconds',
        buckets=[10, 30, 60, 120, 300, 600, 1800, 3600]
    )

    connection_errors = Counter(
        'ws_connection_errors_total',
        'Total number of connection errors',
        ['error_type']
    )

    # ========================================================================
    # 转写指标
    # ========================================================================
    transcription_chars_total = Counter(
        'transcription_chars_total',
        'Total number of characters transcribed',
        ['language']
    )

    transcription_latency = Histogram(
        'transcription_latency_ms',
        'Transcription latency in milliseconds',
        buckets=[50, 100, 200, 300, 500, 1000, 2000]
    )

    transcription_errors_total = Counter(
        'transcription_errors_total',
        'Total number of transcription errors',
        ['error_type']
    )

    transcription_results_total = Counter(
        'transcription_results_total',
        'Total number of transcription results',
        ['is_final']
    )

    # ========================================================================
    # 音频指标
    # ========================================================================
    audio_bytes_received = Counter(
        'audio_bytes_received_total',
        'Total bytes of audio data received'
    )

    audio_chunks_processed = Counter(
        'audio_chunks_processed_total',
        'Total number of audio chunks processed'
    )

    audio_processing_time = Histogram(
        'audio_processing_time_ms',
        'Time spent processing audio chunks',
        buckets=[10, 20, 50, 100, 200, 500]
    )

    # ========================================================================
    # 系统指标
    # ========================================================================
    cpu_usage = Gauge(
        'system_cpu_usage_percent',
        'CPU usage percentage'
    )

    memory_usage = Gauge(
        'system_memory_usage_mb',
        'Memory usage in megabytes'
    )

    def __init__(self):
        """初始化"""
        self.start_time = time.time()

    def update_system_metrics(self):
        """更新系统指标"""
        # CPU 使用率
        cpu_percent = psutil.cpu_percent(interval=0.1)
        self.cpu_usage.set(cpu_percent)

        # 内存使用
        memory = psutil.virtual_memory()
        memory_mb = memory.used / (1024 * 1024)
        self.memory_usage.set(memory_mb)

    def get_summary(self) -> dict:
        """获取指标汇总 (修复: 兼容 labeled / unlabeled 指标)"""
        return {
            'connections': {
                'total': safe_value(self.connections_total),
                'active': int(safe_value(self.connections_active)),
            },
            'transcription': {
                'chars_total': safe_value(self.transcription_chars_total),
                'errors_total': safe_value(self.transcription_errors_total),
            },
            'audio': {
                'bytes_received': safe_value(self.audio_bytes_received),
                'chunks_processed': safe_value(self.audio_chunks_processed),
            },
            'system': {
                'cpu_percent': safe_value(self.cpu_usage),
                'memory_mb': safe_value(self.memory_usage),
            },
            'uptime_seconds': time.time() - self.start_time
        }


# ============================================================================
# 指标装饰器
# ============================================================================
def measure_latency(metric: Histogram):
    """延迟测量装饰器"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            start = time.time()
            result = func(*args, **kwargs)
            duration = (time.time() - start) * 1000  # ms
            metric.observe(duration)
            return result
        return wrapper
    return decorator


def count_calls(metric: Counter, labels: dict = None):
    """调用计数装饰器"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)
            if labels:
                metric.labels(**labels).inc()
            else:
                metric.inc()
            return result
        return wrapper
    return decorator


# ============================================================================
# 使用示例
# ============================================================================
if __name__ == '__main__':
    metrics = MetricsCollector()

    # 模拟数据
    metrics.connections_total.inc()
    metrics.connections_active.inc()
    metrics.transcription_chars_total.inc(50)
    metrics.transcription_latency.observe(150)
    metrics.audio_bytes_received.inc(4000)

    print(metrics.get_summary())