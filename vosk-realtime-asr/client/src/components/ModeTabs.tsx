/**
 * ModeTabs — Sprint 16 Layout Restructuring
 *  Sprint 18: 全量 7 个 AI 能力 (转写·生成·音色 三组)
 *
 * 7 mode: 实时转写 / 对话 / 音色设计 / 文件识别 / 播客生成 / 音色库 / 语音克隆
 * Underline indicator with animation, localStorage persistence.
 */
import React from 'react';

export type AppMode =
  | 'transcribe'
  | 'conversation'
  | 'voice_design'
  | 'file_recognition'
  | 'podcast'
  | 'voice_library'
  | 'voice_cloning';

export const ALL_MODES: readonly AppMode[] = [
  'transcribe',
  'conversation',
  'voice_design',
  'file_recognition',
  'podcast',
  'voice_library',
  'voice_cloning',
] as const;

export interface ModeTabsProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
}

const TABS: { mode: AppMode; label: string }[] = [
  { mode: 'transcribe', label: '实时转写' },
  { mode: 'conversation', label: '对话' },
  { mode: 'voice_design', label: '音色设计' },
  { mode: 'file_recognition', label: '文件识别' },
  { mode: 'podcast', label: '播客生成' },
  { mode: 'voice_library', label: '音色库' },
  { mode: 'voice_cloning', label: '语音克隆' },
];

export const ModeTabs: React.FC<ModeTabsProps> = React.memo(({ mode, onChange }) => (
  <nav className="topbar-tabs" role="tablist" aria-label="功能模式">
    {TABS.map((t) => (
      <button
        key={t.mode}
        type="button"
        role="tab"
        aria-selected={mode === t.mode}
        className={`topbar-tab${mode === t.mode ? ' topbar-tab--active' : ''}`}
        onClick={() => onChange(t.mode)}
      >
        {t.label}
      </button>
    ))}
  </nav>
));

ModeTabs.displayName = 'ModeTabs';
