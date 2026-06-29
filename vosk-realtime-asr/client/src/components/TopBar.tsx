/**
 * TopBar — Sprint 16 Admin Layout
 *
 * Admin header: [Brand] [RecordButton·pill] [Actions: TTS/同传/导出/示例/Theme]
 * Mode switching is in SideMenu, not here.
 */
import React from 'react';
import type { AppStatus, WebSocketState } from '../types';
import { MicIcon, MenuIcon } from '../design/icons';
import { RecordingButton } from './RecordingButton';
import { TopBarActions } from './TopBarActions';
import { ThemeSwitcher } from '../ThemeSwitcher';

export interface TopBarProps {
  /** Recording */
  status: AppStatus;
  wsState: WebSocketState;
  isRecording: boolean;
  canStart: boolean;
  onStart: () => void;
  onStop: () => void;
  /** TTS */
  ttsEnabled: boolean;
  onTtsToggle: () => void;
  /** 同传 */
  bilingualEnabled: boolean;
  onBilingualToggle: () => void;
  /** 导出 */
  hasResults: boolean;
  onExport: () => void;
  /** 示例音频 */
  canPlaySample: boolean;
  onPlaySample: () => void;
  /** Compact mode — hide recording button (used in non-transcribe modes) */
  compact?: boolean;
  /** Hamburger menu toggle (mobile) */
  onMenuToggle?: () => void;
}

export const TopBar: React.FC<TopBarProps> = React.memo((p) => {
  return (
    <header className="app-topbar" role="banner">
      {/* Left: Menu toggle + Brand */}
      <div className="app-topbar-left">
        <button
          type="button"
          className="app-topbar-menu-btn"
          onClick={p.onMenuToggle}
          aria-label="切换菜单"
        >
          <MenuIcon size={18} />
        </button>
        <div className="app-topbar-brand">
          <span className="app-topbar-brand-mark" aria-hidden="true">
            <MicIcon size={14} />
          </span>
          <h1 className="app-topbar-title">火山引擎 · 分角色实时转写</h1>
        </div>
      </div>

      {/* Center: Record Button — hidden in compact modes */}
      {!p.compact && (
        <div className="app-topbar-center">
          <RecordingButton
            state={p.status}
            isRecording={p.isRecording}
            disabled={!p.canStart && !p.isRecording}
            onStart={p.onStart}
            onStop={p.onStop}
            variant="pill"
          />
        </div>
      )}

      {/* Right: Actions + Theme */}
      <div className="app-topbar-right" style={p.compact ? { flex: 1, justifyContent: 'flex-end' } : undefined}>
        <TopBarActions
          ttsEnabled={p.ttsEnabled}
          onTtsToggle={p.onTtsToggle}
          bilingualEnabled={p.bilingualEnabled}
          onBilingualToggle={p.onBilingualToggle}
          hasResults={p.hasResults}
          onExport={p.onExport}
          canPlaySample={p.canPlaySample}
          onPlaySample={p.onPlaySample}
          theme="dark"
          onThemeToggle={() => {
            const themeBtns = document.querySelectorAll<HTMLButtonElement>('.theme-option');
            if (themeBtns.length > 0) {
              const current = document.querySelector<HTMLButtonElement>('.theme-option[aria-checked="true"]');
              const idx = current ? Array.from(themeBtns).indexOf(current) : -1;
              const next = themeBtns[(idx + 1) % themeBtns.length];
              next?.click();
            }
          }}
        />
        <ThemeSwitcher />
      </div>
    </header>
  );
});

TopBar.displayName = 'TopBar';