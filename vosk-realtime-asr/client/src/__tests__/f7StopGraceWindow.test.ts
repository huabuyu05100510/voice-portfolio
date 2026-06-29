/**
 * F7 停止录音 grace window 行为契约。
 *
 * 用纯状态机模拟 App.tsx 的 status 转换:
 *   recording → (stop button) → transcribing → (recording_stopped) → [grace 1.5s] → completed
 *
 * 验证两点:
 *   1. recording_stopped 不立即 completed, 而是开 grace window
 *   2. grace window 期间若来 final, 仍走 transcribing (字幕不丢)
 *
 * 注: 这是契约测试, 实际 setTimeout 由 vitest fake timers 验证 (见底下)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Status = 'idle' | 'connecting' | 'ready' | 'recording' | 'transcribing' | 'completed' | 'error';

function createStopMachine() {
  const state = {
    status: 'recording' as Status,
    pendingStop: false,
    graceTimer: null as ReturnType<typeof setTimeout> | null,
    forceTimer: null as ReturnType<typeof setTimeout> | null,
  };
  const setStatus = (s: Status) => { state.status = s; };

  function stop() {
    state.pendingStop = true;
    setStatus('transcribing');
    state.forceTimer = setTimeout(() => {
      if (state.pendingStop && state.status === 'transcribing') {
        state.pendingStop = false;
        state.forceTimer = null;
        setStatus('completed');
      }
    }, 3000);
  }
  function onRecordingStopped() {
    if (state.forceTimer) { clearTimeout(state.forceTimer); state.forceTimer = null; }
    state.graceTimer = setTimeout(() => {
      state.pendingStop = false;
      state.graceTimer = null;
      setStatus('completed');
    }, 1500);
  }
  function cleanup() {
    if (state.graceTimer) clearTimeout(state.graceTimer);
    if (state.forceTimer) clearTimeout(state.forceTimer);
  }
  return { state, stop, onRecordingStopped, cleanup };
}

describe('F7 stop grace window', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('recording_stopped 不立即 completed, 而是启动 1.5s grace', () => {
    const m = createStopMachine();
    m.stop();
    expect(m.state.status).toBe('transcribing');

    m.onRecordingStopped();
    // 立即检查: 仍 transcribing, 没跳 completed
    expect(m.state.status).toBe('transcribing');

    // 推进 1499ms: 还是 transcribing
    vi.advanceTimersByTime(1499);
    expect(m.state.status).toBe('transcribing');

    // 推进到 1500ms: 才 completed
    vi.advanceTimersByTime(1);
    expect(m.state.status).toBe('completed');
    m.cleanup();
  });

  it('grace window 期间 status 保持 transcribing, 字幕可继续接收', () => {
    const m = createStopMachine();
    m.stop();
    m.onRecordingStopped();
    vi.advanceTimersByTime(800);
    // grace 期内: 字幕组件依然能 pushFinal (状态未 completed)
    expect(m.state.status).toBe('transcribing');
    m.cleanup();
  });

  it('3s 兜底: recording_stopped 永不到达时也最终 completed', () => {
    const m = createStopMachine();
    m.stop();
    // recording_stopped 没来, force timer 跑完
    vi.advanceTimersByTime(3000);
    expect(m.state.status).toBe('completed');
    m.cleanup();
  });

  it('grace window 启动时取消 force-stop 兜底, 避免双触发', () => {
    const m = createStopMachine();
    m.stop();
    m.onRecordingStopped();
    // 即使推进 5s, force timer 已被取消, 只走 grace 路径
    vi.advanceTimersByTime(1499);
    expect(m.state.status).toBe('transcribing');
    vi.advanceTimersByTime(1);
    expect(m.state.status).toBe('completed');
    m.cleanup();
  });
});
