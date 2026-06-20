/**
 * WebSocket 客户端模块 - 使用 Socket.IO
 * 处理与服务端的实时通信
 */

import { io, Socket } from 'socket.io-client';
import { TranscriptionResult, SessionMetrics } from './types';

export type WebSocketState = 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';

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
  // 性能监控: 收到 transcription 时把 (now - 发送时间) 推给消费者 (PerfMonitor)
  private onLatencyRecordedCallback: ((latencyMs: number) => void) | null = null;

  // sendTimeQueue: FIFO 待回包时间戳 (ms)
  // 收到一个 transcription_result 就从队首取一个时间, 算差值
  // 这是近似匹配: 一个 result 通常对应 0..N 个 chunk, 但 Vosk 端经常把多个 chunk 合并
  // 因此用"最早未匹配的发送时间"作代表 — 在流式低延迟场景下误差 < 一个 chunk 时长
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

    this.socket = io(this.url, {
      transports: ['polling', 'websocket'],  // polling优先，再升级websocket
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
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
          totalLatencies: 0,
          startTime: Date.now(),
        });
      }
    });

    this.socket.on('recording_started', (data: any) => {
      console.log('[WebSocket] Recording started:', data);
    });

    this.socket.on('recording_stopped', (data: any) => {
      console.log('[WebSocket] Recording stopped:', data);
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
    if (this.socket && this.socket.connected) {
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
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[WS] sendAudio 被拒: socket 未连接`);
    }
  }

  /**
   * 重置延迟跟踪队列 (切换 session 时调用)
   */
  resetLatencyTracking(): void {
    this.sendTimeQueue.length = 0;
  }

  /**
   * 发送开始录音信号
   */
  startRecording(): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('start_recording');
    }
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
}