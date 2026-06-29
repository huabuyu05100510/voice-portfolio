/**
 * RecordingButton — Sprint 12 UI Redesign (MiniMax-M3)
 * Sprint 16: +variant prop ('pill' for TopBar, 'hero' for Empty State)
 *
 * 视觉重塑 (不破坏 props/事件契约):
 *  - variant='pill': compact button for top bar
 *  - variant='hero': 80px circle for empty state
 *  - 内部 SVG 图标 (替代 emoji, 跨平台一致)
 *  - 录音中: rec-pulse 脉冲环动效 + 停止图标
 *  - ready: 绿色脉冲微光
 *  - idle: 暗背景 + 点击进入录音
 *  - error: 警告色
 *
 * Author: MiniMax-M3 / Sprint 16 Claude Opus 4.6
 */
import React, { useMemo } from 'react';
import type { AppStatus } from '../types';
import { MicIcon, StopIcon } from '../design/icons';

export interface RecordingButtonProps {
  state: AppStatus;
  isRecording: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
  /** Sprint 16: 'pill' (top bar, default) or 'hero' (empty state large circle) */
  variant?: 'pill' | 'hero';
}

const LABELS: Record<AppStatus, string> = {
  idle: '点击开始',
  connecting: '连接中...',
  ready: '开始录音',
  recording: '停止录音',
  transcribing: '停止录音',
  paused: '继续录音',
  error: '重试连接',
  completed: '再次录音',
};

export const RecordingButton: React.FC<RecordingButtonProps> = React.memo((p) => {
  const variant = p.variant ?? 'pill';
  const buttonState = useMemo(() => {
    if (p.isRecording) return 'recording';
    if (p.state === 'ready') return 'ready';
    if (p.state === 'error') return 'error';
    return 'idle';
  }, [p.isRecording, p.state]);

  const handle = () => {
    if (p.disabled) return;
    if (p.isRecording) p.onStop();
    else p.onStart();
  };

  const label = LABELS[p.state] ?? LABELS.idle;

  // Hero variant: 80px circle in empty state
  if (variant === 'hero') {
    return (
      <div className="empty-state-record">
        <button
          type="button"
          className="empty-state-record-btn"
          data-state={buttonState}
          disabled={p.disabled}
          onClick={handle}
          aria-label={`${label} (快捷键 Space)`}
          aria-keyshortcuts="Space"
        >
          {p.isRecording
            ? <StopIcon size={32} />
            : <MicIcon size={36} />}
        </button>
        <span className="empty-state-record-label">{label}</span>
      </div>
    );
  }

  // Pill variant: compact for top bar
  return (
    <button
      type="button"
      className={`record-btn${p.isRecording ? ' rec-pulse' : ''}`}
      data-state={buttonState}
      disabled={p.disabled}
      onClick={handle}
      aria-label={`${label} (快捷键 Space)`}
      aria-keyshortcuts="Space"
    >
      <span className="record-icon" aria-hidden="true">
        {p.isRecording
          ? <StopIcon size={16} />
          : <MicIcon size={18} />}
      </span>
      <span className="record-label">{label}</span>
    </button>
  );
});

RecordingButton.displayName = 'RecordingButton';