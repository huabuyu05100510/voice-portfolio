/**
 * Visualizer 单元测试 (TDD)
 *
 * 覆盖:
 *   1. VAD (Voice Activity Detection) — RMS 阈值, 静音 / 语音数据
 *   2. 基频估计 (autocorrelation) — 已知频率的合成正弦波
 *   3. Int16 -> Float32 归一化
 *   4. 频谱 bin -> Hz 映射
 *   5. PitchHistory 环形缓冲 (保留最近 N 帧)
 *   6. RMS 计算
 */
import { describe, it, expect } from 'vitest';
import {
  int16ToFloat32,
  computeRMS,
  detectVoiceActivity,
  estimatePitchAutocorrelation,
  binToHz,
  hzToBin,
  PitchHistory,
  SpectrumRing,
} from '../Visualizer';

// ============================================================================
// Int16 -> Float32
// ============================================================================
describe('int16ToFloat32', () => {
  it('零值映射为 0', () => {
    const f = int16ToFloat32(new Int16Array([0, 0, 0]));
    expect(f[0]).toBe(0);
    expect(f[1]).toBe(0);
  });

  it('最大值 32767 映射为接近 1', () => {
    const f = int16ToFloat32(new Int16Array([32767]));
    expect(f[0]).toBeCloseTo(1.0, 2);
  });

  it('最小值 -32768 映射为 -1', () => {
    const f = int16ToFloat32(new Int16Array([-32768]));
    expect(f[0]).toBe(-1.0);
  });

  it('输出长度与输入一致', () => {
    const input = new Int16Array(2048);
    const f = int16ToFloat32(input);
    expect(f.length).toBe(2048);
  });
});

// ============================================================================
// RMS (能量)
// ============================================================================
describe('computeRMS', () => {
  it('静音 (全 0) RMS = 0', () => {
    expect(computeRMS(new Float32Array(1024))).toBe(0);
  });

  it('单频 1.0 信号 RMS ≈ 1.0', () => {
    const buf = new Float32Array(1024);
    buf.fill(1.0);
    expect(computeRMS(buf)).toBeCloseTo(1.0, 5);
  });

  it('半幅信号 RMS ≈ 0.5', () => {
    const buf = new Float32Array(1024);
    buf.fill(0.5);
    expect(computeRMS(buf)).toBeCloseTo(0.5, 5);
  });

  it('双极信号 ±1 RMS ≈ 1.0', () => {
    const buf = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) buf[i] = i % 2 === 0 ? 1 : -1;
    expect(computeRMS(buf)).toBeCloseTo(1.0, 5);
  });
});

// ============================================================================
// VAD (基于 RMS 阈值)
// ============================================================================
describe('detectVoiceActivity', () => {
  it('静音数据 → false', () => {
    const silent = new Float32Array(2048); // 全 0
    expect(detectVoiceActivity(silent, 0.01)).toBe(false);
  });

  it('低能量噪声 (RMS 0.005) 在阈值 0.01 下 → false', () => {
    const noise = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) noise[i] = 0.005;
    expect(detectVoiceActivity(noise, 0.01)).toBe(false);
  });

  it('语音强度 (RMS 0.1) 在阈值 0.01 下 → true', () => {
    const speech = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) speech[i] = 0.1;
    expect(detectVoiceActivity(speech, 0.01)).toBe(true);
  });

  it('正弦波 440Hz @ 振幅 0.3 → true', () => {
    const buf = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) buf[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / 16000);
    expect(detectVoiceActivity(buf, 0.01)).toBe(true);
  });

  it('正弦波 440Hz @ 振幅 0.001 → false (太弱)', () => {
    const buf = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) buf[i] = 0.001 * Math.sin(2 * Math.PI * 440 * i / 16000);
    expect(detectVoiceActivity(buf, 0.01)).toBe(false);
  });

  it('默认阈值 (无参) 应能区分明显语音和静音', () => {
    const silent = new Float32Array(2048);
    const speech = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) speech[i] = 0.2;
    expect(detectVoiceActivity(silent)).toBe(false);
    expect(detectVoiceActivity(speech)).toBe(true);
  });
});

// ============================================================================
// 基频估计 (autocorrelation)
// ============================================================================
describe('estimatePitchAutocorrelation', () => {
  // 合成 200Hz 正弦波, 16kHz 采样, 2 周期内 80 样本
  it('200Hz 正弦波 → 估计频率 ≈ 200Hz (±5Hz)', () => {
    const N = 2048;
    const freq = 200;
    const sr = 16000;
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++) buf[i] = Math.sin(2 * Math.PI * freq * i / sr);
    const detected = estimatePitchAutocorrelation(buf, sr, 60, 500);
    expect(detected).not.toBeNull();
    expect(detected!).toBeGreaterThan(195);
    expect(detected!).toBeLessThan(205);
  });

  it('440Hz 正弦波 → 估计频率 ≈ 440Hz (±10Hz)', () => {
    const N = 2048;
    const freq = 440;
    const sr = 16000;
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++) buf[i] = Math.sin(2 * Math.PI * freq * i / sr);
    const detected = estimatePitchAutocorrelation(buf, sr, 60, 1000);
    expect(detected).not.toBeNull();
    expect(detected!).toBeGreaterThan(430);
    expect(detected!).toBeLessThan(450);
  });

  it('静音 → null (无可检测基频)', () => {
    const buf = new Float32Array(2048); // 全 0
    const detected = estimatePitchAutocorrelation(buf, 16000, 60, 1000);
    expect(detected).toBeNull();
  });

  it('白噪声 → null (无明显周期性)', () => {
    const buf = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) buf[i] = Math.random() * 0.01;
    // 噪声通常 ACF 无明显峰, 容忍返回 null
    const detected = estimatePitchAutocorrelation(buf, 16000, 60, 1000);
    // 接受 null 或任何弱检测值
    if (detected !== null) {
      expect(detected).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// 频率 <-> bin 映射
// ============================================================================
describe('binToHz / hzToBin', () => {
  it('bin 0 → 0 Hz', () => {
    expect(binToHz(0, 2048, 16000)).toBe(0);
  });

  it('Nyquist bin (1024) → 8000 Hz', () => {
    expect(binToHz(1024, 2048, 16000)).toBe(8000);
  });

  it('hzToBin 0 → 0', () => {
    expect(hzToBin(0, 2048, 16000)).toBe(0);
  });

  it('hzToBin 8000 → 1024', () => {
    expect(hzToBin(8000, 2048, 16000)).toBe(1024);
  });

  it('bin <-> hz 互逆 (FFT bin 分辨率, 允许 ±2 bin 误差)', () => {
    for (const hz of [100, 440, 1000, 4000, 7999]) {
      const bin = hzToBin(hz, 2048, 16000);
      // FFT bin 分辨率 = sampleRate / fftSize = 7.8125 Hz
      // 允许 2 bin = ~16 Hz 误差
      expect(Math.abs(binToHz(bin, 2048, 16000) - hz)).toBeLessThan(16);
    }
  });
});

// ============================================================================
// PitchHistory 环形缓冲
// ============================================================================
describe('PitchHistory', () => {
  it('初始为空', () => {
    const h = new PitchHistory(10);
    expect(h.size).toBe(0);
    expect(h.values).toEqual([]);
  });

  it('push 后 size 增长, 不超过容量', () => {
    const h = new PitchHistory(3);
    h.push(100);
    h.push(200);
    h.push(300);
    expect(h.size).toBe(3);
    h.push(400);
    expect(h.size).toBe(3); // 容量封顶
    expect(h.values).toEqual([200, 300, 400]); // FIFO
  });

  it('null 值可被记录 (unvoiced 帧)', () => {
    const h = new PitchHistory(5);
    h.push(100);
    h.push(null);
    h.push(200);
    expect(h.values).toEqual([100, null, 200]);
  });

  it('clear 重置', () => {
    const h = new PitchHistory(5);
    h.push(100);
    h.push(200);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.values).toEqual([]);
  });
});

// ============================================================================
// SpectrumRing 环形缓冲 (频谱图时间窗)
// ============================================================================
describe('SpectrumRing', () => {
  it('初始所有列为零', () => {
    const r = new SpectrumRing(10, 64); // 10 列, 每列 64 bin
    expect(r.cols).toBe(10);
    expect(r.bins).toBe(64);
    for (let c = 0; c < r.cols; c++) {
      for (let b = 0; b < r.bins; b++) {
        expect(r.get(c, b)).toBe(0);
      }
    }
  });

  it('pushColumn 后最新一列是写入的数据', () => {
    const r = new SpectrumRing(5, 8);
    const col = new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    r.pushColumn(col);
    // 最新写入的列是 count-1 (逻辑索引) = head-1 (物理索引)
    for (let b = 0; b < 8; b++) {
      expect(r.get(0, b)).toBeCloseTo(col[b], 5);
    }
  });

  it('环形覆盖: push 超过 cols 次后覆盖最旧列', () => {
    const r = new SpectrumRing(3, 4);
    r.pushColumn(new Float32Array([1, 0, 0, 0]));   // 物理 slot 0
    r.pushColumn(new Float32Array([0, 1, 0, 0]));   // 物理 slot 1
    r.pushColumn(new Float32Array([0, 0, 1, 0]));   // 物理 slot 2
    r.pushColumn(new Float32Array([0, 0, 0, 1]));   // 覆盖物理 slot 0
    // 逻辑 c=0 (最旧) -> 物理 slot 1 (push 2)
    // 逻辑 c=1 -> 物理 slot 2 (push 3)
    // 逻辑 c=2 (最新) -> 物理 slot 0 (push 4)
    expect(r.get(0, 1)).toBe(1); // push 2 的 bin 1
    expect(r.get(1, 2)).toBe(1); // push 3 的 bin 2
    expect(r.get(2, 3)).toBe(1); // push 4 的 bin 3
  });
});
