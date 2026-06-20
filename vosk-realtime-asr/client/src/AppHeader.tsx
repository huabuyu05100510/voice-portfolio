/**
 * AppHeader — 顶部标题 + 连接状态 + 主题切换器
 * Author: Claude Opus 4.8
 */
import React from 'react';
import type { WebSocketState } from './types';
import { ThemeSwitcher } from './ThemeSwitcher';

export interface AppHeaderProps {
  wsState: WebSocketState;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ wsState }) => (
  <header className="app-header" role="banner">
    <h1>🎯 Vosk 实时语音转写 Demo</h1>
    <div className="connection-status" aria-live="polite">
      <span className={`status-indicator ${wsState}`} aria-hidden="true" />
      <span>{wsState === 'connected' ? '已连接' : '未连接'}<span className="sr-only"> WebSocket {wsState}</span></span>
    </div>
    <ThemeSwitcher />
  </header>
);