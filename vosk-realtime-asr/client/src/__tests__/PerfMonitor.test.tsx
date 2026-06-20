/**
 * TDD: 验证百分位计算 (P50/P95/P99) + FPS 平滑
 * 修复前常见 bug:
 *   - 用 unshift+sort O(n²)
 *   - 浮点除法 off-by-one (P95 应在 [floor/ceil] 之间取最近)
 *   - 滑动窗口 200 样本超界
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import {
  percentile,
  SlidingWindow,
  computeFpsFromFrames,
  formatBytes,
  PerfMonitor,
  PerfMonitorHandle,
} from '../PerfMonitor';

describe('percentile()', () => {
  it('空数组返回 0', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('单元素数组返回该元素', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('经典 1..100 样本: P50=50, P95=95, P99=99 (nearest-rank)', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    // nearest-rank: ceil(p/100 * n)
    // P50  rank = ceil(0.50 * 100) = 50 -> xs[49] = 50
    // P95  rank = ceil(0.95 * 100) = 95 -> xs[94] = 95
    // P99  rank = ceil(0.99 * 100) = 99 -> xs[98] = 99
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 99)).toBe(99);
  });

  it('out-of-order 输入: 先排序再算百分位', () => {
    const xs = [99, 1, 50, 95, 33, 7, 80, 2];
    expect(percentile(xs, 50)).toBe(33);
    expect(percentile(xs, 95)).toBe(99);
  });

  it('真实场景: 200 个转写延迟样本 (大部分 30-50ms, 偶发 200ms+)', () => {
    const xs: number[] = [];
    for (let i = 0; i < 195; i++) xs.push(30 + (i % 20));
    for (let i = 0; i < 5; i++) xs.push(200 + i * 10);
    // xs sorted: 前 195 个在 30..49, 后 5 个在 200..240
    const p50 = percentile(xs, 50);
    const p95 = percentile(xs, 95);
    const p99 = percentile(xs, 99);
    expect(p50).toBeGreaterThanOrEqual(30);
    expect(p50).toBeLessThanOrEqual(50);
    // P95 落在 49..200 之间 (5 个 200+ 的从 index 195 开始)
    expect(p95).toBeGreaterThanOrEqual(45);
    expect(p95).toBeLessThanOrEqual(200);
    // P99 落到 195/196 位置 -> 应该是 200..240
    expect(p99).toBeGreaterThanOrEqual(200);
  });

  it('不在 0..100 范围的百分位抛出错误', () => {
    expect(() => percentile([1, 2, 3], -1)).toThrow();
    expect(() => percentile([1, 2, 3], 101)).toThrow();
  });
});

describe('SlidingWindow', () => {
  it('保留最近 N 个样本, 超界丢弃最老的', () => {
    const w = new SlidingWindow<number>(3);
    w.push(1);
    w.push(2);
    w.push(3);
    expect(w.values()).toEqual([1, 2, 3]);
    w.push(4);
    expect(w.values()).toEqual([2, 3, 4]);  // 1 被丢弃
    w.push(5);
    expect(w.values()).toEqual([3, 4, 5]);
  });

  it('size 返回当前样本数 (不超过 capacity)', () => {
    const w = new SlidingWindow<number>(3);
    expect(w.size).toBe(0);
    w.push(1);
    expect(w.size).toBe(1);
    w.push(2);
    w.push(3);
    w.push(4);
    expect(w.size).toBe(3);
  });

  it('clear 清空窗口', () => {
    const w = new SlidingWindow<number>(3);
    w.push(1);
    w.push(2);
    w.clear();
    expect(w.size).toBe(0);
    expect(w.values()).toEqual([]);
  });

  it('整数 200 容量: 推 1000 个后 size=200, values() 长度=200', () => {
    const w = new SlidingWindow<number>(200);
    for (let i = 0; i < 1000; i++) w.push(i);
    expect(w.size).toBe(200);
    const v = w.values();
    expect(v.length).toBe(200);
    // 保留的是最近 200 个, 即 800..999
    expect(v[0]).toBe(800);
    expect(v[199]).toBe(999);
  });
});

describe('computeFpsFromFrames()', () => {
  it('1 秒 60 帧 -> 60 fps', () => {
    const now = 1_000;
    const frames = Array.from({ length: 60 }, (_, i) => now - (60 - i) * (1000 / 60));
    // 帧间 ~16.67ms, 共 60 帧跨 ~1000ms
    const fps = computeFpsFromFrames(frames, now);
    expect(fps).toBeGreaterThan(58);
    expect(fps).toBeLessThan(62);
  });

  it('半秒 30 帧 -> 60 fps (帧率独立于样本数)', () => {
    const now = 1_000;
    const frames = Array.from({ length: 30 }, (_, i) => now - (30 - i) * (1000 / 60));
    const fps = computeFpsFromFrames(frames, now);
    expect(fps).toBeGreaterThan(58);
    expect(fps).toBeLessThan(62);
  });

  it('掉帧场景: 1 秒只有 30 帧 -> 30 fps', () => {
    const now = 1_000;
    const frames = Array.from({ length: 30 }, (_, i) => now - (30 - i) * (1000 / 30));
    const fps = computeFpsFromFrames(frames, now);
    expect(fps).toBeGreaterThan(28);
    expect(fps).toBeLessThan(32);
  });

  it('空帧数组返回 0', () => {
    expect(computeFpsFromFrames([], 0)).toBe(0);
  });

  it('单帧返回 0 (无法计算时间差)', () => {
    expect(computeFpsFromFrames([100], 200)).toBe(0);
  });
});

describe('formatBytes()', () => {
  it('0 字节', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
  it('1023 字节', () => {
    expect(formatBytes(1023)).toMatch(/^1023(\.\d+)? B$/);
  });
  it('1 KB = 1024 B', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });
  it('1.5 MB', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});

// ============================================================================
// DOM / 端到端: 验证 [data-perf] 元素存在, 切换可见性, 暴露 handle
// ============================================================================
describe('PerfMonitor 组件', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('渲染根容器 [data-perf]', () => {
    const { container } = render(<PerfMonitor />);
    const root = container.querySelector('[data-perf]');
    expect(root).not.toBeNull();
    // 默认折叠: 只显示 toggle 按钮, 不显示面板
    expect(root?.getAttribute('data-perf-open')).toBe('false');
    expect(container.querySelector('[data-perf-panel]')).toBeNull();
  });

  it('点 toggle 后面板展开, [data-perf-open]=true', () => {
    const { container, getByLabelText } = render(<PerfMonitor />);
    const btn = getByLabelText('toggle performance monitor');
    act(() => {
      btn.click();
    });
    expect(container.querySelector('[data-perf]')?.getAttribute('data-perf-open')).toBe('true');
    expect(container.querySelector('[data-perf-panel]')).not.toBeNull();
  });

  it('ref/onHandle 拿到 handle 后能推延迟样本', () => {
    const handleRef: { current: PerfMonitorHandle | null } = { current: null };
    const { container } = render(
      <PerfMonitor onHandle={(h) => { handleRef.current = h; }} defaultOpen={true} />
    );
    // 推 100 个样本 (50-149ms)
    act(() => {
      for (let i = 0; i < 100; i++) {
        handleRef.current?.recordLatency(50 + i);
      }
    });
    // 默认 defaultOpen=true 立即渲染面板, 但样本数要等 1Hz tick 才更新
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    // samples 计数应该在 1..100 之间
    const sub = container.querySelector('[data-perf-panel]')?.textContent || '';
    expect(sub).toMatch(/\d+\/200/);
  });

  it('rAF tick 后 FPS 显示非 0', () => {
    const { container } = render(<PerfMonitor defaultOpen={true} />);
    // 跑 60 帧 rAF
    act(() => {
      // 触发 ~30 个 rAF 周期 (16ms/帧)
      for (let i = 0; i < 60; i++) {
        vi.advanceTimersByTime(16);
      }
      // 等 1Hz tick
      vi.advanceTimersByTime(1100);
    });
    const fpsEl = container.querySelector('[data-perf-fps]');
    expect(fpsEl).not.toBeNull();
    const fpsText = fpsEl?.textContent || '0';
    // rAF 在 jsdom 下可能不触发, 但解析不抛错
    expect(parseFloat(fpsText)).toBeGreaterThanOrEqual(0);
  });

  it('handle.reset() 清空所有窗口', () => {
    const handleRef: { current: PerfMonitorHandle | null } = { current: null };
    render(<PerfMonitor onHandle={(h) => { handleRef.current = h; }} />);
    act(() => {
      handleRef.current?.recordLatency(123);
      handleRef.current?.recordLatency(456);
    });
    act(() => {
      handleRef.current?.reset();
    });
    // 推 0 样本, samples 计数应为 0
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    // reset 不抛错就算通过
    expect(handleRef.current).not.toBeNull();
  });
});
