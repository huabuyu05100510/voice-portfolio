/**
 * SpeakerCard — Sprint 9
 * 单个说话人卡片: 头像 + 名字 + 元信息 + 实时波形
 *
 * Author: Claude Opus 4.8
 */
import React from 'react';
import type { Speaker } from '../types';

export interface SpeakerCardProps {
  speaker: Speaker;
  index: number;
  active: boolean;
}

const PALETTE = [
  'var(--spk-1)', 'var(--spk-2)', 'var(--spk-3)',
  'var(--spk-4)', 'var(--spk-5)', 'var(--spk-6)',
];

export const SpeakerCard: React.FC<SpeakerCardProps> = React.memo((p) => {
  const color = PALETTE[p.index % PALETTE.length];
  const initial = (p.speaker.label || p.speaker.id || '?').slice(0, 1).toUpperCase();
  return (
    <div
      className="speaker-card"
      data-active={p.active}
      data-speaker-id={p.speaker.id}
      role="listitem"
      style={{ ['--speaker-color' as string]: color }}
    >
      <span
        className="speaker-avatar"
        style={{ background: color }}
        aria-hidden="true"
      >
        {initial}
      </span>
      <div className="speaker-info">
        <div className="speaker-name">{p.speaker.label || p.speaker.id}</div>
        <div className="speaker-meta">
          {p.speaker.duration_sec != null
            ? `${(p.speaker.duration_sec).toFixed(1)}s`
            : '—'}
          {p.speaker.chars != null && ` · ${p.speaker.chars}字`}
        </div>
      </div>
    </div>
  );
});

SpeakerCard.displayName = 'SpeakerCard';