/**
 * TopBarActions — Sprint 16 Layout Restructuring
 *
 * Action icon buttons for the top bar: TTS, 同传, 导出, 主题.
 * Replaces TtsPlayer floating + rt-mode-fab-group.
 */
import React from 'react';
import {
  Volume2Icon,
  VolumeXIcon,
  LanguagesIcon,
  DownloadIcon,
  SunIcon,
  MoonIcon,
  MusicIcon,
} from '../design/icons';

export interface TopBarActionsProps {
  /** TTS state */
  ttsEnabled: boolean;
  onTtsToggle: () => void;
  /** 同声传译 state */
  bilingualEnabled: boolean;
  onBilingualToggle: () => void;
  /** 导出按钮 (only shown when hasResults) */
  hasResults: boolean;
  onExport: () => void;
  /** 示例音频 */
  canPlaySample: boolean;
  onPlaySample: () => void;
  /** 主题 */
  theme: 'dark' | 'light' | 'hc';
  onThemeToggle: () => void;
}

export const TopBarActions: React.FC<TopBarActionsProps> = React.memo((p) => (
  <div className="topbar-actions">
    {/* TTS toggle */}
    <button
      type="button"
      className={`topbar-action-btn${p.ttsEnabled ? ' topbar-action-btn--active' : ''}`}
      onClick={p.onTtsToggle}
      aria-label={p.ttsEnabled ? '关闭语音合成' : '开启语音合成'}
      title={p.ttsEnabled ? 'TTS 已开启' : 'TTS 已关闭'}
    >
      {p.ttsEnabled ? <Volume2Icon size={16} /> : <VolumeXIcon size={16} />}
    </button>

    {/* 同传 toggle */}
    <button
      type="button"
      className={`topbar-action-btn${p.bilingualEnabled ? ' topbar-action-btn--active' : ''}`}
      onClick={p.onBilingualToggle}
      aria-label={p.bilingualEnabled ? '关闭同声传译' : '开启同声传译'}
      title={p.bilingualEnabled ? '同传已开启' : '同传已关闭'}
    >
      <LanguagesIcon size={16} />
    </button>

    {/* 示例音频 */}
    {p.canPlaySample && (
      <button
        type="button"
        className="topbar-action-btn"
        onClick={p.onPlaySample}
        aria-label="测试示例音频 (快捷键 M)"
        title="示例音频"
      >
        <MusicIcon size={16} />
      </button>
    )}

    {/* 导出 */}
    {p.hasResults && (
      <button
        type="button"
        className="topbar-action-btn"
        onClick={p.onExport}
        aria-label="导出会议纪要"
        title="导出纪要"
      >
        <DownloadIcon size={16} />
      </button>
    )}

    {/* 主题切换 */}
    <button
      type="button"
      className="topbar-action-btn"
      onClick={p.onThemeToggle}
      aria-label="切换主题"
      title={`当前: ${p.theme === 'dark' ? '暗色' : p.theme === 'light' ? '亮色' : '高对比'}`}
    >
      {p.theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  </div>
));

TopBarActions.displayName = 'TopBarActions';
