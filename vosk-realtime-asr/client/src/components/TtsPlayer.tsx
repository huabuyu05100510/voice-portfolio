/**
 * TtsPlayer — TTS 朗读控件 (Sprint 16: emoji→SVG icons)
 *
 * UI:
 *  - 喇叭按钮 (toggle 静音)
 *  - 队列长度徽章
 *
 * 不渲染 audio 元素本身 (useTtsPlayback 内部用 new Audio() 不挂 DOM).
 */
import React from 'react';
import { Volume2Icon, VolumeXIcon, SkipForwardIcon } from '../design/icons';

export interface TtsPlayerProps {
  enabled: boolean;
  queueLength: number;
  onToggle: () => void;
  onSkip?: () => void;
}

export const TtsPlayer: React.FC<TtsPlayerProps> = (p) => {
  return (
    <div className="tts-player" role="group" aria-label="语音合成控制">
      <button
        type="button"
        className={`tts-btn ${p.enabled ? 'is-on' : 'is-off'}`}
        onClick={p.onToggle}
        aria-pressed={p.enabled}
        aria-label={p.enabled ? '关闭语音朗读' : '开启语音朗读'}
        title={p.enabled ? '点击关闭朗读' : '点击开启朗读'}
      >
        <span aria-hidden="true" className="tts-icon">
          {p.enabled ? <Volume2Icon size={16} /> : <VolumeXIcon size={16} />}
        </span>
        <span className="tts-label">
          {p.enabled ? '朗读中' : '已静音'}
        </span>
      </button>
      {p.enabled && p.queueLength > 0 && (
        <span className="tts-queue-badge" title={`队列: ${p.queueLength} 句`}>
          {p.queueLength}
        </span>
      )}
      {p.enabled && p.queueLength > 0 && p.onSkip && (
        <button
          type="button"
          className="tts-skip-btn"
          onClick={p.onSkip}
          aria-label="跳过当前朗读"
          title="跳过当前"
        >
          <SkipForwardIcon size={14} />
        </button>
      )}
    </div>
  );
};

TtsPlayer.displayName = 'TtsPlayer';