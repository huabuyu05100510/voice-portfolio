/**
 * SpeakerCard — Sprint 9
 * 单个说话人卡片: 头像 + 名字 (双击改名) + 元信息
 *
 * 会议室场景: 用户可以把"发言人 1"改成"主持人"等真实名字。
 *
 * Author: Claude Opus 4.8
 */
import React, { useState, useRef, useEffect } from 'react';
import type { Speaker } from '../types';
import { getSpeakerColor } from '../state/transcriptionReducer';

export interface SpeakerCardProps {
  speaker: Speaker;
  index: number;
  active: boolean;
  /** 重命名回调; 不传则卡片只读 */
  onRename?: (speakerId: string, label: string) => void;
}

export const SpeakerCard: React.FC<SpeakerCardProps> = React.memo((p) => {
  const color = getSpeakerColor(p.speaker.id);
  const initial = (p.speaker.label || p.speaker.id || '?').slice(0, 1).toUpperCase();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.speaker.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => { setDraft(p.speaker.label); }, [p.speaker.label]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== p.speaker.label) {
      p.onRename?.(p.speaker.id, trimmed);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(p.speaker.label);
    setEditing(false);
  };

  return (
    <div
      className="speaker-card"
      data-active={p.active}
      data-speaker-id={p.speaker.id}
      data-user-edited={p.speaker.userEdited ? 'true' : undefined}
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
        {editing ? (
          <input
            ref={inputRef}
            className="speaker-name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            aria-label={`重命名 ${p.speaker.label}`}
            maxLength={32}
          />
        ) : (
          <div
            className="speaker-name"
            onDoubleClick={p.onRename ? () => setEditing(true) : undefined}
            title={p.onRename ? '双击改名' : undefined}
          >
            {p.speaker.label || p.speaker.id}
            {p.onRename && <span className="speaker-name-edit-hint" aria-hidden="true">✎</span>}
          </div>
        )}
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