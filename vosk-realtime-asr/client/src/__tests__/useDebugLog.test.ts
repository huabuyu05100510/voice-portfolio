/**
 * useDebugLog hook 单元测试
 * Author: Claude Opus 4.8
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebugLog } from '../hooks/useDebugLog';

describe('useDebugLog', () => {
  let consoleSpy: any;
  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation((() => undefined) as any);
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('初始为空', () => {
    const { result } = renderHook(() => useDebugLog());
    expect(result.current.log).toEqual([]);
  });

  it('push 添加条目, 含 ts/step/detail', () => {
    const { result } = renderHook(() => useDebugLog());
    act(() => result.current.push('CLICK', '测试按钮被点击'));
    expect(result.current.log).toHaveLength(1);
    expect(result.current.log[0]).toMatchObject({ step: 'CLICK', detail: '测试按钮被点击' });
    expect(typeof result.current.log[0].ts).toBe('number');
  });

  it('同步打印到 console', () => {
    const { result } = renderHook(() => useDebugLog());
    act(() => result.current.push('AUDIO', 'frame'));
    expect(consoleSpy).toHaveBeenCalledWith('[AUDIO] frame');
  });

  it('最多保留 15 条, 旧的被淘汰', () => {
    const { result } = renderHook(() => useDebugLog());
    act(() => {
      for (let i = 0; i < 25; i++) result.current.push('S', `entry-${i}`);
    });
    expect(result.current.log).toHaveLength(15);
    expect(result.current.log[0].detail).toBe('entry-10');   // 0..9 被淘汰
    expect(result.current.log[14].detail).toBe('entry-24');
  });

  it('clear 清空', () => {
    const { result } = renderHook(() => useDebugLog());
    act(() => result.current.push('X', 'y'));
    act(() => result.current.clear());
    expect(result.current.log).toEqual([]);
  });
});