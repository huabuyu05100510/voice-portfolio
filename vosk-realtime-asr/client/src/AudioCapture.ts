/**
 * 音频采集模块
 * 使用 Web Audio API + AudioWorklet 实现低延迟音频采集
 *
 * Sprint 7 性能优化:
 *   - audioWorkletPromise 单例缓存, 避免同 session 重复 addModule
 *   - AudioContext 复用 (per-engine-instance, 但 promise cache 跨实例)
 */

let audioWorkletPromiseCache: Promise<void> | null = null;

/**
 * 缓存 AudioWorklet 模块加载承诺
 * 每个 AudioContext 只能 addModule 一次, 但多 engine 共享缓存可以省一次 200KB 下载
 */
function loadAudioWorkletCached(ctx: AudioContext): Promise<void> {
  if (audioWorkletPromiseCache) return audioWorkletPromiseCache;
  audioWorkletPromiseCache = ctx.audioWorklet.addModule('/audio-processor.js');
  // 加载失败时清空缓存, 允许下次重试
  audioWorkletPromiseCache.catch(() => { audioWorkletPromiseCache = null; });
  return audioWorkletPromiseCache;
}

export class AudioCaptureEngine {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private isRecording: boolean = false;
  private onAudioDataCallback: ((data: Int16Array) => void) | null = null;

  // 音频配置
  private static readonly CONFIG = {
    sampleRate: 16000,        // Vosk 要求 16kHz
    channelCount: 1,          // 单声道
    latencyHint: 'interactive' as AudioContextLatencyCategory, // 最小延迟
    bufferSize: 2048,         // AudioWorklet 缓冲区大小
  };

  /**
   * 初始化音频采集引擎
   */
  async initialize(): Promise<void> {
    // 1. 获取麦克风权限
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: AudioCaptureEngine.CONFIG.sampleRate,
        channelCount: AudioCaptureEngine.CONFIG.channelCount,
        echoCancellation: true,   // 回声消除
        noiseSuppression: true,   // 降噪
        autoGainControl: true,    // 自动增益
      },
    });

    // 2. 创建 AudioContext
    this.audioContext = new AudioContext({
      sampleRate: AudioCaptureEngine.CONFIG.sampleRate,
      latencyHint: AudioCaptureEngine.CONFIG.latencyHint,
    });

    // 等待 AudioContext 恢复（某些浏览器需要）
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // 3. 加载 AudioWorklet 处理器 (Sprint 7: 缓存承诺, 避免重复 addModule)
    await loadAudioWorkletCached(this.audioContext);

    // 4. 创建 AudioWorkletNode
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      'audio-processor',
      {
        processorOptions: {
          bufferSize: AudioCaptureEngine.CONFIG.bufferSize,
        },
      }
    );

    // 5. 创建源节点并连接
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.sourceNode.connect(this.workletNode);

    // 6. 设置消息回调
    this.workletNode.port.onmessage = (event) => {
      if (this.isRecording && this.onAudioDataCallback) {
        const audioData = new Int16Array(event.data);
        this.onAudioDataCallback(audioData);
      }
    };

    console.log('[AudioCapture] Initialized successfully');
    console.log(`[AudioCapture] Sample rate: ${this.audioContext.sampleRate}`);
    console.log(`[AudioCapture] Base latency: ${this.audioContext.baseLatency}`);
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

    console.log('[AudioCapture] Recording started');
  }

  /**
   * 停止录音
   */
  stop(): void {
    this.isRecording = false;

    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stop' });
    }

    console.log('[AudioCapture] Recording stopped');
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

    console.log('[AudioCapture] Destroyed');
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