/**
 * ControlPanel — 录音按钮组 + 状态指示
 * 从 App.tsx 抽出来, 让 App 只负责 hooks 编排
 * Author: Claude Opus 4.8
 */
import React from 'react';
import { AppStatus } from './types';

const STATUS_LABELS: Record<AppStatus, string> = {
  idle: '等待连接', connecting: '正在连接...', ready: '准备录音',
  recording: '正在录音', transcribing: '正在转写', paused: '已暂停',
  error: '错误', completed: '已完成',
};

export interface ControlPanelProps {
  status: AppStatus;
  wsState: string;
  sessionId: string | null;
  hasResults: boolean;
  bindWaveformCanvas: (el: HTMLCanvasElement | null) => void;
  onStart: () => void;
  onStop: () => void;
  onPlaySample: () => void;
  onClear: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = React.memo(({
  status, wsState, sessionId, hasResults,
  bindWaveformCanvas, onStart, onStop, onPlaySample, onClear,
}) => (
  <section className="control-section" aria-label="录音控制">
    <div className="control-buttons" role="group" aria-label="录音控制按钮">
      <button onClick={onStart}
        disabled={status !== 'ready' || wsState !== 'connected'}
        className={`btn btn-start ${status === 'recording' ? 'disabled' : ''}`}
        aria-label="开始录音 (快捷键 Space)" aria-keyshortcuts="Space">🎤 开始录音</button>
      <button onClick={onStop}
        disabled={status !== 'recording'}
        className={`btn btn-stop ${status !== 'recording' ? 'disabled' : ''}`}
        aria-label="停止录音 (快捷键 Space)" aria-keyshortcuts="Space">⏹ 停止录音</button>
      <button onClick={onPlaySample}
        disabled={status === 'recording' || wsState !== 'connected'}
        className="btn btn-sample" aria-label="测试示例音频 (快捷键 M)" aria-keyshortcuts="M">🎵 测试示例音频</button>
      <button onClick={onClear}
        disabled={!hasResults}
        className="btn btn-clear" aria-label="清除转写结果 (快捷键 R)" aria-keyshortcuts="R">🗑 清除结果</button>
    </div>

    <div className="status-display" aria-live="polite" aria-atomic="true">
      <div className="status-row">
        <span className="label">状态：</span>
        <span className={`value status-${status}`}>{STATUS_LABELS[status]}</span>
      </div>
      {sessionId && (
        <div className="status-row">
          <span className="label">会话ID：</span>
          <span className="value">{sessionId.slice(0, 8)}...</span>
        </div>
      )}
    </div>

    <div className="waveform-container" role="img" aria-label="音频波形实时可视化">
      <h3>📊 音频波形</h3>
      <canvas ref={bindWaveformCanvas} className="waveform-canvas" width={400} height={150} />
    </div>
  </section>
));

ControlPanel.displayName = 'ControlPanel';