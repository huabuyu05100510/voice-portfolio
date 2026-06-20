/**
 * 可观测性面板组件
 * 显示实时监控指标和状态信息
 */

import React, { useEffect, useState } from 'react';
import { SessionMetrics } from './types';
import { WebSocketState } from './WebSocketClient';

interface ObservabilityPanelProps {
  status: string;
  metrics: SessionMetrics;
  wsState: WebSocketState;
  sessionId: string | null;
}

export const ObservabilityPanel: React.FC<ObservabilityPanelProps> = ({
  status,
  metrics,
  wsState,
  sessionId,
}) => {
  const [elapsedTime, setElapsedTime] = useState(0);

  // 计算运行时间
  useEffect(() => {
    if (metrics.startTime > 0) {
      const timer = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - metrics.startTime) / 1000));
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [metrics.startTime]);

  return (
    <div className="observability-panel">
      {/* 连接状态 */}
      <section className="metric-section">
        <h4>🔗 连接状态</h4>
        <div className="metric-grid">
          <MetricItem
            label="WebSocket"
            value={wsState === 'connected' ? '已连接' : wsState}
            status={wsState === 'connected' ? 'success' : 'warning'}
          />
          <MetricItem
            label="会话ID"
            value={sessionId ? sessionId.slice(0, 12) : '-'}
          />
          <MetricItem
            label="状态"
            value={status}
            status={getMetricStatus(status)}
          />
          <MetricItem
            label="运行时间"
            value={`${elapsedTime}s`}
          />
        </div>
      </section>

      {/* 音频指标 */}
      <section className="metric-section">
        <h4>🔊 音频指标</h4>
        <div className="metric-grid">
          <MetricItem
            label="接收字节"
            value={formatBytes(metrics.audioBytes)}
            highlight={metrics.audioBytes > 0}
          />
          <MetricItem
            label="处理块数"
            value={metrics.chunksProcessed.toString()}
            highlight={metrics.chunksProcessed > 0}
          />
          <MetricItem
            label="采样率"
            value="16kHz"
          />
          <MetricItem
            label="声道"
            value="单声道"
          />
        </div>
      </section>

      {/* 转写指标 */}
      <section className="metric-section">
        <h4>📝 转写指标</h4>
        <div className="metric-grid">
          <MetricItem
            label="转写字数"
            value={metrics.transcriptionChars.toString()}
            highlight={metrics.transcriptionChars > 0}
          />
          <MetricItem
            label="平均延迟"
            value={`${metrics.avgLatency.toFixed(1)}ms`}
            status={getLatencyStatus(metrics.avgLatency)}
          />
          <MetricItem
            label="延迟次数"
            value={(metrics.totalLatencies ?? 0).toString()}
          />
          <MetricItem
            label="实时率"
            value={calculateRealtimeRate(metrics, elapsedTime)}
          />
        </div>
      </section>

      {/* 性能图表 */}
      <section className="metric-section">
        <h4>📊 性能图表</h4>

        {/* 延迟趋势 */}
        <div className="mini-chart">
          <div className="chart-label">延迟趋势</div>
          <div className="chart-bar latency-bar">
            <div
              className="bar-fill"
              style={{ width: `${Math.min(100, metrics.avgLatency / 5)}%` }}
            />
            <span className="bar-value">{metrics.avgLatency.toFixed(0)}ms</span>
          </div>
        </div>

        {/* 字数趋势 */}
        <div className="mini-chart">
          <div className="chart-label">字数累计</div>
          <div className="chart-bar chars-bar">
            <div
              className="bar-fill"
              style={{ width: `${Math.min(100, metrics.transcriptionChars / 10)}%` }}
            />
            <span className="bar-value">{metrics.transcriptionChars}</span>
          </div>
        </div>

        {/* 音频流量 */}
        <div className="mini-chart">
          <div className="chart-label">音频流量</div>
          <div className="chart-bar audio-bar">
            <div
              className="bar-fill"
              style={{ width: `${Math.min(100, metrics.audioBytes / 100000)}%` }}
            />
            <span className="bar-value">{formatBytes(metrics.audioBytes)}</span>
          </div>
        </div>
      </section>

      {/* 监控链接 */}
      <section className="metric-section links">
        <h4>📡 监控服务</h4>
        <div className="monitoring-links">
          <a href="http://localhost:9091" target="_blank" className="monitor-link">
            Prometheus (9091)
          </a>
          <a href="http://localhost:3000" target="_blank" className="monitor-link">
            Grafana (3000)
          </a>
        </div>
      </section>
    </div>
  );
};

// ============================================================================
// 指标项组件
// ============================================================================
interface MetricItemProps {
  label: string;
  value: string;
  status?: 'success' | 'warning' | 'error' | 'normal';
  highlight?: boolean;
}

const MetricItem: React.FC<MetricItemProps> = ({
  label,
  value,
  status = 'normal',
  highlight = false,
}) => {
  return (
    <div className={`metric-item ${status} ${highlight ? 'highlight' : ''}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
};

// ============================================================================
// 辅助函数
// ============================================================================
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getMetricStatus(status: string): 'success' | 'warning' | 'error' | 'normal' {
  if (status === 'recording' || status === 'transcribing') return 'success';
  if (status === 'ready' || status === 'completed') return 'normal';
  if (status === 'error') return 'error';
  return 'warning';
}

function getLatencyStatus(latency: number): 'success' | 'warning' | 'error' | 'normal' {
  if (latency < 100) return 'success';
  if (latency < 200) return 'normal';
  if (latency < 500) return 'warning';
  return 'error';
}

function calculateRealtimeRate(metrics: SessionMetrics, elapsed: number): string {
  if (elapsed === 0 || metrics.audioBytes === 0) return '0 chars/s';
  const rate = metrics.transcriptionChars / elapsed;
  return `${rate.toFixed(1)} chars/s`;
}

export default ObservabilityPanel;