/**
 * SideMenu — Sprint 18 Admin Layout (全量 AI 能力集成)
 *
 * 左侧菜单栏: 品牌 + 分组导航 + 状态信息
 * 7 项 AI 能力, 3 个分组:
 *   - 转写: 实时转写 / 文件识别
 *   - 生成: 对话模式 / 播客生成
 *   - 音色: 音色设计 / 音色库 / 语音克隆
 *
 * 对标 Ant Design Pro / Element Admin 侧边栏
 */
import React from 'react';
import type { WebSocketState, SessionMetrics } from '../types';
import type { AppMode } from './ModeTabs';
import {
  MicIcon,
  UsersIcon,
  ChartIcon,
  SettingsIcon,
  SparklesIcon,
  ActivityIcon,
  MusicIcon,
  UploadIcon,
  LibraryIcon,
  RecordVoiceIcon,
} from '../design/icons';

export interface SideMenuProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  sessionId: string | null;
  wsState: WebSocketState;
  metrics: SessionMetrics;
}

interface MenuItem {
  key: AppMode;
  label: string;
  icon: React.FC<{ size?: number }>;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const MENU_SECTIONS: MenuSection[] = [
  {
    label: '转写',
    items: [
      { key: 'transcribe', label: '实时转写', icon: MicIcon },
      { key: 'file_recognition', label: '文件识别', icon: UploadIcon },
    ],
  },
  {
    label: '生成',
    items: [
      { key: 'conversation', label: '对话模式', icon: UsersIcon },
      { key: 'podcast', label: '播客生成', icon: MusicIcon },
    ],
  },
  {
    label: '音色',
    items: [
      { key: 'voice_design', label: '音色设计', icon: SparklesIcon },
      { key: 'voice_library', label: '音色库', icon: LibraryIcon },
      { key: 'voice_cloning', label: '语音克隆', icon: RecordVoiceIcon },
    ],
  },
];

export const SideMenu: React.FC<SideMenuProps> = React.memo((p) => {
  const recording = p.mode === 'transcribe';

  return (
    <aside className="side-menu" aria-label="主导航" data-testid="side-menu">
      {/* Brand */}
      <div className="side-menu-brand">
        <span className="side-menu-logo">
          <MicIcon size={18} />
        </span>
        <div className="side-menu-brand-text">
          <span className="side-menu-brand-title">Voice Portfolio</span>
          <span className="side-menu-brand-sub">火山引擎 ASR</span>
        </div>
      </div>

      {/* Nav Items — grouped by section */}
      <nav className="side-menu-nav" role="navigation">
        {MENU_SECTIONS.map((section) => (
          <div key={section.label} className="side-menu-section">
            <div className="side-menu-section-label">{section.label}</div>
            {section.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`side-menu-item${p.mode === item.key ? ' side-menu-item--active' : ''}`}
                onClick={() => p.onModeChange(item.key)}
                aria-current={p.mode === item.key ? 'page' : undefined}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Status Footer */}
      <div className="side-menu-footer">
        <div className="side-menu-section-label">系统状态</div>
        <div className="side-menu-status">
          <div className="side-menu-status-row">
            <span className={`status-dot status-dot--${p.wsState === 'connected' ? 'ok' : 'err'}`} />
            <span>WS {p.wsState}</span>
          </div>
          {p.sessionId && (
            <div className="side-menu-status-row">
              <span className="side-menu-status-mono">{p.sessionId.slice(-12)}</span>
            </div>
          )}
          {recording && (
            <div className="side-menu-status-row">
              <ActivityIcon size={14} />
              <span>{p.metrics.avgLatency?.toFixed(0) ?? '--'}ms · {((p.metrics.audioBytes ?? 0) / 1024).toFixed(0)}KB</span>
            </div>
          )}
        </div>

        <div className="side-menu-shortcuts">
          <span className="side-menu-section-label">快捷键</span>
          <div className="side-menu-kbd-list">
            <span className="side-menu-kbd"><kbd>Space</kbd> 录音</span>
            <span className="side-menu-kbd"><kbd>K</kbd> 字幕</span>
            <span className="side-menu-kbd"><kbd>M</kbd> 示例</span>
            <span className="side-menu-kbd"><kbd>R</kbd> 清除</span>
          </div>
        </div>
      </div>
    </aside>
  );
});

SideMenu.displayName = 'SideMenu';
// (ChartIcon / SettingsIcon imported above are reserved for future toolbar extensions; keep lint happy.)
void ChartIcon; void SettingsIcon;