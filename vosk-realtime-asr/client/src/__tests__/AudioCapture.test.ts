/**
 * AudioCaptureEngine 单元测试
 *
 * Mock AudioContext + navigator.mediaDevices.getUserMedia, 验证:
 *   1) onstatechange 注册
 *   2) suspended 时自动 resume
 *   3) sampleRate 不匹配时记下 requiresResampling (不抛错)
 *   4) destroy 关闭 AudioContext
 *   5) profile 配置注入到 getUserMedia constraints
 *   6) 暴露 baseLatency / outputLatency / underrunCount metrics
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioCaptureEngine } from '../AudioCapture';
import { AUDIO_PROFILES } from '../types';

// ----------------------------------------------------------------------------
// Mock: navigator.mediaDevices.getUserMedia
// ----------------------------------------------------------------------------
function setupGetUserMediaMock(opts: { trackStop?: () => void } = {}) {
  const stopFn = opts.trackStop ?? vi.fn();
  const mkTrack = () => ({ stop: stopFn });
  const stream = {
    getTracks: () => [mkTrack()],
    getAudioTracks: () => [mkTrack()],
  } as unknown as MediaStream;

  (globalThis as any).navigator = (globalThis as any).navigator || {};
  (globalThis as any).navigator.mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue(stream),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  };
  return { stream, stopFn };
}

// ----------------------------------------------------------------------------
// Mock: AudioContext (state machine + baseLatency + outputLatency)
// ----------------------------------------------------------------------------
interface MockAudioContextOpts {
  sampleRate?: number;
  initialState?: AudioContextState;
  baseLatency?: number;
  outputLatency?: number;
  resumeShouldFail?: boolean;
}

function setupAudioContextMock(opts: MockAudioContextOpts = {}) {
  const sampleRate = opts.sampleRate ?? 16000;
  const initialState = opts.initialState ?? 'running';
  const baseLatency = opts.baseLatency ?? 0.01;
  const outputLatency = opts.outputLatency ?? 0.02;

  const ctx: any = {
    sampleRate,
    state: initialState,
    baseLatency,
    outputLatency,
    onstatechange: null,
    onerror: null,
    audioWorklet: {
      addModule: vi.fn().mockResolvedValue(undefined),
    },
    createMediaStreamSource: vi.fn().mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    resume: opts.resumeShouldFail
      ? vi.fn().mockRejectedValue(new Error('mock resume failed'))
      : vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  (globalThis as any).AudioContext = vi.fn().mockImplementation(() => ctx);
  (globalThis as any).AudioWorkletNode = vi.fn().mockImplementation(() => ({
    port: {
      onmessage: null,
      postMessage: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  return ctx;
}

describe('AudioCaptureEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupGetUserMediaMock();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers onstatechange handler on the AudioContext', async () => {
    const ctx = setupAudioContextMock();
    const engine = new AudioCaptureEngine();
    await engine.initialize();
    expect(typeof ctx.onstatechange).toBe('function');
  });

  it('registers onerror handler on the AudioContext', async () => {
    const ctx = setupAudioContextMock();
    const engine = new AudioCaptureEngine();
    await engine.initialize();
    expect(typeof ctx.onerror).toBe('function');
  });

  it('auto-resumes when AudioContext state changes to suspended', async () => {
    const ctx = setupAudioContextMock();
    const engine = new AudioCaptureEngine();
    await engine.initialize();
    expect(ctx.resume).not.toHaveBeenCalled(); // 初始不是 suspended, 没调
    // 模拟 state change to suspended
    ctx.state = 'suspended';
    ctx.onstatechange();
    // 应该自动调用 resume
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('emits interrupted event when state changes to interrupted', async () => {
    const ctx = setupAudioContextMock();
    const engine = new AudioCaptureEngine();
    const interruptedHandler = vi.fn();
    engine.on('interrupted', interruptedHandler);
    await engine.initialize();
    ctx.state = 'interrupted';
    ctx.onstatechange();
    expect(interruptedHandler).toHaveBeenCalledTimes(1);
  });

  it('emits error event when onerror fires', async () => {
    const ctx = setupAudioContextMock();
    const engine = new AudioCaptureEngine();
    const errorHandler = vi.fn();
    engine.on('error', errorHandler);
    await engine.initialize();
    // 触发 onerror
    ctx.onerror({ error: { message: 'mock audio ctx error' } });
    expect(errorHandler).toHaveBeenCalledTimes(1);
  });

  it('logs warn + sets requiresResampling when sampleRate mismatches, but does not throw', async () => {
    const ctx = setupAudioContextMock({ sampleRate: 48000 });
    const engine = new AudioCaptureEngine();
    await expect(engine.initialize()).resolves.toBeUndefined();
    expect(engine.getMetrics().requiresResampling).toBe(48000);
  });

  it('requiresResampling=null when sampleRate matches', async () => {
    setupAudioContextMock({ sampleRate: 16000 });
    const engine = new AudioCaptureEngine();
    await engine.initialize();
    expect(engine.getMetrics().requiresResampling).toBeNull();
  });

  it('exposes baseLatency / outputLatency / underrunCount in getMetrics()', async () => {
    const ctx = setupAudioContextMock({
      baseLatency: 0.012,
      outputLatency: 0.025,
    });
    const engine = new AudioCaptureEngine();
    await engine.initialize();
    const m = engine.getMetrics();
    expect(m.baseLatency).toBeCloseTo(0.012, 3);
    expect(m.outputLatency).toBeCloseTo(0.025, 3);
    expect(m.underrunCount).toBe(0);
  });

  it('applies profile constraints to getUserMedia', async () => {
    setupAudioContextMock();
    const getUserMedia = (navigator.mediaDevices as any).getUserMedia as ReturnType<typeof vi.fn>;
    const engine = new AudioCaptureEngine({ profile: 'pure' });
    await engine.initialize();
    const arg = getUserMedia.mock.calls[0][0];
    expect(arg.audio.echoCancellation).toBe(false);
    expect(arg.audio.noiseSuppression).toBe(false);
    expect(arg.audio.autoGainControl).toBe(false);
  });

  it('uses meeting profile by default (NS/AEC/AGC on)', async () => {
    setupAudioContextMock();
    const getUserMedia = (navigator.mediaDevices as any).getUserMedia as ReturnType<typeof vi.fn>;
    const engine = new AudioCaptureEngine();
    await engine.initialize();
    const arg = getUserMedia.mock.calls[0][0];
    expect(arg.audio.echoCancellation).toBe(true);
    expect(arg.audio.noiseSuppression).toBe(true);
    expect(arg.audio.autoGainControl).toBe(true);
  });

  it('throws on start() if not initialized', () => {
    const engine = new AudioCaptureEngine();
    expect(() => engine.start()).toThrow();
  });

  it('destroy() closes AudioContext + stops MediaStream tracks', async () => {
    const ctx = setupAudioContextMock();
    const { stopFn } = setupGetUserMediaMock();
    const engine = new AudioCaptureEngine();
    await engine.initialize();
    engine.destroy();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  it('accepts AUDIO_PROFILES ids', () => {
    expect(AUDIO_PROFILES.pure.id).toBe('pure');
    expect(AUDIO_PROFILES.meeting.id).toBe('meeting');
    expect(AUDIO_PROFILES.pure.constraints.echoCancellation).toBe(false);
    expect(AUDIO_PROFILES.meeting.constraints.echoCancellation).toBe(true);
  });
});
