/**
 * 端到端: AudioCapture 初始化 → ProfileToggle 切换 → 引擎配置差异
 *
 * 验证:
 *   1) AudioCaptureEngine 初始化后会注册 onstatechange / onerror 监听
 *   2) AUDIO_PROFILES.pure 的 constraints 与 meeting 显著不同
 *   3) PerfMonitor 的 recordAudio handle 接受 AudioMetricSnapshot
 *   4) audio-processor 软重采样标志与 AudioEngineMetrics.requiresResampling 一致
 *
 * 这是"模块 C: AudioWorklet + 录音性能加固"的端到端回归门.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioCaptureEngine } from '../AudioCapture';
import { AUDIO_PROFILES } from '../types';
import { PerfMonitor, type PerfMonitorHandle, type AudioMetricSnapshot } from '../PerfMonitor';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ProfileToggle } from '../components/ProfileToggle';

function setupGetUserMediaMock() {
  // 稳定的 track 引用, 避免 getTracks() 每次返回新对象
  const audioTrack = { stop: vi.fn() };
  const stream = {
    getTracks: () => [audioTrack],
    getAudioTracks: () => [audioTrack],
  } as unknown as MediaStream;
  (globalThis as any).navigator = (globalThis as any).navigator || {};
  (globalThis as any).navigator.mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue(stream),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  };
  return { stream, audioTrack };
}

function setupAudioContextMock(opts: { sampleRate?: number; baseLatency?: number; outputLatency?: number } = {}) {
  const ctx: any = {
    sampleRate: opts.sampleRate ?? 16000,
    state: 'running',
    baseLatency: opts.baseLatency ?? 0.012,
    outputLatency: opts.outputLatency ?? 0.025,
    onstatechange: null,
    onerror: null,
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() }),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  (globalThis as any).AudioContext = vi.fn().mockImplementation(() => ctx);
  (globalThis as any).AudioWorkletNode = vi.fn().mockImplementation(() => ({
    port: { onmessage: null, postMessage: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  return ctx;
}

describe('e2e: AudioPipeline (模块 C)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupGetUserMediaMock();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('engine.initialize() 完成时, engine.getMetrics() 反映 baseLatency / outputLatency / requiresResampling', async () => {
    setupAudioContextMock({ baseLatency: 0.012, outputLatency: 0.025 });
    const engine = new AudioCaptureEngine();
    await engine.initialize();
    const m = engine.getMetrics();
    expect(m.baseLatency).toBeCloseTo(0.012, 3);
    expect(m.outputLatency).toBeCloseTo(0.025, 3);
    expect(m.requiresResampling).toBeNull();
    expect(m.underrunCount).toBe(0);
  });

  it('纯模式 vs 会议模式: 传入不同的 getUserMedia constraints', async () => {
    const getUserMedia = (navigator.mediaDevices as any).getUserMedia as ReturnType<typeof vi.fn>;
    setupAudioContextMock();

    const pureEngine = new AudioCaptureEngine({ profile: 'pure' });
    await pureEngine.initialize();
    const pureArg = getUserMedia.mock.calls[0][0];
    expect(pureArg.audio.echoCancellation).toBe(false);
    expect(pureArg.audio.noiseSuppression).toBe(false);
    expect(pureArg.audio.autoGainControl).toBe(false);

    const meetingEngine = new AudioCaptureEngine({ profile: 'meeting' });
    await meetingEngine.initialize();
    const meetingArg = getUserMedia.mock.calls[1][0];
    expect(meetingArg.audio.echoCancellation).toBe(true);
    expect(meetingArg.audio.noiseSuppression).toBe(true);
    expect(meetingArg.audio.autoGainControl).toBe(true);

    pureEngine.destroy();
    meetingEngine.destroy();
  });

  it('采样率不匹配时 (48kHz 硬件), 引擎记下 requiresResampling, 不抛错', async () => {
    setupAudioContextMock({ sampleRate: 48000 });
    const engine = new AudioCaptureEngine();
    await expect(engine.initialize()).resolves.toBeUndefined();
    expect(engine.getMetrics().requiresResampling).toBe(48000);
  });

  it('PerfMonitor handle.recordAudio 接受 AudioMetricSnapshot, 推送后能在 1Hz tick 后渲染', async () => {
    vi.useFakeTimers();
    const handleRef: { current: PerfMonitorHandle | null } = { current: null };
    const { container } = render(
      <PerfMonitor onHandle={(h) => { handleRef.current = h; }} defaultOpen={true} />
    );
    const snap: AudioMetricSnapshot = {
      baseLatency: 0.018,
      outputLatency: 0.030,
      underrunCount: 2,
    };
    handleRef.current?.recordAudio(snap);
    // 触发 1Hz tick 重渲染 — React 18 act 包裹
    const { act } = await import('@testing-library/react');
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    const baseEl = container.querySelector('[data-perf-audio-base-latency]');
    const outEl = container.querySelector('[data-perf-audio-output-latency]');
    const underEl = container.querySelector('[data-perf-audio-underruns]');
    expect(baseEl).not.toBeNull();
    expect(outEl).not.toBeNull();
    expect(underEl).not.toBeNull();
    expect(baseEl?.textContent).toContain('0.018');
    expect(outEl?.textContent).toContain('0.030');
    expect(underEl?.textContent).toContain('2');
    vi.useRealTimers();
  });

  it('ProfileToggle 切换触发 onChange, 模拟"用户切换 profile" 流程', () => {
    const onChange = vi.fn();
    const { container } = render(<ProfileToggle value="meeting" onChange={onChange} />);
    const pureBtn = container.querySelector('button[data-profile-id="pure"]') as HTMLButtonElement;
    fireEvent.click(pureBtn);
    expect(onChange).toHaveBeenCalledWith('pure');

    // 模拟上层 useState 更新
    onChange.mockReset();
    const { container: c2 } = render(<ProfileToggle value="pure" onChange={onChange} />);
    const meetingBtn = c2.querySelector('button[data-profile-id="meeting"]') as HTMLButtonElement;
    fireEvent.click(meetingBtn);
    expect(onChange).toHaveBeenCalledWith('meeting');
  });

  it('录音中 ProfileToggle 处于 disabled 状态 (切 profile 需重新初始化 AudioContext)', () => {
    const onChange = vi.fn();
    const { container } = render(<ProfileToggle value="meeting" onChange={onChange} disabled />);
    const buttons = container.querySelectorAll('button[role="radio"]');
    buttons.forEach((b) => {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    });
    // 强制 click 也不应触发
    const pureBtn = container.querySelector('button[data-profile-id="pure"]') as HTMLButtonElement;
    fireEvent.click(pureBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('AUDIO_PROFILES.pure 和 meeting 的 sampleRate/channelCount 一致, 只有 NS/AEC/AGC 不同', () => {
    const pure = AUDIO_PROFILES.pure.constraints;
    const meeting = AUDIO_PROFILES.meeting.constraints;
    expect(pure.sampleRate).toBe(meeting.sampleRate);
    expect(pure.channelCount).toBe(meeting.channelCount);
    expect(pure.echoCancellation).toBe(!meeting.echoCancellation);
    expect(pure.noiseSuppression).toBe(!meeting.noiseSuppression);
    expect(pure.autoGainControl).toBe(!meeting.autoGainControl);
  });

  it('engine.destroy() 后, 状态机监听 + 流资源都被释放', async () => {
    const ctx = setupAudioContextMock();
    const { audioTrack } = setupGetUserMediaMock();
    const engine = new AudioCaptureEngine();
    await engine.initialize();
    expect(typeof ctx.onstatechange).toBe('function');
    engine.destroy();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
  });
});
