/**
 * CaptionBar — Sprint 9 浮动字幕
 * 替代旧 Subtitle 作为主字幕载体
 *
 * Author: Claude Opus 4.8
 */
import React from 'react';
import type { Speaker } from '../types';

export interface CaptionBarProps {
  currentText: string;
  fullText: string;
  currentSpeaker?: Speaker | null;
  isRecording: boolean;
}

const PALETTE = [
  'var(--spk-1)', 'var(--spk-2)', 'var(--spk-3)',
  'var(--spk-4)', 'var(--spk-5)', 'var(--spk-6)',
];

export const CaptionBar: React.FC<CaptionBarProps> = React.memo((p) => {
  const text = p.currentText || p.fullText.split(/[。？！\n]/).slice(-1)[0] || '';
  const empty = !text;
  const spkColor = p.currentSpeaker?.color || PALETTE[0];

  return (
    <div
      className="caption-bar"
      data-empty={empty}
      role="region"
      aria-label="实时字幕"
      aria-live="polite"
      style={{ ['--speaker-color' as string]: spkColor }}
    >
      {p.currentSpeaker && !empty && (
        <span className="caption-speaker" style={{ color: spkColor, background: `color-mix(in srgb, ${spkColor} 16%, transparent)`, borderColor: spkColor }}>
          🎙 {p.currentSpeaker.label}
        </span>
      )}
      <span className="caption-text">
        {empty
          ? (p.isRecording ? '🎙 正在聆听…' : '等待开始录音…')
          : text}
      </span>
    </div>
  );
});

CaptionBar.displayName = 'CaptionBar';