/**
 * TtsSettings — 语速 / 音调 / 格式 调节面板
 *
 * 设计:
 * - 滑块: speed (0.5~2.0, step 0.1), pitch (0.5~2.0, step 0.1)
 * - 格式: mp3 / pcm / wav 三选一 (togglable button group)
 * - 实时 label 同步 (1.0x)
 * - 双向绑定, onChange({speed, pitch, audioFormat}) 整体透传
 */
import React from 'react';

export interface TtsSettingsValue {
  speed: number;
  pitch: number;
  audioFormat: 'mp3' | 'pcm' | 'wav' | 'ogg' | 'opus';
}

export interface TtsSettingsProps {
  value: TtsSettingsValue;
  onChange: (next: TtsSettingsValue) => void;
  disabled?: boolean;
  className?: string;
}

const FORMATS: Array<{ id: TtsSettingsValue['audioFormat']; label: string }> = [
  { id: 'mp3', label: 'MP3' },
  { id: 'pcm', label: 'PCM' },
  { id: 'wav', label: 'WAV' },
];

export const TtsSettings: React.FC<TtsSettingsProps> = (p) => {
  const set = <K extends keyof TtsSettingsValue>(k: K, v: TtsSettingsValue[K]) => {
    p.onChange({ ...p.value, [k]: v });
  };

  return (
    <div className={`tts-settings ${p.disabled ? 'is-disabled' : ''} ${p.className || ''}`}>
      <div className="tts-setting-row">
        <label htmlFor="tts-speed" className="tts-setting-label">语速</label>
        <input
          id="tts-speed"
          data-testid="tts-speed"
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={p.value.speed}
          disabled={p.disabled}
          onChange={(e) => set('speed', Number(e.target.value))}
          className="tts-slider"
        />
        <span className="tts-setting-value" data-testid="tts-speed-label">
          {p.value.speed.toFixed(1)}x
        </span>
      </div>

      <div className="tts-setting-row">
        <label htmlFor="tts-pitch" className="tts-setting-label">音调</label>
        <input
          id="tts-pitch"
          data-testid="tts-pitch"
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={p.value.pitch}
          disabled={p.disabled}
          onChange={(e) => set('pitch', Number(e.target.value))}
          className="tts-slider"
        />
        <span className="tts-setting-value" data-testid="tts-pitch-label">
          {p.value.pitch.toFixed(1)}x
        </span>
      </div>

      <div className="tts-setting-row">
        <span className="tts-setting-label">格式</span>
        <div role="group" aria-label="音频格式" className="tts-format-group">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="tts-format-btn"
              aria-pressed={p.value.audioFormat === f.id}
              disabled={p.disabled}
              onClick={() => set('audioFormat', f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

TtsSettings.displayName = 'TtsSettings';
