/**
 * MetricGrid — Sprint 9
 * 监控指标 2xN 网格, 紧凑卡片 + 顶部渐变条
 *
 * Author: Claude Opus 4.8
 */
import React, { useMemo } from 'react';
import type { SessionMetrics } from '../types';

export interface MetricGridProps {
  metrics: SessionMetrics;
  status?: string;
  wsState?: string;
}

interface MetricItem {
  label: string;
  value: string;
  variant?: 'success' | 'warning' | 'danger';
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const MetricGrid: React.FC<MetricGridProps> = React.memo((p) => {
  const items: MetricItem[] = useMemo(() => {
    const m = p.metrics;
    const elapsed = m.startTime ? (Date.now() - m.startTime) / 1000 : 0;
    return [
      {
        label: '平均延迟',
        value: m.avgLatency > 0 ? `${m.avgLatency.toFixed(0)} ms` : '—',
        variant: m.avgLatency > 800 ? 'warning' : 'success',
      },
      {
        label: '实时率',
        value: elapsed > 0 ? `${(m.transcriptionChars / elapsed / 5).toFixed(1)}×` : '—',
      },
      {
        label: '转写字数',
        value: String(m.transcriptionChars ?? 0),
      },
      {
        label: '会话时长',
        value: fmtDuration(elapsed),
      },
      {
        label: '接收字节',
        value: fmtBytes(m.audioBytes ?? 0),
      },
      {
        label: '处理块数',
        value: String(m.chunksProcessed ?? 0),
      },
    ];
  }, [p.metrics]);

  return (
    <div className="metric-grid" role="list">
      {items.map((it) => (
        <div
          key={it.label}
          className="metric-tile"
          data-variant={it.variant}
          role="listitem"
        >
          <div className="metric-label">{it.label}</div>
          <div className="metric-value">{it.value}</div>
        </div>
      ))}
    </div>
  );
});

MetricGrid.displayName = 'MetricGrid';