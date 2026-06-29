/**
 * 音频采集模块 (模块 C 加固)
 * 使用 Web Audio API + AudioWorklet 实现低延迟音频采集
 *
 * Sprint 7 性能优化:
 *   - audioWorkletPromise 单例缓存, 避免同 session 重复 addModule
 *
 * 模块 C 加固 (2026-06-27):
 *   - onstatechange / onerror 监听: 自动 resume / 错误上报
 *   - sampleRate 校验: mismatch 时启用 worklet 软重采样
 *   - profile 配置: pure / meeting 切换 getUserMedia constraints
 *   - getMetrics(): 暴露 baseLatency / outputLatency / underrunCount 给 PerfMonitor
 *
 * 模型: MiniMax-M3
 */
import { AUDIO_PROFILES, type AudioProfileId, type AudioEngineMetrics } from './types';

/**
 * 缓存 AudioWorklet 模块加载承诺 — 按 AudioContext 实例隔离
 * 每个 AudioContext 独立调用 addModule (不能跨实例共享注册).
 * WeakMap 在 AudioContext 被 GC 时自动释放, 不泄漏.
 */
const audioWorkletCacheMap = new WeakMap<BaseAudioContext, Promise<void>>();

function loadAudioWorkletCached(ctx: AudioContext): Promise<void> {
  const existing = audioWorkletCacheMap.get(ctx);
  if (existing) return existing;
  const p = ctx.audioWorklet.addModule('/audio-processor.js');
  audioWorkletCacheMap.set(ctx, p);
  p.catch(() => audioWorkletCacheMap.delete(ctx));
  return p;
}

export interface AudioCaptureOptions {
  /** 音频 profile: pure (关 NS/AEC/AGC) / meeting (开 NS/AEC/AGC), 默认 meeting */
  profile?: AudioProfileId;
  /** 启用 OTel 风格 logger (模块 B 后续注入), 这里只用 console */
  logger?: {
    log: (event: string, data?: any) => void;
    warn: (event: string, data?: any) => void;
    error: (event: string, data?: any) => void;
  };
}

type EngineEvent = 'interrupted' | 'error';
type EngineListener = (data: any) => void;

export class AudioCaptureEngine {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private isRecording: boolean = false;
  private onAudioDataCallback: ((data: Int16Array) => void) | null = null;

  // 模块 C 新增: 引擎运行时状态
  private requiresResampling: number | null = null;
  private underrunCount: number = 0;
  private listeners: Map<EngineEvent, Set<EngineListener>> = new Map();

  // 音频配置
  private static readonly CONFIG = {
    sampleRate: 16000,        // Vosk 要求 16kHz
    channelCount: 1,          // 单声道
    latencyHint: 'interactive' as AudioContextLatencyCategory, // 最小延迟
    bufferSize: 2048,         // AudioWorklet 缓冲区大小
  };

  private options: Required<Omit<AudioCaptureOptions, 'logger'>> & { logger: NonNullable<AudioCaptureOptions['logger']> };

  constructor(options: AudioCaptureOptions = {}) {
    const profile = options.profile ?? 'meeting';
    this.options = {
      profile,
      logger: options.logger ?? {
        log: (event, data) => console.log(`[AudioCapture] ${event}`, data ?? ''),
        warn: (event, data) => console.warn(`[AudioCapture] ${event}`, data ?? ''),
        error: (event, data) => console.error(`[AudioCapture] ${event}`, data ?? ''),
      },
    };
  }

  // --------------------------------------------------------------------------
  // 事件 API
  // --------------------------------------------------------------------------
  on(event: EngineEvent, listener: EngineListener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  off(event: EngineEvent, listener: EngineListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: EngineEvent, data?: any): void {
    this.listeners.get(event)?.forEach((l) => {
      try { l(data); } catch (e) {
        this.options.logger.error('listener.error', String(e));
      }
    });
  }

  // --------------------------------------------------------------------------
  // 初始化
  // --------------------------------------------------------------------------
  async initialize(): Promise<void> {
    const profile = AUDIO_PROFILES[this.options.profile];

    // 1. 获取麦克风权限 (按 profile 注入 constraints)
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: profile.constraints,
    });

    // 2. 创建 AudioContext
    this.audioContext = new AudioContext({
      sampleRate: AudioCaptureEngine.CONFIG.sampleRate,
      latencyHint: AudioCaptureEngine.CONFIG.latencyHint,
    });

    // 3. 监听 state / error
    this.setupContextHandlers();

    // 等待 AudioContext 恢复（某些浏览器需要）
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // 4. 采样率兜底校验
    const actual = this.audioContext.sampleRate;
    if (actual !== AudioCaptureEngine.CONFIG.sampleRate) {
      this.options.logger.warn('audio.sampleRate.mismatch', {
        expected: AudioCaptureEngine.CONFIG.sampleRate,
        actual,
      });
      this.requiresResampling = actual;
    } else {
      this.requiresResampling = null;
    }

    // 5. 加载 AudioWorklet 处理器
    await loadAudioWorkletCached(this.audioContext);

    // 6. 创建 AudioWorkletNode
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      'audio-processor',
      {
        processorOptions: {
          bufferSize: AudioCaptureEngine.CONFIG.bufferSize,
        },
      }
    );

    // 7. 创建源节点并连接
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.sourceNode.connect(this.workletNode);

    // 8. 设置消息回调 — 新协议: { type: 'audio', pcm, underrunCount, needsResampling }
    this.workletNode.port.onmessage = (event) => {
      const data = event.data;
      // 旧协议 (直接传 ArrayBuffer) 兼容路径
      if (data instanceof ArrayBuffer) {
        if (this.isRecording && this.onAudioDataCallback) {
          this.onAudioDataCallback(new Int16Array(data));
        }
        return;
      }
      // 新协议
      if (data && data.type === 'audio' && data.pcm) {
        if (typeof data.underrunCount === 'number') {
          this.underrunCount = data.underrunCount;
        }
        if (this.isRecording && this.onAudioDataCallback) {
          this.onAudioDataCallback(new Int16Array(data.pcm));
        }
      }
    };

    this.options.logger.log('audio.initialized', {
      profile: this.options.profile,
      sampleRate: this.audioContext.sampleRate,
      baseLatency: this.audioContext.baseLatency,
      outputLatency: (this.audioContext as any).outputLatency ?? 0,
      requiresResampling: this.requiresResampling,
    });
  }

  /**
   * AudioContext 状态机 / 错误监听
   * - suspended: 自动 resume (Chrome 后台 tab)
   * - interrupted: emit 'interrupted' (Safari 移动端)
   * - onerror: emit 'error' 并 log
   */
  private setupContextHandlers(): void {
    if (!this.audioContext) return;
    const ctx = this.audioContext;
    ctx.onstatechange = () => {
      this.options.logger.log('audio.context.state', ctx.state);
      if (ctx.state === 'suspended') {
        ctx.resume().catch((e) => {
          this.options.logger.error('audio.context.resume.failed', String(e));
        });
      } else if (ctx.state === 'interrupted') {
        this.emit('interrupted');
      } else if (ctx.state === 'running') {
        this.options.logger.log('audio.context.running');
      }
    };
    ctx.onerror = (e: any) => {
      const msg = e?.error?.message ?? String(e);
      this.options.logger.error('audio.context.error', msg);
      this.emit('error', new Error(msg));
    };
  }

  /**
   * 开始录音
   */
  start(): void {
    if (!this.audioContext || !this.workletNode) {
      throw new Error('AudioCapture not initialized');
    }

    this.isRecording = true;

    // 发送开始信号到 Worklet
    this.workletNode.port.postMessage({ type: 'start' });

    this.options.logger.log('audio.recording.started');
  }

  /**
   * 停止录音
   */
  stop(): void {
    this.isRecording = false;

    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stop' });
    }

    this.options.logger.log('audio.recording.stopped', { underrunCount: this.underrunCount });
  }

  /**
   * 设置音频数据回调
   */
  onAudioData(callback: (data: Int16Array) => void): void {
    this.onAudioDataCallback = callback;
  }

  /**
   * 销毁资源
   */
  destroy(): void {
    this.stop();

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    this.onAudioDataCallback = null;
    this.listeners.clear();
    this.requiresResampling = null;
    this.underrunCount = 0;

    this.options.logger.log('audio.destroyed');
  }

  /**
   * 获取音频输入设备列表
   */
  static async getInputDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput');
  }

  /**
   * 获取内部 MediaStream (供 Visualizer 等共用)
   */
  getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  /**
   * 获取引擎运行时指标 — 给 PerfMonitor audio.* 指标源
   */
  getMetrics(): AudioEngineMetrics {
    return {
      baseLatency: this.audioContext?.baseLatency ?? 0,
      outputLatency: (this.audioContext as any)?.outputLatency ?? 0,
      underrunCount: this.underrunCount,
      requiresResampling: this.requiresResampling,
    };
  }

  /**
   * 检查麦克风权限状态
   */
  static async checkPermission(): Promise<PermissionState> {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return result.state;
    } catch {
      // 某些浏览器不支持
      return 'prompt';
    }
  }
}
