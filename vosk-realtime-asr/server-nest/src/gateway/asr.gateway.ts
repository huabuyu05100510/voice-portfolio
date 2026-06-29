/**
 * AsrGateway — SocketIO 服务端入口
 * 对照 server/app.py 的 SocketIO handlers + emit 范式
 *
 * 事件 (入站):
 *   - start_recording    { enable_tts?: boolean }
 *   - audio_data         ArrayBuffer | Buffer (PCM)
 *   - stop_recording
 *   - get_metrics
 *
 * 事件 (出站):
 *   - connected, recording_started, recording_stopped
 *   - transcription_result (partial/final)
 *   - session_status, metrics_update, tts_audio, error
 */
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AsrSessionFactory } from '../asr/asr-session.factory';
import { SessionManager, ClientSession } from '../asr/session-manager.service';
import { StructuredLogger } from '../logger/logger.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  smartAppend,
  getLastSpeaker,
  extractTextFromUtterances,
} from '../asr/text-buffer';
import { TtsPipelineService } from '../tts/tts-pipeline.service';

const METRICS_EMIT_INTERVAL_MS = 2000;

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1024 * 1024,
})
export class AsrGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger('AsrGateway');

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessionFactory: AsrSessionFactory,
    private readonly sessionManager: SessionManager,
    private readonly log: StructuredLogger,
    private readonly metrics: MetricsService,
    private readonly ttsPipeline: TtsPipelineService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    this.sessionManager.create(client.id);
    this.metrics.connectionsTotal.labels({ client_type: 'web' }).inc();
    this.metrics.connectionsActive.inc();
    client.emit('connected', {
      session_id: client.id,
      timestamp: new Date().toISOString(),
    });
    this.log.info('client connected', {
      session_id: client.id,
      event_type: 'connection',
    });
  }

  handleDisconnect(client: Socket): void {
    this.endSession(client.id);
    this.metrics.connectionsActive.dec();
    this.log.info('client disconnected', {
      session_id: client.id,
      event_type: 'disconnection',
    });
  }

  // ------------------------------------------------------------------------
  // start_recording
  // ------------------------------------------------------------------------
  @SubscribeMessage('start_recording')
  async onStartRecording(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { enable_tts?: boolean } | null,
  ): Promise<void> {
    const sid = client.id;
    const session = this.sessionManager.getOrThrow(sid);
    if (session.volcSession) {
      client.emit('error', { message: 'Already recording' });
      return;
    }

    session.enableTts = body?.enable_tts ?? true;

    const volc = this.sessionFactory.create(sid, {
      onPartial: (text, cbSid) => this.onPartial(cbSid, text),
      onFinal: (text, utts, spks, latency, cbSid) =>
        this.onFinal(cbSid, text, utts, spks, latency),
      onError: (code, message, cbSid) =>
        this.onError(cbSid, code, message),
    });
    session.volcSession = volc;
    volc.start();

    const ready = await volc.waitUntilReady(5000);
    if (!ready) {
      client.emit('error', { message: 'ASR handshake timeout' });
      this.endSession(sid);
      return;
    }

    session.status = 'recording';
    client.emit('recording_started', {
      session_id: sid,
      timestamp: new Date().toISOString(),
    });
    this.log.info('recording started', {
      session_id: sid,
      event_type: 'recording_started',
      metadata: { enable_tts: session.enableTts },
    });
  }

  // ------------------------------------------------------------------------
  // audio_data
  // ------------------------------------------------------------------------
  @SubscribeMessage('audio_data')
  onAudioData(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ArrayBuffer | Buffer,
  ): void {
    const sid = client.id;
    const session = this.sessionManager.get(sid);
    if (!session?.volcSession) return;
    // 仅在 recording | transcribing 期间接收 (F1+F7 修复)
    if (session.status !== 'recording' && session.status !== 'transcribing') {
      return;
    }
    const buf = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data as ArrayBuffer);
    if (buf.length === 0) return;

    session.volcSession.sendAudio(buf);
    session.metrics.audioBytes += buf.length;
    session.metrics.chunksProcessed += 1;
    this.metrics.audioBytesTotal.inc(buf.length);

    // 节流 session_status 推送
    const now = Date.now();
    if (now - session.lastMetricsEmitAt >= METRICS_EMIT_INTERVAL_MS) {
      session.lastMetricsEmitAt = now;
      this.emitSessionStatus(client, session);
    }
  }

  // ------------------------------------------------------------------------
  // stop_recording
  // ------------------------------------------------------------------------
  @SubscribeMessage('stop_recording')
  onStopRecording(@ConnectedSocket() client: Socket): void {
    const sid = client.id;
    const session = this.sessionManager.get(sid);
    if (!session?.volcSession) {
      client.emit('error', { message: 'Not recording' });
      return;
    }
    session.volcSession.finalize();
    // F7: 不立即 completed, 保持 transcribing 等最后一句 final
    session.status = 'transcribing';
    client.emit('recording_stopped', {
      session_id: sid,
      timestamp: new Date().toISOString(),
    });
    this.log.info('recording stopped (transcribing tail)', {
      session_id: sid,
      event_type: 'recording_stopped',
    });

    // 1.5s grace window, 之后才 completed
    setTimeout(() => {
      const s = this.sessionManager.get(sid);
      if (!s) return;
      if (s.status === 'transcribing') {
        s.status = 'completed';
        this.endSession(sid);
      }
    }, 1500);
  }

  @SubscribeMessage('get_metrics')
  onGetMetrics(@ConnectedSocket() client: Socket): void {
    const sid = client.id;
    const session = this.sessionManager.get(sid);
    if (!session) {
      client.emit('error', { message: 'Session not found' });
      return;
    }
    this.emitMetricsUpdate(client, session);
  }

  // ------------------------------------------------------------------------
  // ASR 回调 (在 volc 读线程/事件回调里)
  // ------------------------------------------------------------------------
  private onPartial(sid: string, text: string): void {
    const session = this.sessionManager.get(sid);
    if (!session) return;
    this.metrics.transcriptionResultsTotal.labels({ is_final: 'false' }).inc();
    this.server?.to(sid).emit('transcription_result', {
      text,
      is_final: false,
      speaker_id: session.lastKnownSpeakerId,
      timestamp: new Date().toISOString(),
    });
  }

  private onFinal(
    sid: string,
    text: string,
    utterances: any[],
    speakers: any[],
    latencyMs: number,
  ): void {
    const session = this.sessionManager.get(sid);
    if (!session) return;

    this.metrics.transcriptionResultsTotal.labels({ is_final: 'true' }).inc();
    this.metrics.transcriptionCharsTotal.labels({ language: 'zh' }).inc(text.length);
    if (latencyMs > 0) {
      this.metrics.transcriptionLatency.observe(latencyMs);
      session.metrics.latencies.push(latencyMs);
    }

    // 文本累积 (优先 utterances 拼接, 多说话人更可靠)
    const uttText = extractTextFromUtterances(utterances);
    const mergeText = uttText || text;
    const { buffer: newBuf } = smartAppend(session.textBuffer, mergeText);
    session.textBuffer = newBuf;

    // 说话人池 (按 session 首次出现顺序编号, 不信服务端 label)
    for (const u of utterances) {
      const spkId = u.speaker_id;
      if (spkId) this.sessionManager.upsertSpeaker(sid, spkId);
    }

    const lastSpk = getLastSpeaker(utterances);
    if (lastSpk) {
      session.currentSpeakerId = lastSpk;
      session.lastKnownSpeakerId = lastSpk;
    }
    const resolved = lastSpk ?? session.lastKnownSpeakerId ?? null;

    const payload = {
      text,
      is_final: true,
      is_cumulative: true,
      full_text: session.textBuffer.trim(),
      latency_ms: Math.round(latencyMs ?? 0),
      speaker_id: resolved,
      speakers: Array.from(session.speakersSeen.values()),
      utterances,
      timestamp: new Date().toISOString(),
    };
    this.server?.to(sid).emit('transcription_result', payload);

    this.log.info('Transcription final', {
      session_id: sid,
      event_type: 'transcription_final',
      metadata: {
        text_length: text.length,
        utterance_count: utterances.length,
        speaker_id: resolved,
        is_unknown_speaker: resolved === null,
        speaker_count: session.speakersSeen.size,
        latency_ms: Math.round(latencyMs ?? 0),
      },
    });

    // 触发 TTS (如果开启)
    if (session.enableTts) {
      for (const u of utterances) {
        const t = (u.text ?? '').trim();
        if (t && u.definite) {
          this.ttsPipeline.submit(sid, t, u.start_time ?? undefined, u.speaker_id ?? undefined);
        }
      }
    }
  }

  private onError(sid: string, code: number, message: string): void {
    this.log.error('ASR error', {
      session_id: sid,
      event_type: 'asr_error',
      metadata: { code, message: String(message).slice(0, 200) },
    });
    this.server?.to(sid).emit('error', {
      code,
      message: String(message).slice(0, 200),
    });
  }

  // ------------------------------------------------------------------------
  // 工具
  // ------------------------------------------------------------------------
  private emitSessionStatus(client: Socket, session: ClientSession): void {
    const latencies = session.metrics.latencies;
    const avgLatency =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;
    // 注意: 客户端 WebSocketClient 期望 data.metrics.{field}, 这里包一层
    client.emit('session_status', {
      status: session.status,
      metrics: {
        audio_bytes: session.metrics.audioBytes,
        transcription_chars: session.metrics.transcriptionChars,
        chunks_processed: session.metrics.chunksProcessed,
        avg_latency: Math.round(avgLatency),
        latencies_count: latencies.length,
      },
      speaker_count: session.speakersSeen.size,
    });
  }

  private emitMetricsUpdate(client: Socket, session: ClientSession): void {
    const latencies = session.metrics.latencies;
    const avgLatency =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;
    client.emit('metrics_update', {
      metrics: {
        audio_bytes: session.metrics.audioBytes,
        transcription_chars: session.metrics.transcriptionChars,
        chunks_processed: session.metrics.chunksProcessed,
        avg_latency: Math.round(avgLatency),
        speaker_count: session.speakersSeen.size,
        session_duration: Math.round((Date.now() - session.startTime) / 1000),
      },
    });
  }

  private endSession(sid: string): void {
    const session = this.sessionManager.delete(sid);
    if (!session) return;
    try {
      session.volcSession?.close();
    } catch {
      // ignore
    }
    this.ttsPipeline.shutdown(sid);
  }
}
