/**
 * VoiceCloningWizard — 4 步向导 (录制 → 上传 → 训练 → 完成)
 *
 * 设计:
 *   - 顶部 stepper: 4 步进度, 当前步骤高亮
 *   - 步骤 1 录制: 大按钮 + 录音指示器 (录制中 spinner + 计时)
 *   - 步骤 2 上传: 进度条 + 字节数
 *   - 步骤 3 训练: spinner + "训练中..." + 剩余时间 (estimate)
 *   - 步骤 4 完成: voice_id 大字 + "开始使用"
 *
 * 内部用 voiceCloningReducer 驱动 (consumer 通过 props 推 phase).
 *
 * 模型: MiniMax-M3
 */
import React, { useReducer, useEffect } from 'react';
import {
  voiceCloningReducer,
  initialVoiceState,
  type VoiceState,
} from '../state/voiceCloningReducer';

export interface VoiceCloningWizardProps {
  /** 外部状态 (可选, 优先级高于内部 reducer) */
  state?: VoiceState;
  /** 录音开始回调 (consumer 用 AudioCapture.start()) */
  onStartRecording?: () => void;
  /** 录音停止回调 (consumer 拿到 blob 后调用 onRecordingDone) */
  onStopRecording?: () => void;
  /** 录音完成回调 (consumer 提供 blob) */
  onRecordingDone?: (blob: Blob) => void;
  /** 重置回调 */
  onReset?: () => void;
  /** 完成回调 (phase=ready) */
  onComplete?: (voiceId: string) => void;
  /** 测试用: 跳过 reducer, 直接传初始状态 */
  initialState?: VoiceState;
}

const STEPS = [
  { id: 1, label: '录制', hint: '朗读 30 秒' },
  { id: 2, label: '上传', hint: '音频发送到服务端' },
  { id: 3, label: '训练', hint: '几分钟生成专属音色' },
  { id: 4, label: '完成', hint: 'voice_id 已生成' },
];

export const VoiceCloningWizard: React.FC<VoiceCloningWizardProps> = (p) => {
  const [internal, dispatch] = useReducer(voiceCloningReducer, initialVoiceState);
  // 外部 state 优先 (consumer 用), 否则用内部 reducer
  const state = p.state ?? p.initialState ?? internal;

  // 测试: 用 initialState 时跳过内部 reducer
  useEffect(() => {
    if (p.state) return;
    if (state.phase === 'ready' && state.voiceId && p.onComplete) {
      p.onComplete(state.voiceId);
    }
  }, [p.state, state.phase, state.voiceId, p.onComplete]);

  const stepIndex = phaseToStep(state.phase);

  const handleStart = () => {
    if (!p.state) dispatch({ type: 'START_RECORDING' });
    p.onStartRecording?.();
  };

  const handleStop = () => {
    p.onStopRecording?.();
  };

  const handleReset = () => {
    if (!p.state) dispatch({ type: 'RESET' });
    p.onReset?.();
  };

  return (
    <section className="voice-wizard" aria-label="声音复刻 4 步向导">
      {/* Stepper */}
      <ol className="voice-wizard-stepper" role="list" aria-label="步骤进度">
        {STEPS.map((s, i) => {
          const isActive = i === stepIndex;
          const isDone = i < stepIndex || state.phase === 'ready';
          return (
            <li
              key={s.id}
              className={`voice-wizard-step ${isActive ? 'is-active' : ''} ${
                isDone ? 'is-done' : ''
              }`}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className="voice-wizard-step-num" aria-hidden="true">
                {s.id}
              </span>
              <span className="voice-wizard-step-label">{s.label}</span>
              <span className="voice-wizard-step-hint">{s.hint}</span>
            </li>
          );
        })}
      </ol>

      {/* Step body */}
      <div className="voice-wizard-body">
        {state.phase === 'idle' && (
          <div className="voice-wizard-card" role="region" aria-label="步骤 1 录制">
            <h3>步骤 1: 录制样本</h3>
            <p className="voice-wizard-desc">
              朗读一段 30 秒左右的文字, 系统将用此音频训练你的专属音色.
            </p>
            <button
              type="button"
              className="voice-wizard-btn-primary"
              onClick={handleStart}
              aria-label="开始录制"
            >
              开始录制
            </button>
          </div>
        )}

        {state.phase === 'recording' && (
          <div
            className="voice-wizard-card is-recording"
            role="region"
            aria-label="步骤 1 录制中"
          >
            <h3>正在录制...</h3>
            <div className="voice-wizard-rec-indicator" aria-hidden="true">
              <span className="rec-dot" />
              <span>REC</span>
            </div>
            <p className="voice-wizard-desc">
              请朗读一段清晰、自然的句子 (避免背景噪音).
            </p>
            <button
              type="button"
              className="voice-wizard-btn-primary"
              onClick={handleStop}
              aria-label="停止录制"
            >
              停止
            </button>
          </div>
        )}

        {state.phase === 'uploading' && (
          <div className="voice-wizard-card" role="region" aria-label="步骤 2 上传中">
            <h3>步骤 2: 上传音频</h3>
            <div className="voice-wizard-progress" aria-hidden="true">
              <div className="voice-wizard-progress-bar is-indeterminate" />
            </div>
            <p className="voice-wizard-desc">{state.statusText ?? '上传中...'}</p>
          </div>
        )}

        {state.phase === 'training' && (
          <div className="voice-wizard-card" role="region" aria-label="步骤 3 训练中">
            <h3>步骤 3: 训练音色</h3>
            <div className="voice-wizard-spinner" aria-hidden="true">
              <span className="spinner-ring" />
            </div>
            <p className="voice-wizard-desc">{state.statusText ?? '正在训练...'}</p>
            <p className="voice-wizard-hint">通常需要几秒到几分钟, 请稍候.</p>
          </div>
        )}

        {state.phase === 'ready' && (
          <div className="voice-wizard-card is-success" role="region" aria-label="步骤 4 完成">
            <h3>训练完成</h3>
            <div className="voice-wizard-voice-id" aria-label="voice_id">
              {state.voiceId}
            </div>
            <p className="voice-wizard-hint">
              已自动保存到浏览器. 在「音色库」中可试听 / 删除.
            </p>
          </div>
        )}

        {state.phase === 'failed' && (
          <div className="voice-wizard-card is-failed" role="alert">
            <h3>训练失败</h3>
            <p className="voice-wizard-error">{state.error}</p>
            <button
              type="button"
              className="voice-wizard-btn-primary"
              onClick={handleReset}
              aria-label="重试"
            >
              重试
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

function phaseToStep(phase: VoiceState['phase']): number {
  switch (phase) {
    case 'idle':
    case 'recording':
      return 0;
    case 'uploading':
      return 1;
    case 'training':
      return 2;
    case 'ready':
    case 'failed':
      return 3;
    default:
      return 0;
  }
}

VoiceCloningWizard.displayName = 'VoiceCloningWizard';
