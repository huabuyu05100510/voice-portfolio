/**
 * useThrottledPartial — partial result 节流 hook (模块 A 性能优化)
 *
 * 背景: 火山引擎 partial 帧率 ~200-300ms, 但 React state 触发的 re-render
 * 与 rAF (16.67ms) 频率不一致. 短时间多次 partial 会让 reducer 频繁 dispatch
 * + CaptionBar 频繁 re-render, 浪费主线程.
 *
 * 策略: leading + trailing 节流 (默认 16ms 对齐 rAF).
 *  - leading edge 立即发出 (保持响应感)
 *  - 同一窗口内的后续调用被合并, 只在 trailing edge 发出最后一次
 *  - 窗口之间无调用, trailing 不触发 (避免空跑)
 *  - 卸载时清理 timer, 防止 onEmit on unmounted
 *
 * 泛型支持 (Task 13.4): 默认 T=string, 也可传复杂 payload (PartialPayload 等).
 *
 * 用法:
 *   const throttledPush = useThrottledPartial({ intervalMs: 16, onEmit: pushPartial });
 *   throttledPush('text');   // 任何来源 (ws / sample) 都过这里
 *
 *   // 泛型 payload:
 *   const throttledPush = useThrottledPartial<PartialPayload>({ ... });
 *   throttledPush({ text, fullText, speakerId });
 */
import { useCallback, useEffect, useRef } from 'react';

export interface UseThrottledPartialOptionsSimple {
  /** 节流窗口 (ms), 默认 16 对齐 rAF */
  intervalMs?: number;
  /** 实际发出回调 */
  onEmit: (text: string) => void;
  /** leading edge 关闭 (默认 true, 保持响应) */
  leading?: boolean;
}

export interface UseThrottledPartialOptionsGeneric<T> {
  /** 节流窗口 (ms), 默认 16 对齐 rAF */
  intervalMs?: number;
  /** 实际发出回调 (泛型) */
  onEmit: (payload: T) => void;
  /** leading edge 关闭 (默认 true, 保持响应) */
  leading?: boolean;
}

export type UseThrottledPartialOptions<T = string> =
  T extends string ? UseThrottledPartialOptionsSimple | UseThrottledPartialOptionsGeneric<T>
  : UseThrottledPartialOptionsGeneric<T>;

export interface ThrottledPush<T = string> {
  (payload: T): void;
  /** 强制 flush 挂起值 (例如停止录音) */
  flush: () => void;
  /** 取消挂起的 trailing (不 flush) */
  cancel: () => void;
}

export function useThrottledPartial(opts: UseThrottledPartialOptionsSimple): ThrottledPush<string>;
export function useThrottledPartial<T>(opts: UseThrottledPartialOptionsGeneric<T>): ThrottledPush<T>;
export function useThrottledPartial<T = string>(
  opts: UseThrottledPartialOptionsGeneric<T> | UseThrottledPartialOptionsSimple,
): ThrottledPush<T> {
  const { intervalMs = 16, onEmit, leading = true } = opts;
  const typedOnEmit = onEmit as (payload: T) => void;
  // lastEmit: 最近一次 onEmit 被调用的时间 (用哨兵 -1 表示"从未发出")
  const lastEmitRef = useRef<number>(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<T | null>(null);
  const mountedRef = useRef<boolean>(true);

  const now = () => Date.now();

  // 卸载清理
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const invoke = useCallback(
    (payload: T) => {
      if (!mountedRef.current) return;
      lastEmitRef.current = now();
      typedOnEmit(payload);
    },
    [typedOnEmit],
  );

  const scheduleTrailing = useCallback(() => {
    if (timerRef.current != null) return; // 已有 trailing
    const t = now();
    const elapsed = lastEmitRef.current < 0 ? 0 : t - lastEmitRef.current;
    const delay = Math.max(0, intervalMs - elapsed);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending != null) {
        invoke(pending);
      }
    }, delay);
  }, [intervalMs, invoke]);

  const push = useCallback(
    (payload: T) => {
      const t = now();
      const isFirst = lastEmitRef.current < 0;
      const elapsed = isFirst ? intervalMs : t - lastEmitRef.current;
      // leading edge: 第一次发出 或距上次发出超过窗口
      if (leading && elapsed >= intervalMs) {
        pendingRef.current = null;
        if (timerRef.current != null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        invoke(payload);
        return;
      }
      // 非 leading: 缓存为 pending, 等 trailing
      pendingRef.current = payload;
      scheduleTrailing();
    },
    [leading, intervalMs, invoke, scheduleTrailing],
  );

  const flush = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending != null) {
      invoke(pending);
    }
  }, [invoke]);

  const cancel = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  return Object.assign(push as ThrottledPush<T>, { flush, cancel });
}
