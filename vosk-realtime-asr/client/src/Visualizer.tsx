/**
 * Visualizer - 多模态音频可视化 (Sprint 3)
 *
 * 4 维度:
 *   1. 频谱图 (Spectrum)    — 1024-bin FFT, 热力色 (深蓝→青→黄→红)
 *   2. 音高曲线 (Pitch)      — autocorrelation, 实时绘制 Hz 时间序列
 *   3. 能量条 (Volume VU)    — RMS 驱动的 60 段 LED 风格竖向 VU 表
 *   4. VAD 指示灯            — RMS 阈值, 说话时绿色, 静音时灰色
 *
 * 性能:
 *   - requestAnimationFrame 60fps 渲染
 *   - 直接操作 Canvas 2D context, 不触发 React re-render
 *   - 环形缓冲复用内存, 零分配
 *
 * 模型: MiniMax-M3 (per CLAUDE.md tech-sourcing directive)
 */

// ============================================================================
// 纯函数工具 (可单测)
// ============================================================================

/** Int16 -> Float32 (归一化到 -1..1) */
export function int16ToFloat32(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] / 32768.0;
  }
  return out;
}

/** RMS (Root Mean Square) — 衡量信号能量 */
export function computeRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * VAD — 简单能量阈值法
 * RMS > threshold 视为语音, 否则静音
 * 默认阈值 0.01 (归一化空间, 对应 ~ -40 dBFS)
 */
export function detectVoiceActivity(samples: Float32Array, threshold = 0.01): boolean {
  return computeRMS(samples) > threshold;
}

/**
 * 基频估计 — 自相关法 (ACF)
 * 在 [minHz, maxHz] 范围搜索最强周期
 * 返回 Hz, 失败 (静音/无周期) 返回 null
 */
export function estimatePitchAutocorrelation(
  samples: Float32Array,
  sampleRate: number,
  minHz = 60,
  maxHz = 1000
): number | null {
  const N = samples.length;
  if (N < 64) return null;

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  if (maxLag >= N) return null;

  // 能量阈值: 跳过静音
  const rms = computeRMS(samples);
  if (rms < 0.005) return null;

  // ACF: 找 r[lag] 最大, 范围 [minLag, maxLag]
  let bestLag = -1;
  let bestVal = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = N - lag;
    for (let i = 0; i < limit; i++) {
      sum += samples[i] * samples[i + lag];
    }
    if (sum > bestVal) {
      bestVal = sum;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return null;

  // 归一化: 防止单纯高能量区间胜出
  let r0 = 0;
  for (let i = 0; i < N; i++) r0 += samples[i] * samples[i];
  if (r0 <= 0) return null;
  const normalized = bestVal / r0;
  // 弱相关性视为不可信
  if (normalized < 0.3) return null;

  return sampleRate / bestLag;
}

/** bin -> Hz 映射 (FFT 频谱) */
export function binToHz(bin: number, fftSize: number, sampleRate: number): number {
  return (bin * sampleRate) / fftSize;
}

/** Hz -> bin 映射 */
export function hzToBin(hz: number, fftSize: number, sampleRate: number): number {
  return Math.round((hz * fftSize) / sampleRate);
}

// ============================================================================
// 环形缓冲数据结构
// ============================================================================

/** 音高历史 — 保留最近 N 帧 (Hz 或 null=unvoiced) */
export class PitchHistory {
  private buffer: (number | null)[] = [];
  private cap: number;

  constructor(capacity: number) {
    this.cap = capacity;
  }

  get size(): number { return this.buffer.length; }
  get values(): (number | null)[] { return this.buffer; }

  push(v: number | null): void {
    this.buffer.push(v);
    if (this.buffer.length > this.cap) this.buffer.shift();
  }

  clear(): void { this.buffer = []; }
}

/** 频谱环 — cols 列, 每列 bins 个频率 bin */
export class SpectrumRing {
  readonly cols: number;
  readonly bins: number;
  private data: Float32Array;     // cols * bins, 列优先
  private head: number = 0;      // 下一个要写入的物理 slot (即 head-1 是最新)
  private count: number = 0;     // 已写入列数 (<= cols)

  constructor(cols: number, bins: number) {
    this.cols = cols;
    this.bins = bins;
    this.data = new Float32Array(cols * bins);
  }

  get currentHead(): number { return this.head; }

  pushColumn(column: Float32Array): void {
    const start = this.head * this.bins;
    const limit = Math.min(this.bins, column.length);
    for (let i = 0; i < limit; i++) this.data[start + i] = column[i];
    this.head = (this.head + 1) % this.cols;
    if (this.count < this.cols) this.count++;
  }

  /** 取第 c 列第 b 个 bin (c=0 为最旧, c=count-1 为最新) */
  get(c: number, b: number): number {
    // 最新写入的物理 slot = (head - 1 + cols) % cols
    // 逻辑 c -> 物理 (head - 1 - (count - 1 - c) + cols) % cols
    //           = (head - count + c + cols) % cols
    const phys = ((this.head - this.count + c + this.cols) % this.cols) * this.bins + b;
    return this.data[phys];
  }

  clear(): void {
    this.data.fill(0);
    this.head = 0;
    this.count = 0;
  }
}

// ============================================================================
// 配色方案 (热力图, 深蓝→青→黄→红)
// ============================================================================
const HEATMAP: ReadonlyArray<string> = [
  '#000428', '#001e3c', '#004b6b', '#007a8a', '#00a99d',
  '#3ed4a3', '#a8e063', '#fdee2a', '#f8a425', '#ef3a2c',
  '#b30c1d', '#5a0410',
];

function heatColor(v: number): string {
  // v in 0..1
  const x = Math.max(0, Math.min(0.9999, v)) * (HEATMAP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  // 线性插值
  const c1 = hexToRgb(HEATMAP[i]!);
  const c2 = hexToRgb(HEATMAP[Math.min(i + 1, HEATMAP.length - 1)]!);
  const r = Math.round(c1.r + (c2.r - c1.r) * f);
  const g = Math.round(c1.g + (c2.g - c1.g) * f);
  const b = Math.round(c1.b + (c2.b - c1.b) * f);
  return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

// ============================================================================
// Visualizer 主类 (imperative, 不触发 React re-render)
// ============================================================================

export interface VisualizerConfig {
  fftSize?: number;        // 默认 2048
  sampleRate?: number;     // 默认 16000
  historySecs?: number;    // 默认 5s
  pitchMinHz?: number;     // 默认 60
  pitchMaxHz?: number;     // 默认 500
  vadThreshold?: number;   // 默认 0.01
  pitchSmoothing?: number; // 默认 0.7
  volumeSmoothing?: number;// 默认 0.6
  volumeScaleDb?: number;  // 默认 60 dB 满刻度
  spectrumBins?: number;   // 默认 128 (显示用)
  pitchMaxRangeHz?: number;// 默认 500
}

export class AudioVisualizer {
  // DOM
  private spectrumCanvas: HTMLCanvasElement;
  private pitchCanvas: HTMLCanvasElement;
  private volumeCanvas: HTMLCanvasElement;
  private vadIndicator: HTMLElement;
  private pitchReadout: HTMLElement;
  private volumeReadout: HTMLElement;
  private fpsReadout: HTMLElement | null;

  // Ctx
  private sctx: CanvasRenderingContext2D;
  private pctx: CanvasRenderingContext2D;
  private vctx: CanvasRenderingContext2D;

  // Web Audio
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private useAnalyser: boolean = false;

  // 数据
  private cfg: Required<VisualizerConfig>;
  private freqData: Uint8Array;
  private timeDataFloat: Float32Array;
  private spectrumRing: SpectrumRing;
  private pitchHistory: PitchHistory;
  private smoothedPitch: number | null = null;
  private smoothedRMS: number = 0;
  private smoothedVolumeDb: number = -60;
  private isVadActive: boolean = false;
  private vadHoldFrames: number = 0;

  // 渲染
  private rafId: number | null = null;
  private running: boolean = false;
  private fps: number = 0;
  private fpsFrames: number = 0;
  private fpsLastUpdate: number = 0;

  // ============================================================================
  // 构造 & 初始化
  // ============================================================================
  constructor(opts: {
    spectrumCanvas: HTMLCanvasElement;
    pitchCanvas: HTMLCanvasElement;
    volumeCanvas: HTMLCanvasElement;
    vadIndicator: HTMLElement;
    pitchReadout: HTMLElement;
    volumeReadout: HTMLElement;
    fpsReadout?: HTMLElement;
    config?: VisualizerConfig;
  }) {
    this.spectrumCanvas = opts.spectrumCanvas;
    this.pitchCanvas = opts.pitchCanvas;
    this.volumeCanvas = opts.volumeCanvas;
    this.vadIndicator = opts.vadIndicator;
    this.pitchReadout = opts.pitchReadout;
    this.volumeReadout = opts.volumeReadout;
    this.fpsReadout = opts.fpsReadout ?? null;

    this.sctx = opts.spectrumCanvas.getContext('2d')!;
    this.pctx = opts.pitchCanvas.getContext('2d')!;
    this.vctx = opts.volumeCanvas.getContext('2d')!;

    this.cfg = {
      fftSize: 2048,
      sampleRate: 16000,
      historySecs: 5,
      pitchMinHz: 60,
      pitchMaxHz: 500,
      vadThreshold: 0.01,
      pitchSmoothing: 0.7,
      volumeSmoothing: 0.6,
      volumeScaleDb: 60,
      spectrumBins: 128,
      pitchMaxRangeHz: 500,
      ...(opts.config ?? {}),
    };

    this.freqData = new Uint8Array(this.cfg.fftSize / 2);
    this.timeDataFloat = new Float32Array(this.cfg.fftSize);
    this.spectrumRing = new SpectrumRing(
      Math.max(8, Math.round(this.cfg.historySecs * 30)),
      this.cfg.spectrumBins
    );
    this.pitchHistory = new PitchHistory(Math.max(8, Math.round(this.cfg.historySecs * 30)));

    this.setupCanvases();
    this.drawIdle();
  }

  private setupCanvases(): void {
    [this.spectrumCanvas, this.pitchCanvas, this.volumeCanvas].forEach(c => {
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      c.width = Math.max(1, Math.floor(rect.width * dpr));
      c.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr);
    });
  }

  // ============================================================================
  // 数据接入 (两种模式)
  // ============================================================================

  /**
   * 模式 1: AnalyserNode 直接连麦克风 — 频谱/音高/能量都从 AnalyserNode 拿
   * 这是最简单的方式: 客户端拿到 MediaStream 后 createMediaStreamSource + Analyser
   */
  async attachStream(stream: MediaStream): Promise<void> {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    this.audioCtx = new Ctx({ latencyHint: 'interactive' });
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    this.sourceNode = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = this.cfg.fftSize;
    this.analyser.smoothingTimeConstant = 0.7;
    this.sourceNode.connect(this.analyser);
    this.useAnalyser = true;
  }

  /**
   * 模式 2: 外部推数据 (兼容 AudioCaptureEngine 推送 Int16Array 的现有架构)
   * 计算 FFT (手写 DFT 子集) 不现实, 我们用 AnalyserNode + OfflineAudioContext 重采样
   * 或简化: 直接用传入的 Int16Array 算 RMS + pitch, 频谱使用一个简单的 "移动平均" 伪频谱
   *
   * 实际选择: 仍推荐模式 1, 这里保留模式 2 作为轻量 fallback
   * (频谱退化, 但 VAD + pitch + volume 正常)
   */
  updateExternal(audioData: Int16Array | Float32Array): void {
    if (this.useAnalyser) return; // AnalyserNode 模式忽略外部
    const float = audioData instanceof Int16Array
      ? int16ToFloat32(audioData)
      : audioData;

    this.processFrame(float);
  }

  // ============================================================================
  // 启动 / 停止
  // ============================================================================
  start(): void {
    if (this.running) return;
    this.running = true;
    this.fpsLastUpdate = performance.now();
    this.fpsFrames = 0;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.drawIdle();
  }

  destroy(): void {
    this.stop();
    if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch {} this.sourceNode = null; }
    if (this.analyser)   { try { this.analyser.disconnect(); }   catch {} this.analyser = null; }
    if (this.audioCtx)   { try { this.audioCtx.close(); }        catch {} this.audioCtx = null; }
  }

  // ============================================================================
  // 帧主循环
  // ============================================================================
  private tick = (): void => {
    if (!this.running) return;

    if (this.useAnalyser && this.analyser) {
      // ts-ignore: TS DOM lib variance mismatch on ArrayBufferLike vs ArrayBuffer
      (this.analyser as AnalyserNode).getFloatTimeDomainData(this.timeDataFloat as Float32Array<ArrayBuffer>);
      this.processFrame(this.timeDataFloat);
    } else if (!this.useAnalyser) {
      // 没有数据时维持绘制, 但不推帧
      // (由 updateExternal 推帧)
    }

    this.drawAll();
    this.updateFps();

    this.rafId = requestAnimationFrame(this.tick);
  };

  private processFrame(samples: Float32Array): void {
    // 1. RMS / 能量
    const rms = computeRMS(samples);
    this.smoothedRMS = this.smoothedRMS * this.cfg.volumeSmoothing + rms * (1 - this.cfg.volumeSmoothing);

    // 2. dB 转换 (-scale..0 dB)
    const db = this.smoothedRMS > 0
      ? 20 * Math.log10(this.smoothedRMS)
      : -this.cfg.volumeScaleDb;
    this.smoothedVolumeDb = Math.max(-this.cfg.volumeScaleDb, Math.min(0, db));

    // 3. VAD
    const vadNow = this.smoothedRMS > this.cfg.vadThreshold;
    if (vadNow) {
      this.vadHoldFrames = 5; // 至少保持 5 帧避免闪烁
      this.isVadActive = true;
    } else if (this.vadHoldFrames > 0) {
      this.vadHoldFrames--;
      this.isVadActive = true;
    } else {
      this.isVadActive = false;
    }

    // 4. 频谱 (只有 AnalyserNode 模式有真实 FFT, 否则用伪频谱)
    if (this.useAnalyser && this.analyser) {
      (this.analyser as AnalyserNode).getByteFrequencyData(this.freqData as Uint8Array<ArrayBuffer>);
      // 降采样到 spectrumBins 个 bin
      const downsample = new Float32Array(this.cfg.spectrumBins);
      const ratio = this.freqData.length / this.cfg.spectrumBins;
      for (let i = 0; i < this.cfg.spectrumBins; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.floor((i + 1) * ratio);
        let max = 0;
        for (let j = start; j < end; j++) {
          if (this.freqData[j]! > max) max = this.freqData[j]!;
        }
        downsample[i] = max / 255.0;
      }
      this.spectrumRing.pushColumn(downsample);
    } else {
      // fallback: 用 autocorrelation 滞后峰作为单 bin "频谱中心"
      const pseudo = new Float32Array(this.cfg.spectrumBins).fill(0);
      if (this.isVadActive) {
        // 用 pitch 估算出的频率点亮对应 bin
        if (this.smoothedPitch !== null) {
          const bin = Math.min(this.cfg.spectrumBins - 1, Math.max(0,
            Math.round((this.smoothedPitch / (this.cfg.sampleRate / 2)) * this.cfg.spectrumBins)
          ));
          pseudo[bin] = 0.5;
        }
      }
      this.spectrumRing.pushColumn(pseudo);
    }

    // 5. 音高估计
    const pitch = estimatePitchAutocorrelation(
      samples, this.cfg.sampleRate, this.cfg.pitchMinHz, this.cfg.pitchMaxHz
    );
    if (pitch !== null && pitch >= this.cfg.pitchMinHz && pitch <= this.cfg.pitchMaxHz) {
      this.smoothedPitch = this.smoothedPitch === null
        ? pitch
        : this.smoothedPitch * this.cfg.pitchSmoothing + pitch * (1 - this.cfg.pitchSmoothing);
    } else if (!this.isVadActive) {
      this.smoothedPitch = null;
    }
    this.pitchHistory.push(this.smoothedPitch);
  }

  // ============================================================================
  // 绘制
  // ============================================================================
  private drawAll(): void {
    this.drawSpectrum();
    this.drawPitch();
    this.drawVolume();
    this.drawVad();
    this.updateReadouts();
  }

  private drawIdle(): void {
    this.sctx.fillStyle = '#0a0a18';
    const r = this.spectrumCanvas.getBoundingClientRect();
    this.sctx.fillRect(0, 0, r.width, r.height);
    this.pctx.fillStyle = '#0a0a18';
    this.pctx.fillRect(0, 0, r.width, r.height);
    this.vctx.fillStyle = '#0a0a18';
    this.vctx.fillRect(0, 0, r.width, r.height);
    this.vadIndicator.classList.remove('vad-on');
    this.vadIndicator.classList.add('vad-off');
    this.pitchReadout.textContent = '— Hz';
    this.volumeReadout.textContent = '— dB';
  }

  /** 频谱热力图 (X 时间, Y 频率) */
  private drawSpectrum(): void {
    const c = this.spectrumCanvas;
    const ctx = this.sctx;
    const rect = c.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;

    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, W, H);

    const cols = this.spectrumRing.cols;
    const bins = this.spectrumRing.bins;
    // 只显示 ~0..4000 Hz, 略去 4k-8k 高频
    const maxBin = Math.min(bins, Math.floor(bins * 0.5));

    const colW = W / cols;
    const binH = H / maxBin;

    for (let cIdx = 0; cIdx < cols; cIdx++) {
      for (let b = 0; b < maxBin; b++) {
        const v = this.spectrumRing.get(cIdx, b);
        if (v < 0.02) continue;
        const x = cIdx * colW;
        const y = H - (b + 1) * binH;
        ctx.fillStyle = heatColor(v);
        ctx.fillRect(x, y, colW + 0.5, binH + 0.5);
      }
    }
  }

  /** 音高曲线 (X 时间, Y Hz) */
  private drawPitch(): void {
    const c = this.pitchCanvas;
    const ctx = this.pctx;
    const rect = c.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;

    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, W, H);

    // 网格 + 频率参考线 (100/200/300/400)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (const hz of [100, 200, 300, 400]) {
      const y = H - (hz / this.cfg.pitchMaxRangeHz) * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '10px monospace';
      ctx.fillText(`${hz}Hz`, 4, y - 2);
    }

    const vals = this.pitchHistory.values;
    if (vals.length < 2) return;

    const stepX = W / (this.pitchHistory.size - 1 || 1);

    // 曲线 + 区域填充
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v === null) { started = false; continue; }
      const x = i * stepX;
      const y = H - (Math.min(v, this.cfg.pitchMaxRangeHz) / this.cfg.pitchMaxRangeHz) * H;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 当前音高点
    const last = vals[vals.length - 1];
    if (last !== null) {
      const y = H - (Math.min(last, this.cfg.pitchMaxRangeHz) / this.cfg.pitchMaxRangeHz) * H;
      const x = (vals.length - 1) * stepX;
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** VU 能量条 (60 段竖向) */
  private drawVolume(): void {
    const c = this.volumeCanvas;
    const ctx = this.vctx;
    const rect = c.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;

    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, W, H);

    // 0 dB 在顶部, -60 dB 在底部
    const segments = 24;
    const segH = H / segments;
    const ratio = Math.max(0, Math.min(1,
      (this.smoothedVolumeDb + this.cfg.volumeScaleDb) / this.cfg.volumeScaleDb
    ));
    const litCount = Math.round(ratio * segments);

    for (let i = 0; i < segments; i++) {
      const y = i * segH;
      // 颜色梯度: 绿→黄→红
      const t = i / segments;
      let color: string;
      if (t < 0.6) color = '#10b981';        // 绿
      else if (t < 0.85) color = '#f59e0b';   // 黄
      else color = '#ef4444';                 // 红

      if (i < litCount) {
        ctx.fillStyle = color;
        ctx.fillRect(2, y + 1, W - 4, segH - 2);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(2, y + 1, W - 4, segH - 2);
      }
    }
  }

  /** VAD 指示灯 */
  private drawVad(): void {
    if (this.isVadActive) {
      this.vadIndicator.classList.add('vad-on');
      this.vadIndicator.classList.remove('vad-off');
    } else {
      this.vadIndicator.classList.add('vad-off');
      this.vadIndicator.classList.remove('vad-on');
    }
  }

  private updateReadouts(): void {
    const hz = this.smoothedPitch;
    this.pitchReadout.textContent = hz !== null
      ? `${hz.toFixed(1)} Hz`
      : '— Hz';
    this.volumeReadout.textContent = `${this.smoothedVolumeDb.toFixed(1)} dB`;
  }

  private updateFps(): void {
    this.fpsFrames++;
    const now = performance.now();
    const delta = now - this.fpsLastUpdate;
    if (delta >= 500) {
      this.fps = (this.fpsFrames * 1000) / delta;
      this.fpsFrames = 0;
      this.fpsLastUpdate = now;
      if (this.fpsReadout) {
        this.fpsReadout.textContent = `${this.fps.toFixed(0)} FPS`;
      }
    }
  }
}

// ============================================================================
// React 组件包装
// ============================================================================
import React, { useEffect, useRef, useState } from 'react';

export interface VisualizerPanelProps {
  /** 是否启用 AnalyserNode 直连 (需外部传入 MediaStream) */
  stream?: MediaStream | null;
  /** 外部数据源 (无 stream 时使用) */
  audioData?: Int16Array | null;
  /** 是否在录音中 */
  active: boolean;
}

export const VisualizerPanel: React.FC<VisualizerPanelProps> = ({ stream, audioData, active }) => {
  // Sprint 8: 默认折叠 — 录音时才展开 (active 变化触发)
  const [expanded, setExpanded] = useState(false);
  const specRef = useRef<HTMLCanvasElement>(null);
  const pitchRef = useRef<HTMLCanvasElement>(null);
  const volRef = useRef<HTMLCanvasElement>(null);
  const vadRef = useRef<HTMLDivElement>(null);
  const pitchRO = useRef<HTMLSpanElement>(null);
  const volRO = useRef<HTMLSpanElement>(null);
  const fpsRO = useRef<HTMLSpanElement>(null);
  const visRef = useRef<AudioVisualizer | null>(null);

  // 录音中自动展开, 停止后给用户 3s 时间看波形再收回
  useEffect(() => {
    if (active) setExpanded(true);
    else {
      const t = setTimeout(() => setExpanded(false), 3000);
      return () => clearTimeout(t);
    }
  }, [active]);

  useEffect(() => {
    if (!specRef.current || !pitchRef.current || !volRef.current || !vadRef.current || !pitchRO.current || !volRO.current) return;
    visRef.current = new AudioVisualizer({
      spectrumCanvas: specRef.current,
      pitchCanvas: pitchRef.current,
      volumeCanvas: volRef.current,
      vadIndicator: vadRef.current,
      pitchReadout: pitchRO.current,
      volumeReadout: volRO.current,
      fpsReadout: fpsRO.current ?? undefined,
    });
    return () => { visRef.current?.destroy(); visRef.current = null; };
  }, []);

  useEffect(() => {
    if (!visRef.current) return;
    if (active) visRef.current.start();
    else visRef.current.stop();
  }, [active]);

  useEffect(() => {
    if (!visRef.current || !stream) return;
    visRef.current.attachStream(stream).catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[Visualizer] attachStream failed', err);
    });
  }, [stream]);

  useEffect(() => {
    if (!visRef.current || !audioData) return;
    visRef.current.updateExternal(audioData);
  }, [audioData]);

  return (
    <section
      className="visualizer-panel"
      data-state={expanded ? 'expanded' : 'collapsed'}
      aria-label="多模态音频可视化"
    >
      <button
        type="button"
        className="visualizer-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="visualizer-body"
      >
        <h3>
          <span className="viz-icon" aria-hidden="true">🎛</span>
          多模态音频可视化
        </h3>
        <span className="viz-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      <div id="visualizer-body" className="visualizer-grid" hidden={!expanded}>
        <div className="viz-tile">
          <div className="viz-tile-header">
            <span className="viz-label">频谱图</span>
            <span ref={fpsRO} className="viz-readout-small">0 FPS</span>
          </div>
          <canvas ref={specRef} className="viz-canvas spectrum-canvas" />
        </div>

        <div className="viz-tile">
          <div className="viz-tile-header">
            <span className="viz-label">音高曲线</span>
            <span ref={pitchRO} className="viz-readout-small">— Hz</span>
          </div>
          <canvas ref={pitchRef} className="viz-canvas pitch-canvas" />
        </div>

        <div className="viz-tile">
          <div className="viz-tile-header">
            <span className="viz-label">能量 VU</span>
            <span ref={volRO} className="viz-readout-small">— dB</span>
          </div>
          <canvas ref={volRef} className="viz-canvas volume-canvas" />
        </div>

        <div className="viz-tile vad-tile">
          <div className="viz-tile-header">
            <span className="viz-label">VAD 语音检测</span>
            <span className="viz-readout-small">{active ? '录制中' : '待机'}</span>
          </div>
          <div className="vad-center">
            <div ref={vadRef} className="vad-indicator vad-off" aria-live="polite" />
            <div className="vad-legend">
              <div><span className="dot dot-green" /> 说话</div>
              <div><span className="dot dot-gray" /> 静音</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default VisualizerPanel;
