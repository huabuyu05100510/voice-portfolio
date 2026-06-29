/**
 * PerfMonitor - 60fps 性能监控 + 转写延迟分位数 (P50/P95/P99)
 *
 * 设计要点:
 *   - rAF 滑动窗口 (最近 60 帧的时间戳) 算 FPS, 零额外分配
 *   - 帧间时间 = t[i] - t[i-1], 跨窗口首尾
 *   - 转写延迟通过回调注入, 用 SlidingWindow(200) 维护
 *   - 主线程开销: 每帧 O(1) 推入 + 每秒 O(200) 计算分位数
 *   - 渲染频率: 1Hz (用 setInterval 而非每帧), 避免 React 渲染拖慢 rAF
 *
 * 暴露:
 *   - 默认导出 <PerfMonitor />
 *   - 命名导出: percentile, SlidingWindow, computeFpsFromFrames, formatBytes
 *     (供测试 + 复用)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';

// ============================================================================
// 纯函数工具 (可独立测试)
// ============================================================================

/**
 * 计算百分位 (nearest-rank 算法, 与 numpy.percentile interpolation='lower' 类似)
 *   rank = ceil(p/100 * n)  (1-indexed)
 *   返回 sorted[rank-1]
 */
export function percentile(xs: readonly number[], p: number): number {
  if (p < 0 || p > 100) {
    throw new Error(`percentile p 必须在 [0, 100], 收到 ${p}`);
  }
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  // nearest-rank, 1-indexed
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.max(0, Math.min(sorted.length - 1, rank - 1));
  return sorted[idx];
}

/**
 * 固定容量滑动窗口 (FIFO), 用于最近 N 个延迟样本
 * 用环形数组 + 头指针实现 O(1) push, 避免 shift() 的 O(n) 开销
 */
export class SlidingWindow<T> {
  private buf: (T | undefined)[];
  private head = 0;     // 下一个写入位置
  private filled = 0;   // 已填充数量
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }

  get size(): number {
    return this.filled;
  }

  push(v: T): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  values(): T[] {
    const out: T[] = [];
    if (this.filled === 0) return out;
    // 最老的元素在 (head - filled + capacity) % capacity
    const start = (this.head - this.filled + this.capacity) % this.capacity;
    for (let i = 0; i < this.filled; i++) {
      out.push(this.buf[(start + i) % this.capacity] as T);
    }
    return out;
  }

  clear(): void {
    this.head = 0;
    this.filled = 0;
    this.buf = new Array(this.capacity);
  }
}

/**
 * 给定最近 N 帧的时间戳数组 (ms, performance.now 时间域), 算瞬时 FPS
 * 算法: 总时长 / 帧数  (帧数 = N-1, 因为 N 个点有 N-1 段)
 */
export function computeFpsFromFrames(frames: readonly number[], now: number): number {
  if (frames.length < 2) return 0;
  // 最后一帧可能还没到 now, 用最后一帧的时间作分母
  const last = frames[frames.length - 1];
  const first = frames[0];
  const span = last - first;
  if (span <= 0) return 0;
  const fps = ((frames.length - 1) * 1000) / span;
  // 兜底: 如果 last 太老, 用 now 算
  if (now - last > span * 2 && span > 0) {
    const totalSpan = now - first;
    if (totalSpan > 0) return ((frames.length - 1) * 1000) / totalSpan;
  }
  return fps;
}

/**
 * 字节数 -> 人类可读 (1024 进制)
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  // 强制保留 1 位小数, parseFloat 会剥掉 0 后缀 — 改用 toFixed 后手工 trim
  const v = (bytes / Math.pow(k, i)).toFixed(1);
  return `${v} ${sizes[i]}`;
}

// ============================================================================
// 类型
// ============================================================================

/** 转写延迟记录回调 (ms) */
export type LatencySink = (latencyMs: number) => void;

export interface PerfMonitorHandle {
  /** 推一条转写延迟样本 (从 wsClient.onTranscriptionResult 触发) */
  recordLatency: (latencyMs: number) => void;
  /** Sprint 12 模块 A: 推一条 partial 接收时间戳 (用于算 Hz) */
  recordPartial: (timestampMs?: number) => void;
  /** Sprint 12 模块 A: 推一条 CaptionBar 渲染耗时 (来自 Profiler.onRender) */
  recordCaptionRender: (renderMs: number) => void;
  /** 模块 C: 推一条 audio 引擎指标快照 (baseLatency / outputLatency / underrunCount) */
  recordAudio: (snapshot: AudioMetricSnapshot) => void;
  /** 重置所有窗口 */
  reset: () => void;
}

/** 模块 C: AudioCaptureEngine.getMetrics() 的 PerfMonitor 视图 */
export interface AudioMetricSnapshot {
  baseLatency: number | null;
  outputLatency: number | null;
  underrunCount: number;
}

export interface PerfMonitorProps {
  /** ref 回调, 父组件拿到 handle 后调 recordLatency */
  onHandle?: (handle: PerfMonitorHandle) => void;
  /** 初始展开状态 (默认 false) */
  defaultOpen?: boolean;
  /** 帧时间窗口 (默认 60 帧) */
  fpsWindowSize?: number;
  /** 延迟样本窗口 (默认 200) */
  latencyWindowSize?: number;
}

// ============================================================================
// 内存接口 (Chrome 私有, 用 any 兼容)
// ============================================================================
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function readMemory(): PerformanceMemory | null {
  const perf = performance as any;
  return perf.memory ? (perf.memory as PerformanceMemory) : null;
}

// ============================================================================
// 主组件
// ============================================================================

export const PerfMonitor: React.FC<PerfMonitorProps> = ({
  onHandle,
  defaultOpen = false,
  fpsWindowSize = 60,
  latencyWindowSize = 200,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  // tick 仅作 1Hz 重渲染触发器, setTick(x => (x+1)|0) 写入
  const [, setTick] = useState(0);

  // 帧时间戳环形缓冲 (不存 ref 之外的中间状态, 全在 ref 里)
  const frameBufRef = useRef<{ times: Float64Array; head: number; filled: number }>({
    times: new Float64Array(fpsWindowSize),
    head: 0,
    filled: 0,
  });

  // 转写延迟窗口
  const latencyRef = useRef(new SlidingWindow<number>(latencyWindowSize));

  // Sprint 12 模块 A: partial 接收频率窗口 (Hz)
  const partialTimesRef = useRef<number[]>([]);
  // Sprint 12 模块 A: CaptionBar 渲染耗时窗口 (ms, 来自 React Profiler onRender)
  const captionRenderRef = useRef(new SlidingWindow<number>(60));

  // 上一帧时间 (算 frameTime)
  const lastFrameRef = useRef<number>(0);

  // 暴露给父组件的句柄
  const handleRef = useRef<PerfMonitorHandle | null>(null);

  // 避免 setState 触发 re-render 影响测试 snapshot (latest ref 模式)
  const fpsRef = useRef<number>(0);
  const frameTimeRef = useRef<number>(0);
  const memoryRef = useRef<PerformanceMemory | null>(null);
  const partialHzRef = useRef<number>(0);
  const captionRenderMsRef = useRef<number>(0);
  // 模块 C: audio.* 指标快照
  const audioSnapshotRef = useRef<AudioMetricSnapshot>({
    baseLatency: null,
    outputLatency: null,
    underrunCount: 0,
  });

  // --------------------------------------------------------------------------
  // 暴露 handle 给父组件 (App 拿到后调 recordLatency)
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handle: PerfMonitorHandle = {
      recordLatency: (latencyMs: number) => {
        if (Number.isFinite(latencyMs) && latencyMs >= 0) {
          latencyRef.current.push(latencyMs);
        }
      },
      recordPartial: (timestampMs?: number) => {
        const t = timestampMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
        // 滑动窗口: 只保留最近 5s 内的部分时间戳
        const cutoff = t - 5000;
        const arr = partialTimesRef.current;
        // 丢弃 < cutoff 的 (简单剪枝, 窗口 5s 上限 50 个样本, 5Hz partial 足够)
        while (arr.length > 0 && arr[0] < cutoff) arr.shift();
        arr.push(t);
      },
      recordCaptionRender: (renderMs: number) => {
        if (Number.isFinite(renderMs) && renderMs >= 0) {
          captionRenderRef.current.push(renderMs);
        }
      },
      // 模块 C: 推 audio 引擎指标快照
      recordAudio: (snapshot: AudioMetricSnapshot) => {
        audioSnapshotRef.current = {
          baseLatency: snapshot.baseLatency,
          outputLatency: snapshot.outputLatency,
          underrunCount: snapshot.underrunCount,
        };
      },
      reset: () => {
        latencyRef.current.clear();
        captionRenderRef.current.clear();
        partialTimesRef.current = [];
        frameBufRef.current = {
          times: new Float64Array(fpsWindowSize),
          head: 0,
          filled: 0,
        };
        fpsRef.current = 0;
        frameTimeRef.current = 0;
        partialHzRef.current = 0;
        captionRenderMsRef.current = 0;
        audioSnapshotRef.current = { baseLatency: null, outputLatency: null, underrunCount: 0 };
      },
    };
    handleRef.current = handle;
    if (onHandle) onHandle(handle);
  }, [onHandle, fpsWindowSize, latencyWindowSize]);

  // --------------------------------------------------------------------------
  // rAF 循环: 每帧记录时间戳 + 算 frameTime
  // --------------------------------------------------------------------------
  useEffect(() => {
    let rafId = 0;
    const tickFn = (t: number) => {
      const buf = frameBufRef.current;
      buf.times[buf.head] = t;
      buf.head = (buf.head + 1) % fpsWindowSize;
      if (buf.filled < fpsWindowSize) buf.filled++;

      if (lastFrameRef.current > 0) {
        frameTimeRef.current = t - lastFrameRef.current;
      }
      lastFrameRef.current = t;

      // 每 30 帧 (~0.5s) 重算 FPS (避免每帧都 sort 算 percentile)
      if (buf.filled >= 2 && buf.head % 30 === 0) {
        const arr: number[] = [];
        for (let i = 0; i < buf.filled; i++) {
          arr.push(buf.times[i]);
        }
        fpsRef.current = computeFpsFromFrames(arr, t);
      }

      rafId = requestAnimationFrame(tickFn);
    };
    rafId = requestAnimationFrame(tickFn);
    return () => cancelAnimationFrame(rafId);
  }, [fpsWindowSize]);

  // --------------------------------------------------------------------------
  // 1Hz 渲染 tick + 内存采样
  // --------------------------------------------------------------------------
  useEffect(() => {
    const id = window.setInterval(() => {
      memoryRef.current = readMemory();
      // 触发重渲染 (拿到最新 fps/latency)
      setTick((x) => (x + 1) | 0);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // --------------------------------------------------------------------------
  // 计算展示用数据
  // --------------------------------------------------------------------------
  const latencies = latencyRef.current.values();
  const p50 = latencies.length > 0 ? percentile(latencies, 50) : 0;
  const p95 = latencies.length > 0 ? percentile(latencies, 95) : 0;
  const p99 = latencies.length > 0 ? percentile(latencies, 99) : 0;
  const fps = fpsRef.current;
  const frameTime = frameTimeRef.current;
  const mem = memoryRef.current;

  // Sprint 12 模块 A: partial Hz + caption render ms
  //   partial Hz: 5s 窗口内时间戳数量 / 5
  //   caption render: 60 样本窗口的 P95 (避免最坏值跳动)
  const partialTimes = partialTimesRef.current;
  if (partialTimes.length >= 2) {
    const span = partialTimes[partialTimes.length - 1] - partialTimes[0];
    if (span > 0) {
      partialHzRef.current = ((partialTimes.length - 1) * 1000) / span;
    }
  } else if (partialTimes.length === 0) {
    partialHzRef.current = 0;
  }
  const partialHz = partialHzRef.current;
  const captionSamples = captionRenderRef.current.values();
  const captionRenderMs = captionSamples.length > 0 ? percentile(captionSamples, 95) : 0;
  captionRenderMsRef.current = captionRenderMs;

  // 模块 C: audio.* 指标本地快照 (从 ref 取, 用于渲染)
  const audioSnapshot = audioSnapshotRef.current;

  // FPS 颜色: 绿 ≥55, 黄 30-54, 红 <30
  const fpsColor = fps >= 55 ? '#10b981' : fps >= 30 ? '#fbbf24' : '#ef4444';

  // --------------------------------------------------------------------------
  // 渲染
  // --------------------------------------------------------------------------
  const onToggle = useCallback(() => setOpen((o) => !o), []);

  return (
    <div className="perf-monitor-root" data-perf data-perf-open={open ? 'true' : 'false'}>
      {/* 折叠按钮 (右下角) */}
      <button
        className="perf-toggle"
        onClick={onToggle}
        title={open ? '收起性能面板' : '展开性能面板'}
        aria-label="toggle performance monitor"
        data-perf-toggle
      >
        <span style={{ color: fpsColor, fontWeight: 700 }}>⚡</span>
      </button>

      {/* 展开后的面板 */}
      {open && (
        <div className="perf-panel" data-perf-panel role="dialog" aria-label="performance monitor">
          <div className="perf-header">
            <span>⚡ PERF</span>
            <button className="perf-close" onClick={onToggle} aria-label="close">×</button>
          </div>

          <div className="perf-row">
            <span className="perf-label">FPS</span>
            <span className="perf-value" style={{ color: fpsColor }} data-perf-fps>
              {fps.toFixed(1)}
            </span>
          </div>

          <div className="perf-row">
            <span className="perf-label">Frame</span>
            <span className="perf-value" data-perf-frame>
              {frameTime.toFixed(2)}ms
            </span>
          </div>

          <div className="perf-divider" />

          <div className="perf-row">
            <span className="perf-label">Latency P50</span>
            <span className="perf-value" data-perf-p50>
              {p50.toFixed(0)}ms
            </span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Latency P95</span>
            <span className="perf-value" data-perf-p95 style={{ color: p95 > 500 ? '#ef4444' : p95 > 200 ? '#fbbf24' : '#10b981' }}>
              {p95.toFixed(0)}ms
            </span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Latency P99</span>
            <span className="perf-value" data-perf-p99 style={{ color: p99 > 1000 ? '#ef4444' : p99 > 500 ? '#fbbf24' : '#10b981' }}>
              {p99.toFixed(0)}ms
            </span>
          </div>

          <div className="perf-row perf-row-sub">
            <span className="perf-label">samples</span>
            <span className="perf-value-sub">{latencies.length}/{latencyWindowSize}</span>
          </div>

          <div className="perf-divider" />

          {/* Sprint 12 模块 A: partial Hz + caption render P95 */}
          <div className="perf-row">
            <span className="perf-label">Partial Hz</span>
            <span className="perf-value" data-perf-partial-hz>
              {partialHz.toFixed(1)}
            </span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Caption P95</span>
            <span className="perf-value" data-perf-caption-render style={{ color: captionRenderMs > 4 ? '#ef4444' : captionRenderMs > 2 ? '#fbbf24' : '#10b981' }}>
              {captionRenderMs.toFixed(2)}ms
            </span>
          </div>

          {/* 模块 C: audio.* 指标 */}
          <div className="perf-row">
            <span className="perf-label">Audio baseLatency</span>
            <span className="perf-value" data-perf-audio-base-latency>
              {audioSnapshot.baseLatency != null ? audioSnapshot.baseLatency.toFixed(3) : '—'}
              <span className="perf-value-sub"> s</span>
            </span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Audio outputLatency</span>
            <span className="perf-value" data-perf-audio-output-latency>
              {audioSnapshot.outputLatency != null ? audioSnapshot.outputLatency.toFixed(3) : '—'}
              <span className="perf-value-sub"> s</span>
            </span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Worklet underruns</span>
            <span className="perf-value" data-perf-audio-underruns style={{ color: audioSnapshot.underrunCount > 5 ? '#ef4444' : audioSnapshot.underrunCount > 0 ? '#fbbf24' : '#10b981' }}>
              {audioSnapshot.underrunCount}
            </span>
          </div>

          <div className="perf-divider" />

          {mem ? (
            <>
              <div className="perf-row">
                <span className="perf-label">JS Heap</span>
                <span className="perf-value" data-perf-mem>
                  {formatBytes(mem.usedJSHeapSize)}
                </span>
              </div>
              <div className="perf-row">
                <span className="perf-label">Heap Limit</span>
                <span className="perf-value-sub">{formatBytes(mem.jsHeapSizeLimit)}</span>
              </div>
            </>
          ) : (
            <div className="perf-row">
              <span className="perf-label">JS Heap</span>
              <span className="perf-value-sub">N/A (use Chrome)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PerfMonitor;
