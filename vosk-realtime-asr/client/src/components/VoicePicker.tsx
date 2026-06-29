/**
 * VoicePicker — 音色下拉选择 (对标 ElevenLabs / 豆包语音 音色切换)
 *
 * - combobox 角色, Enter/Space 展开, Esc 收起
 * - 选项: 性别图标 + 名称 + sample_rate 标识
 * - 选中项 aria-selected
 * - 异步加载: voices 为空时自动 fetch (useSeedTts.fetchVoices)
 */
import React, { useEffect, useRef, useState } from 'react';
import type { TtsVoice } from '../hooks/useSeedTts';
import { fetchVoices } from '../hooks/useSeedTts';

export interface VoicePickerProps {
  voices?: TtsVoice[];
  value: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
  /** 加载完成的回调 (用于父级显示 degraded 角标) */
  onMeta?: (meta: { degraded?: boolean; source?: string } | null) => void;
  className?: string;
}

const GENDER_ICON: Record<string, string> = {
  male: '♂', female: '♀', child: '◌', unknown: '?',
};

export const VoicePicker: React.FC<VoicePickerProps> = (p) => {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<TtsVoice[]>(p.voices || []);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // props.voices 显式传了 (包括空数组) → 用 props, 不自取
    if (p.voices !== undefined) {
      setVoices(p.voices);
      return;
    }
    if (voices.length > 0) return;
    let cancelled = false;
    setLoading(true);
    fetchVoices()
      .then((vs) => {
        if (cancelled) return;
        setVoices(vs);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [p.voices, voices.length]);

  // 点外关闭
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const current = voices.find(v => v.id === p.value);
  const label = current?.name || (p.value ? p.value : (loading ? '加载中…' : '暂无音色'));

  const toggle = () => { if (!p.disabled) setOpen(o => !o); };
  const close = () => setOpen(false);

  const onKey = (e: React.KeyboardEvent) => {
    if (p.disabled) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); }
  };

  return (
    <div className={`voice-picker ${p.disabled ? 'is-disabled' : ''} ${p.className || ''}`} ref={ref}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择音色"
        aria-controls="voice-picker-listbox"
        className="voice-picker-trigger"
        onClick={toggle}
        onKeyDown={onKey}
        disabled={p.disabled}
      >
        <span className="voice-picker-gender" aria-hidden="true">
          {current ? (GENDER_ICON[current.gender] || '?') : '?'}
        </span>
        <span className="voice-picker-label">{label}</span>
        <span className="voice-picker-caret" aria-hidden="true">▾</span>
      </button>
      {open && voices.length > 0 && (
        <ul
          id="voice-picker-listbox"
          role="listbox"
          className="voice-picker-listbox"
          aria-label="音色列表"
        >
          {voices.map((v) => (
            <li
              key={v.id}
              role="option"
              aria-selected={v.id === p.value}
              tabIndex={0}
              className={`voice-picker-option ${v.id === p.value ? 'is-selected' : ''}`}
              onClick={() => { p.onChange(v.id); setOpen(false); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onChange(v.id); setOpen(false); }
              }}
            >
              <span className="voice-picker-gender" aria-hidden="true">
                {GENDER_ICON[v.gender] || '?'}
              </span>
              <span className="voice-picker-option-name">{v.name}</span>
              <span className="voice-picker-option-meta">
                {v.id} · {(v.sample_rate / 1000).toFixed(0)}kHz
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

VoicePicker.displayName = 'VoicePicker';
