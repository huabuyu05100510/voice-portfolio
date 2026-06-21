/**
 * AppHeader — Sprint 9 精简版
 * 仅 logo + 状态指示 + 主题切换
 *
 * Author: Claude Opus 4.8
 */
import React from 'react';
import type { WebSocketState, AppStatus } from './types';
import { ThemeSwitcher } from './ThemeSwitcher';

export interface AppHeaderProps {
  wsState: WebSocketState;
  status?: AppStatus;
}

const STATUS_LABELS: Record<string, string> = {
  idle: '空闲',
  connecting: '连接中',
  ready: '就绪',
  recording: '录音中',
  transcribing: '转写中',
  paused: '已暂停',
  error: '错误',
  completed: '已完成',
};

export const AppHeader: React.FC<AppHeaderProps> = React.memo(({ wsState, status }) => (
  <header className="app-header" role="banner">
    <div className="app-header-brand" aria-label="应用标识">
      <span className="app-header-mark" aria-hidden="true">🎯</span>
      <h1>火山引擎 · 分角色实时转写</h1>
    </div>
    <div className="app-header-status" role="status" aria-live="polite">
      <span className="status-indicator" data-state={wsState} aria-hidden="true" />
      <span>
        {STATUS_LABELS[status ?? 'idle'] ?? '空闲'}
        <span className="sr-only"> WebSocket {wsState}</span>
      </span>
    </div>
    <ThemeSwitcher />
  </header>
));

AppHeader.displayName = 'AppHeader';