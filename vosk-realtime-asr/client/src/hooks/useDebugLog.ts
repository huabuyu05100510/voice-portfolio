/**
 * useDebugLog
 * -----------
 * 给"调试面板"用的环形缓冲 (最多 15 条)。
 * 每条都同步打到 console, 用户 F12 / 页面都能看到。
 *
 * Author: Claude Opus 4.8
 */
import { useState, useCallback, useRef } from 'react';

export interface DebugEntry {
  ts: number;
  step: string;
  detail: string;
}

const MAX_LOG = 15;

export interface UseDebugLogReturn {
  log: DebugEntry[];
  push: (step: string, detail: string) => void;
  clear: () => void;
}

export const useDebugLog = (): UseDebugLogReturn => {
  const [log, setLog] = useState<DebugEntry[]>([]);
  // 避免极端情况下同 step+detail 刷屏, ref 缓存上次 push 时间
  const lastPushRef = useRef(0);

  const push = useCallback((step: string, detail: string) => {
    const entry: DebugEntry = { ts: Date.now(), step, detail };
    // eslint-disable-next-line no-console
    console.log(`[${step}] ${detail}`);
    lastPushRef.current = entry.ts;
    setLog((prev) => [...prev, entry].slice(-MAX_LOG));
  }, []);

  const clear = useCallback(() => setLog([]), []);

  return { log, push, clear };
};