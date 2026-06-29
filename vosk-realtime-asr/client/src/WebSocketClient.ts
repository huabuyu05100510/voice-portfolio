/**
 * WebSocket 客户端模块 - 使用 Socket.IO
 * 处理与服务端的实时通信
 */

import { io, Socket } from 'socket.io-client';
import { trace, context, propagation, SpanStatusCode } from '@opentelemetry/api';
import { TranscriptionResult, SessionMetrics } from './types';

/** Module B: tracer 名 (otel 可能未初始化, getTracer 安全返回 NoopTracer) */
const TRACER_NAME = 'voice-portfolio-client';
const TRACER_VERSION = '1.0.0';
function getWsTracer() {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

export type WebSocketState = 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';

export interface TtsAudioPayload {
  audio_base64: string;
  format: 'mp3';
  utterance_start?: number;
  speaker_id?: string;
  timestamp?: string;
}

export class WebSocketClient {
  private socket: Socket | null = null;
  private url: string;
  private state: WebSocketState = 'disconnected';

  // 回调函数
  private onConnectedCallback: ((sessionId: string) => void) | null = null;
  private onDisconnectedCallback: (() => void) | null = null;
  private onTranscriptionResultCallback: ((result: TranscriptionResult) => void) | null = null;
  private onSessionStatusCallback: ((metrics: SessionMetrics) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private onMetricsUpdateCallback: ((metrics: any) => void) | null = null;
  private onRecordingReadyCallback: (() => void) | null = null;        // F1
  private onRecordingStoppedCallback: ((data: any) => void) | null = null;  // F7
  // 性能监控: 收到 transcription 时把 (now - 发送时间) 推给消费者 (PerfMonitor)
  private onLatencyRecordedCallback: ((latencyMs: number) => void) | null = null;
  // TTS 音频片段 (服务端合成完一句推送过来)
  private onTtsAudioCallback: ((payload: TtsAudioPayload) => void) | null = null;

  // F1: 门控 Promise — startRecording() 后只有收到 recording_started 才 resolve
  private _recordingReadyResolve: (() => void) | null = null;
  private _recordingReadyPromise: Promise<void> | null = null;

  // sendTimeQueue: FIFO 待回包时间戳 (ms)
  private sendTimeQueue: number[] = [];
  private readonly maxPending = 64;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * 连接服务器
   */
  connect(): void {
    if (this.socket && this.socket.connected) {
      console.log('[WebSocket] Already connected');
      return;
    }

    this.state = 'connecting';

    // Module B: 跨进程 trace 上下文传递 — Socket.IO 走 auth.payload (不走 HTTP header)
    // W3C traceparent 注入到 auth, 服务端 handle_connect 解析后挂在当前 OTel span
    const carrier: Record<string, string> = {};
    try {
      propagation.inject(context.active(), carrier);
    } catch (e) {
      // OTel 未初始化时 propagation.inject 是 no-op, 安全降级
      // eslint-disable-next-line no-console
      console.warn('[WS] traceparent inject skipped:', (e as Error)?.message);
    }
    const traceparent = carrier['traceparent'];
    const auth: Record<string, string> = {};
    if (traceparent) auth.traceparent = traceparent;

    this.socket = io(this.url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      auth,
    });

    this.socket.on('connect', () => {
      console.log('[WebSocket] Connected');
      this.state = 'connected';
    });

    this.socket.on('connected', (data: { session_id: string }) => {
      console.log('[WebSocket] Session created:', data.session_id);
      if (this.onConnectedCallback) {
        this.onConnectedCallback(data.session_id);
      }
    });

    this.socket.on('disconnect', () => {
      console.log('[WebSocket] Disconnected');
      this.state = 'disconnected';
      if (this.onDisconnectedCallback) {
        this.onDisconnectedCallback();
      }
    });

    this.socket.on('connect_error', (error: Error) => {
      console.error('[WebSocket] Connection error:', error.message);
      this.state = 'error';
      if (this.onErrorCallback) {
        this.onErrorCallback(error.message);
      }
    });

    this.socket.on('transcription_result', (data: any) => {
      // 性能监控: 算 (now - 最早未匹配 sendTime) 作为端到端延迟
      if (this.onLatencyRecordedCallback && this.sendTimeQueue.length > 0) {
        const sentAt = this.sendTimeQueue.shift() as number;
        const latency = performance.now() - sentAt;
        this.onLatencyRecordedCallback(latency);
      }
      if (this.onTranscriptionResultCallback) {
        this.onTranscriptionResultCallback({
          text: data.text || '',
          isFinal: data.is_final || false,
          fullText: data.full_text || '',
          latency: data.latency_ms || 0,
          timestamp: data.timestamp || '',
          words: data.words || [],
          // 火山引擎分角色 — 新增透传
          speaker_id: data.speaker_id,
          speakers: data.speakers || [],
          utterances: data.utterances || [],
          // F2: 透传累积模式标记 (undefined 视为 true 兼容老服务端)
          isCumulative: data.is_cumulative,
        });
      }
    });

    this.socket.on('session_status', (data: any) => {
      if (this.onSessionStatusCallback && data.metrics) {
        this.onSessionStatusCallback({
          audioBytes: data.metrics.audio_bytes || 0,
          transcriptionChars: data.metrics.transcription_chars || 0,
          chunksProcessed: data.metrics.chunks_processed || 0,
          avgLatency: data.metrics.avg_latency || 0,
          totalLatencies: data.metrics.latency_count || 0,
          startTime: data.start_time || 0,
        });
      }
    });

    // F1: recording_started 解除门控 → 此时 WSS 握手已完成，可以安全发送音频
    this.socket.on('recording_started', (data: any) => {
      console.log('[WebSocket] Recording started (WSS ready):', data);
      this._recordingReadyResolve?.();
      this._recordingReadyResolve = null;
      this.onRecordingReadyCallback?.();
    });

    // F7: recording_stopped — 录音停止确认（服务端仍可能推送最后的 final）
    this.socket.on('recording_stopped', (data: any) => {
      console.log('[WebSocket] Recording stopped:', data);
      this.onRecordingStoppedCallback?.(data);
    });

    this.socket.on('metrics_update', (data: any) => {
      if (this.onMetricsUpdateCallback) {
        this.onMetricsUpdateCallback(data);
      }
    });

    this.socket.on('error', (data: { message: string }) => {
      console.error('[WebSocket] Server error:', data.message);
      if (this.onErrorCallback) {
        this.onErrorCallback(data.message);
      }
    });

    // TTS 音频: 服务端把合成完的 mp3 (base64) 推过来, TtsPlayer 顺序播放
    this.socket.on('tts_audio', (data: TtsAudioPayload) => {
      if (this.onTtsAudioCallback && data?.audio_base64) {
        this.onTtsAudioCallback(data);
      }
    });
  }

  /** 获取底层 Socket.IO socket 实例 (供 useSimultaneousInterpretation 直接订阅事件) */
  getSocket(): Socket | null {
    return this.socket;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.socket) {
      this.state = 'disconnecting';
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private sendCount = 0;
  /**
   * 发送音频数据
   */
  sendAudio(audioBuffer: ArrayBuffer): void {
    // Module B: 每个 chunk 包成 ws.send_audio span, 服务端会沿 traceparent 关联
    const span = getWsTracer().startSpan('ws.send_audio');
    try {
      span.setAttribute('chunk.bytes', audioBuffer.byteLength);
      const connected = !!(this.socket && this.socket.connected);
      span.setAttribute('ws.connected', connected);
      if (this.socket && connected) {
        // 性能监控: 入队发送时间戳, 等 transcription_result 回来算 delta
        if (this.onLatencyRecordedCallback) {
          this.sendTimeQueue.push(performance.now());
          // 防止断网/服务端不响应时队列无限增长
          if (this.sendTimeQueue.length > this.maxPending) {
            this.sendTimeQueue.shift();
          }
        }
        this.socket.emit('audio_data', audioBuffer);
        this.sendCount++;
        // 每 20 个 chunk 打一次, 避免 console 刷屏
        if (this.sendCount % 20 === 1) {
          // eslint-disable-next-line no-console
          console.log(`[WS] sendAudio 已发 ${this.sendCount} 个 chunk`);
        }
        span.setStatus({ code: SpanStatusCode.OK });
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[WS] sendAudio 被拒: socket 未连接`);
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'socket not connected' });
      }
    } catch (err: any) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message ?? err) });
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * 重置延迟跟踪队列 (切换 session 时调用)
   */
  resetLatencyTracking(): void {
    this.sendTimeQueue.length = 0;
  }

  /**
   * 发送开始录音信号，返回 Promise，resolve 时表示服务端 WSS 握手已完成（F1 修复）
   * options.enable_tts: 是否启用 TTS 朗读 (默认 true)
   */
  startRecording(options?: { enable_tts?: boolean }): Promise<void> {
    if (this.socket && this.socket.connected) {
      // 创建门控 Promise，等 recording_started 事件到来才 resolve
      this._recordingReadyPromise = new Promise<void>((resolve) => {
        this._recordingReadyResolve = resolve;
      });
      this.socket.emit('start_recording', {
        enable_tts: options?.enable_tts ?? true,
      });
      return this._recordingReadyPromise;
    }
    return Promise.reject(new Error('Socket not connected'));
  }

  /**
   * 等待录音就绪门控（已包含在 startRecording 返回值中，额外暴露供外部等待）
   */
  waitForRecordingReady(timeoutMs = 6000): Promise<void> {
    if (!this._recordingReadyPromise) {
      return Promise.reject(new Error('startRecording has not been called'));
    }
    return Promise.race([
      this._recordingReadyPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('recording_started timeout')), timeoutMs)
      ),
    ]);
  }

  /**
   * 发送停止录音信号
   */
  stopRecording(): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('stop_recording');
    }
  }

  /**
   * 请求指标更新
   */
  requestMetrics(): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('get_metrics');
    }
  }

  /**
   * 获取连接状态
   */
  getState(): WebSocketState {
    return this.state;
  }

  /**
   * 设置回调函数
   */
  onConnected(callback: (sessionId: string) => void): void {
    this.onConnectedCallback = callback;
  }

  onDisconnected(callback: () => void): void {
    this.onDisconnectedCallback = callback;
  }

  onTranscriptionResult(callback: (result: TranscriptionResult) => void): void {
    this.onTranscriptionResultCallback = callback;
  }

  onSessionStatus(callback: (metrics: SessionMetrics) => void): void {
    this.onSessionStatusCallback = callback;
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallback = callback;
  }

  onMetricsUpdate(callback: (metrics: any) => void): void {
    this.onMetricsUpdateCallback = callback;
  }

  /**
   * 注册延迟记录回调 (PerfMonitor 用)
   * 每次收到 transcription_result 时, 把 (now - sendTime) 推给 callback
   */
  onLatencyRecorded(callback: (latencyMs: number) => void): void {
    this.onLatencyRecordedCallback = callback;
  }

  /** F1: 当 WSS 握手完成、可以发送音频时触发 */
  onRecordingReady(callback: () => void): void {
    this.onRecordingReadyCallback = callback;
  }

  /** TTS 音频到达回调 (TtsPlayer 注册) */
  onTtsAudio(callback: (payload: TtsAudioPayload) => void): void {
    this.onTtsAudioCallback = callback;
  }

  /** F7: 录音停止确认（服务端仍可能推送最后的 final） */
  onRecordingStopped(callback: (data: any) => void): void {
    this.onRecordingStoppedCallback = callback;
  }
}