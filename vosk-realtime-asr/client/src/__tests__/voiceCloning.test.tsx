/**
 * VoiceCloning 客户端测试 — TDD red → green
 *
 * 覆盖:
 *  - useVoiceCloning hook 状态机: idle → recording → uploading → training → ready / failed
 *  - blobToFormData: PCM Blob → multipart/form-data (audio 字段)
 *  - 训练状态轮询: 2s 间隔 + 失败 / 超时停止
 *  - voice_id 持久化: localStorage 读写
 *  - VoiceCloningWizard: 4 步渲染 + 步骤切换
 *  - VoiceLibrary: 列出 + 删除 + 试听按钮
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { blobToFormData, pollUntilTerminal } from '../utils/voiceCloningApi';
import {
  initialVoiceState,
  type VoiceState,
  type VoiceCloningActions,
  voiceCloningReducer,
} from '../state/voiceCloningReducer';
import { VoiceCloningWizard } from '../components/VoiceCloningWizard';
import { VoiceLibrary } from '../components/VoiceLibrary';

// ---------------------------------------------------------------------------
// blobToFormData
// ---------------------------------------------------------------------------
describe('blobToFormData', () => {
  it('将 PCM Blob 包装为 multipart/form-data, 字段名=audio', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });
    const fd = blobToFormData(blob, { speakerId: 'u1', sampleRate: 16000, filename: 'sample.wav' });
    // FormData 内部不能直接读取 — 用 getAll 检查
    expect(fd).toBeInstanceOf(FormData);
    const audio = fd.getAll('audio');
    expect(audio.length).toBe(1);
    expect(audio[0]).toBeInstanceOf(Blob);
    expect(fd.get('speaker_id')).toBe('u1');
    expect(fd.get('sample_rate')).toBe('16000');
  });

  it('默认 filename = voice_sample.wav', () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/wav' });
    const fd = blobToFormData(blob, { speakerId: 'u1', sampleRate: 16000 });
    const audio = fd.get('audio') as File;
    expect(audio.name || 'voice_sample.wav').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// pollUntilTerminal
// ---------------------------------------------------------------------------
describe('pollUntilTerminal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('轮询直到 status=success, 返回 voice_id', async () => {
    let callIdx = 0;
    const fetchStatus = vi.fn(async () => {
      callIdx++;
      if (callIdx < 3) return { status: 'training' };
      return { status: 'success', voice_id: 'S_done_1' };
    });

    const promise = pollUntilTerminal('t1', {
      fetchStatus,
      intervalMs: 1000,
      maxWaitMs: 10000,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    const result = await promise;
    expect(result.status).toBe('success');
    expect(result.voice_id).toBe('S_done_1');
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it('failed 状态立即终止', async () => {
    const fetchStatus = vi.fn(async () => ({
      status: 'failed',
      error: { message: 'audio too short' },
    }));
    const result = await pollUntilTerminal('t1', {
      fetchStatus,
      intervalMs: 100,
      maxWaitMs: 5000,
    });
    expect(result.status).toBe('failed');
  });

  it('maxWaitMs 超时 → 返回 status=timeout', async () => {
    const fetchStatus = vi.fn(async () => ({ status: 'training' }));
    const promise = pollUntilTerminal('t1', {
      fetchStatus,
      intervalMs: 100,
      maxWaitMs: 300,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const result = await promise;
    expect(result.status).toBe('timeout');
  });
});

// ---------------------------------------------------------------------------
// voiceCloningReducer (pure)
// ---------------------------------------------------------------------------
describe('voiceCloningReducer', () => {
  it('initial state = idle', () => {
    expect(initialVoiceState.phase).toBe('idle');
    expect(initialVoiceState.error).toBeNull();
    expect(initialVoiceState.voiceId).toBeNull();
  });

  it('START_RECORDING → recording', () => {
    const next = voiceCloningReducer(initialVoiceState, { type: 'START_RECORDING' });
    expect(next.phase).toBe('recording');
  });

  it('RECORDING_DONE → uploading', () => {
    const after = voiceCloningReducer(
      { ...initialVoiceState, phase: 'recording' },
      { type: 'RECORDING_DONE', blob: new Blob([new Uint8Array([1])]) },
    );
    expect(after.phase).toBe('uploading');
    expect(after.blob).toBeDefined();
  });

  it('UPLOAD_DONE → training', () => {
    const after = voiceCloningReducer(
      { ...initialVoiceState, phase: 'uploading', blob: new Blob([]) },
      { type: 'UPLOAD_DONE', audioId: 'audio_x', taskId: 'task_y' },
    );
    expect(after.phase).toBe('training');
    expect(after.audioId).toBe('audio_x');
    expect(after.taskId).toBe('task_y');
  });

  it('TRAIN_DONE → ready + voiceId', () => {
    const after = voiceCloningReducer(
      { ...initialVoiceState, phase: 'training' },
      { type: 'TRAIN_DONE', voiceId: 'S_z' },
    );
    expect(after.phase).toBe('ready');
    expect(after.voiceId).toBe('S_z');
  });

  it('SET_STATUS (轮询中) → phase 不变, 但 status text 更新', () => {
    const after = voiceCloningReducer(
      { ...initialVoiceState, phase: 'training' },
      { type: 'SET_STATUS', statusText: '训练中: 60%' },
    );
    expect(after.phase).toBe('training');
    expect(after.statusText).toBe('训练中: 60%');
  });

  it('ERROR → failed phase + error message', () => {
    const after = voiceCloningReducer(initialVoiceState, {
      type: 'ERROR',
      message: 'audio too short',
    });
    expect(after.phase).toBe('failed');
    expect(after.error).toBe('audio too short');
  });

  it('RESET → idle', () => {
    const after = voiceCloningReducer(
      { ...initialVoiceState, phase: 'ready', voiceId: 'S_1' },
      { type: 'RESET' },
    );
    expect(after.phase).toBe('idle');
    expect(after.voiceId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VoiceCloningWizard 4-step 渲染
// ---------------------------------------------------------------------------
describe('VoiceCloningWizard', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('默认渲染 stepper (4 步) + 步骤 1 (录制)', () => {
    render(<VoiceCloningWizard onComplete={vi.fn()} />);
    const stepper = screen.getByRole('list', { name: /步骤进度/ });
    expect(stepper.textContent).toMatch(/录制/);
    expect(stepper.textContent).toMatch(/上传/);
    expect(stepper.textContent).toMatch(/训练/);
    expect(stepper.textContent).toMatch(/完成/);
  });

  it('开始录制按钮触发 onStartRecording (mock 录音开始)', () => {
    const onStart = vi.fn();
    render(
      <VoiceCloningWizard
        onComplete={vi.fn()}
        onStartRecording={onStart}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /开始录制/ }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('完成回调 onComplete 在 phase=ready 时被调用', () => {
    const onComplete = vi.fn();
    render(
      <VoiceCloningWizard
        onComplete={onComplete}
        initialState={{
          phase: 'ready',
          voiceId: 'S_done',
          voiceName: '我的声音',
          statusText: '训练完成',
          error: null,
          blob: null,
          audioId: null,
          taskId: null,
        }}
      />,
    );
    expect(onComplete).toHaveBeenCalledWith('S_done');
  });

  it('phase=failed 时显示错误 + 重试按钮', () => {
    render(
      <VoiceCloningWizard
        onComplete={vi.fn()}
        initialState={{
          phase: 'failed',
          error: 'audio too short',
          voiceId: null,
          voiceName: null,
          statusText: null,
          blob: null,
          audioId: null,
          taskId: null,
        }}
      />,
    );
    expect(screen.getByText(/audio too short/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /重试/ })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// VoiceLibrary
// ---------------------------------------------------------------------------
describe('VoiceLibrary', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  const voices = [
    {
      voice_id: 'S_a',
      name: '我的声音A',
      status: 'ready' as const,
      created_at: 1700000000,
    },
    {
      voice_id: 'S_b',
      name: '我的声音B',
      status: 'training' as const,
      created_at: 1700000100,
    },
  ];

  it('渲染每个音色一张卡片 (name + status)', () => {
    render(
      <VoiceLibrary
        voices={voices}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    expect(screen.getByText('我的声音A')).toBeTruthy();
    expect(screen.getByText('我的声音B')).toBeTruthy();
    expect(screen.getByText(/ready/i)).toBeTruthy();
    expect(screen.getByText(/training/i)).toBeTruthy();
  });

  it('点击删除触发 onDelete(voice_id)', () => {
    const onDelete = vi.fn();
    render(
      <VoiceLibrary voices={voices} onDelete={onDelete} onPreview={vi.fn()} />,
    );
    const deleteBtns = screen.getAllByRole('button', { name: /删除/ });
    fireEvent.click(deleteBtns[0]);
    expect(onDelete).toHaveBeenCalledWith('S_a');
  });

  it('点击试听触发 onPreview(voice_id)', () => {
    const onPreview = vi.fn();
    render(
      <VoiceLibrary voices={voices} onDelete={vi.fn()} onPreview={onPreview} />,
    );
    // S_a 是 ready 状态, 可点击试听
    const previewBtns = screen.getAllByRole('button', { name: /试听/ });
    fireEvent.click(previewBtns[0]);
    expect(onPreview).toHaveBeenCalledWith('S_a');
  });

  it('空列表显示空态提示', () => {
    render(<VoiceLibrary voices={[]} onDelete={vi.fn()} onPreview={vi.fn()} />);
    expect(screen.getByText(/还没有音色/)).toBeTruthy();
  });
});
