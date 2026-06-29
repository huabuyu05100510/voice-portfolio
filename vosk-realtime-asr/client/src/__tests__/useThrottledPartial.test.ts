/**
 * useThrottledPartial — 节流 hook 测试
 *
 * 验收:
 *  - 短时间内多次调用, 只在 throttle window 末尾触发下游
 *  - 节流窗口 (默认 16ms) 后恢复响应
 *  - 跨多个窗口: 每个窗口的"最后一次"被保留
 *  - Task 13.4: 泛型 payload 支持
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThrottledPartial } from '../hooks/useThrottledPartial';

interface PartialPayload {
  text: string;
  fullText: string;
  speakerId: string | null;
}

describe('useThrottledPartial (string)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throttles rapid calls: only the last within window is forwarded', () => {
    const sink = vi.fn();
    const { result } = renderHook(() => useThrottledPartial({ intervalMs: 16, onEmit: sink }));

    act(() => {
      result.current('text-1');
      result.current('text-2');
      result.current('text-3');
    });

    // 立即调用 (leading edge), 第一次应发出
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenLastCalledWith('text-1');

    act(() => {
      vi.advanceTimersByTime(20);
    });

    // trailing edge: 最后一次被发出
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink).toHaveBeenLastCalledWith('text-3');
  });

  it('does not emit if window elapses with no call', () => {
    const sink = vi.fn();
    const { result } = renderHook(() => useThrottledPartial({ intervalMs: 16, onEmit: sink }));

    act(() => {
      result.current('only');
      vi.advanceTimersByTime(20);
    });

    // 'only' 已发出 (leading), trailing 因为无新调用, 不再 emit
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenLastCalledWith('only');
  });

  it('independent windows across time (realistic 250ms partial interval)', () => {
    const sink = vi.fn();
    const { result } = renderHook(() => useThrottledPartial({ intervalMs: 16, onEmit: sink }));

    // 窗口 1: 模拟 partial 200ms 一次
    act(() => {
      result.current('A1');
    });
    expect(sink).toHaveBeenLastCalledWith('A1');
    expect(sink).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(200);
      result.current('A2');
    });
    // 距上次发出 200ms >> 16ms 窗口, 立即 leading
    expect(sink).toHaveBeenLastCalledWith('A2');
    expect(sink).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(20);
    });
    // 无 pending, 不重复
    expect(sink).toHaveBeenCalledTimes(2);

    // 窗口 3
    act(() => {
      vi.advanceTimersByTime(300);
      result.current('B1');
    });
    expect(sink).toHaveBeenLastCalledWith('B1');
    expect(sink).toHaveBeenCalledTimes(3);
  });

  it('no extra emit after unmount', () => {
    const sink = vi.fn();
    const { result, unmount } = renderHook(() => useThrottledPartial({ intervalMs: 16, onEmit: sink }));

    act(() => {
      result.current('late');
    });
    expect(sink).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    // unmount 后 trailing 不应触发
    expect(sink).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Task 13.4: 泛型 payload 支持
// ============================================================================
describe('useThrottledPartial<PartialPayload>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generic payload: leading edge emits immediately with the correct payload', () => {
    const sink = vi.fn();
    const { result } = renderHook(() =>
      useThrottledPartial<PartialPayload>({ intervalMs: 16, onEmit: sink, leading: true }),
    );

    const p1: PartialPayload = { text: '你好', fullText: '你好世界', speakerId: 'spk0' };

    act(() => {
      result.current(p1);
    });

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenLastCalledWith(p1);
    expect(sink.mock.calls[0][0].speakerId).toBe('spk0');
    expect(sink.mock.calls[0][0].fullText).toBe('你好世界');
  });

  it('generic payload: trailing edge emits the latest payload after the throttle window', () => {
    const sink = vi.fn();
    const { result } = renderHook(() =>
      useThrottledPartial<PartialPayload>({ intervalMs: 16, onEmit: sink, leading: true }),
    );

    const p1: PartialPayload = { text: 'a', fullText: 'aaa', speakerId: 'spk0' };
    const p2: PartialPayload = { text: 'b', fullText: 'bbb', speakerId: 'spk0' };
    const p3: PartialPayload = { text: 'c', fullText: 'ccc', speakerId: 'spk1' };

    act(() => {
      result.current(p1); // leading edge → emits p1
      result.current(p2); // buffered
      result.current(p3); // overwrites buffer
    });

    // leading edge: p1 emitted immediately
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenLastCalledWith(p1);

    act(() => {
      vi.advanceTimersByTime(20);
    });

    // trailing edge: p3 (the last one) emitted
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink).toHaveBeenLastCalledWith(p3);
  });

  it('generic payload: flush() emits pending payload immediately', () => {
    const sink = vi.fn();
    const { result } = renderHook(() =>
      useThrottledPartial<PartialPayload>({ intervalMs: 50, onEmit: sink, leading: true }),
    );

    const p1: PartialPayload = { text: 'first', fullText: 'first full', speakerId: 'spk0' };
    const p2: PartialPayload = { text: 'second', fullText: 'second full', speakerId: 'spk0' };

    act(() => {
      result.current(p1); // leading → emits p1 immediately
      result.current(p2); // enters pending buffer
    });

    // p1 emitted via leading
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].text).toBe('first');

    // Flush before the trailing timer fires
    act(() => {
      result.current.flush();
    });

    // p2 should now be emitted via flush
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[1][0].text).toBe('second');
    expect(sink.mock.calls[1][0].fullText).toBe('second full');
  });

  it('generic payload: cancel() drops pending payload without emitting', () => {
    const sink = vi.fn();
    const { result } = renderHook(() =>
      useThrottledPartial<PartialPayload>({ intervalMs: 50, onEmit: sink, leading: true }),
    );

    const p1: PartialPayload = { text: 'keep', fullText: 'keep full', speakerId: null };
    const p2: PartialPayload = { text: 'drop', fullText: 'drop full', speakerId: null };

    act(() => {
      result.current(p1); // leading → emits p1
      result.current(p2); // enters pending buffer
    });

    // p1 emitted via leading
    expect(sink).toHaveBeenCalledTimes(1);

    // Cancel the pending
    act(() => {
      result.current.cancel();
    });

    // Advance past the window
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Should still only have p1 — p2 was cancelled
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].text).toBe('keep');
  });

  it('generic payload: leading=false suppresses immediate emit, only trailing fires', () => {
    const sink = vi.fn();
    const { result } = renderHook(() =>
      useThrottledPartial<PartialPayload>({ intervalMs: 16, onEmit: sink, leading: false }),
    );

    const p1: PartialPayload = { text: 'delayed', fullText: 'delayed full', speakerId: null };

    act(() => {
      result.current(p1);
    });

    // leading=false: nothing emitted yet
    expect(sink).toHaveBeenCalledTimes(0);

    act(() => {
      vi.advanceTimersByTime(20);
    });

    // trailing edge fires
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenLastCalledWith(p1);
  });
});
