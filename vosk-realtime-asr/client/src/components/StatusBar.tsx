/**
 * StatusBar — Sprint 9 底部状态栏
 *
 * Author: Claude Opus 4.8
 */
import React from 'react';
import type { WebSocketState, SessionMetrics, AppStatus } from '../types';

export interface StatusBarProps {
  wsState: WebSocketState;
  status: AppStatus;
  sessionId: string | null;
  metrics: SessionMetrics;
}

const WS_LABELS: Record<WebSocketState, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  disconnecting: '断开中',
  error: '错误',
};

const STATUS_DOT_STATE: Record<AppStatus, 'connected' | 'connecting' | 'disconnected' | 'recording'> = {
  idle: 'disconnected',
  connecting: 'connecting',
  ready: 'connected',
  recording: 'recording',
  transcribing: 'recording',
  paused: 'connected',
  error: 'disconnected',
  completed: 'connected',
};

export const StatusBar: React.FC<StatusBarProps> = React.memo((p) => {
  return (
    <footer className="app-statusbar" role="contentinfo">
      <span className="statusbar-item">
        <span className="statusbar-dot" data-state={STATUS_DOT_STATE[p.status]} aria-hidden="true" />
        <span>WebSocket {WS_LABELS[p.wsState]}</span>
      </span>

      {p.sessionId && (
        <span className="statusbar-item">
          <span>Session</span>
          <span style={{ color: 'var(--text-2)' }}>{p.sessionId.slice(0, 8)}</span>
        </span>
      )}

      <span className="statusbar-item">
        <span>延迟</span>
        <span style={{ color: 'var(--text-2)' }}>
          {p.metrics.avgLatency > 0 ? `${p.metrics.avgLatency.toFixed(0)}ms` : '—'}
        </span>
      </span>

      <span className="statusbar-item">
        <span>FPS</span>
        <span style={{ color: 'var(--text-2)' }}>
          {p.metrics.chunksProcessed > 0 ? Math.round(p.metrics.chunksProcessed / Math.max(1, (Date.now() - p.metrics.startTime) / 1000)) : 0}
        </span>
      </span>

      <span className="statusbar-spacer" />

      <span className="statusbar-item">
        <kbd className="statusbar-key">Space</kbd>
        <span>录音</span>
      </span>
      <span className="statusbar-item">
        <kbd className="statusbar-key">M</kbd>
        <span>示例</span>
      </span>
      <span className="statusbar-item">
        <kbd className="statusbar-key">R</kbd>
        <span>清除</span>
      </span>
      <span className="statusbar-item">
        <kbd className="statusbar-key">?</kbd>
        <span>帮助</span>
      </span>

      <span className="statusbar-item">
        <span style={{ color: 'var(--text-4)' }}>火山引擎 · bigmodel · 分角色</span>
      </span>
    </footer>
  );
});

StatusBar.displayName = 'StatusBar';