"""
Prometheus 指标 + safe_value 工具测试
TDD: 测试可观测性模块的关键契约
"""
import pytest
from prometheus_client import Counter, Gauge
from metrics import MetricsCollector, safe_value, safe_observe_sum


class TestSafeValue:
    """safe_value 兼容 unlabeled / labeled 指标"""

    def test_unlabeled_counter(self):
        c = Counter('ut', 'unlabeled test')
        c.inc(5)
        assert safe_value(c) == 5.0

    def test_labeled_counter_aggregates(self):
        c = Counter('lt', 'labeled test', ['lang'])
        c.labels(lang='zh').inc(3)
        c.labels(lang='en').inc(7)
        # 修复: 旧实现 ._value.get() 在 labeled 上会抛 AttributeError
        assert safe_value(c) == 10.0

    def test_unlabeled_gauge(self):
        g = Gauge('ug', 'g')
        g.set(42)
        assert safe_value(g) == 42.0

    def test_empty_counter(self):
        c = Counter('ec', 'empty')
        assert safe_value(c) == 0.0


class TestMetricsCollector:
    """MetricsCollector 接口契约"""

    def test_get_summary_keys(self):
        m = MetricsCollector()
        s = m.get_summary()
        for k in ('connections', 'transcription', 'audio', 'system', 'uptime_seconds'):
            assert k in s, f"missing key: {k}"

    def test_get_summary_works_after_labeled_increments(self):
        """修复: 旧版本会在 labeled counter 上抛 AttributeError"""
        m = MetricsCollector()
        m.connections_total.labels(client_type='web').inc()
        m.transcription_chars_total.labels(language='zh').inc(100)
        m.transcription_errors_total.labels(error_type='ValueError').inc()
        s = m.get_summary()
        assert s['connections']['total'] >= 1
        assert s['transcription']['chars_total'] >= 100
        assert s['transcription']['errors_total'] >= 1


class TestPromEndpoint:
    """Prometheus /metrics 端点契约"""

    def test_prom_metrics_endpoint(self, prom_url):
        import requests
        r = requests.get(f'{prom_url}/metrics', timeout=3)
        assert r.status_code == 200
        for name in ('ws_connections_active', 'transcription_latency_ms', 'audio_bytes_received_total'):
            assert name in r.text, f"missing metric: {name}"
