/**
 * RecordingButton — Sprint 9
 * 主 CTA, 录音状态机: idle / ready / connecting / recording / paused / error
 *
 * Author: Claude Opus 4.8
 */
import React, { useMemo } from 'react';
import type { AppStatus } from '../types';

export interface RecordingButtonProps {
  state: AppStatus;
  isRecording: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
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
  const buttonState = useMemo(() => {
    if (p.isRecording) return 'recording';
    if (p.state === 'ready') return 'ready';
    return 'idle';
  }, [p.isRecording, p.state]);

  const handle = () => {
    if (p.disabled) return;
    if (p.isRecording) p.onStop();
    else p.onStart();
  };

  const label = LABELS[p.state] ?? LABELS.idle;

  return (
    <button
      type="button"
      className="record-btn"
      data-state={buttonState}
      disabled={p.disabled}
      onClick={handle}
      aria-label={`${label} (快捷键 Space)`}
      aria-keyshortcuts="Space"
    >
      <span className="record-icon" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
});

RecordingButton.displayName = 'RecordingButton';