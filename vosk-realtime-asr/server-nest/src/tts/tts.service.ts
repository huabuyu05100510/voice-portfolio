/**
 * TtsService — 火山引擎 V3 TTS WebSocket 双向流式客户端 (doc 1329505)
 *
 * 端点: wss://openspeech.bytedance.com/api/v3/tts/bidirection
 * 鉴权: X-Api-App-Key + X-Api-Key (新版控制台) + X-Api-Resource-Id
 *
 * 单次 synthesize() 流程:
 *   1. WebSocket 连接 (X-Api-* headers)
 *   2. START_CONNECTION → 等 CONNECTION_STARTED
 *   3. START_SESSION(speaker) → 等 SESSION_STARTED
 *   4. TASK_REQUEST(text) + FINISH_SESSION
 *   5. 收集 TTS_RESPONSE 音频字节直到 SESSION_FINISHED
 *   6. 超时 / SESSION_FAILED / ws error → 返回 null (上层降级)
 *
 * 保留旧 HTTP V1 的 synthesize() 签名以便上层无感切换.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { ConfigService } from '../config/config.service';
import { MetricsService } from '../metrics/metrics.service';
import { StructuredLogger } from '../logger/logger.service';
import {
  V3_TTS_EVENT,
  encodeFrameNoSession,
  encodeFrameWithSession,
  parseFrame,
  buildV3WsHeaders,
} from './tts-v3-protocol';

export interface SynthesizeResult {
  audio: Buffer;
  format: 'mp3';
  latencyMs: number;
}

// 测试钩子: 允许注入 mock WebSocket 构造器
export type WebSocketFactory = (url: string, opts: { headers: Record<string, string> }) => WebSocket;

const defaultWsFactory: WebSocketFactory = (url, opts) => new WebSocket(url, opts);

@Injectable()
export class TtsService {
  private readonly wsFactory: WebSocketFactory;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly log: StructuredLogger,
    wsFactory?: WebSocketFactory,
  ) {
    this.wsFactory = wsFactory ?? defaultWsFactory;
  }

  async synthesize(
    text: string,
    opts: { speaker?: string } = {},
  ): Promise<SynthesizeResult | null> {
    if (!this.config.ttsUsable) return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const speaker = opts.speaker ?? this.config.ttsSpeaker;
    const endpoint = this.config.ttsEndpoint;
    const resourceId = this.config.ttsResourceId;

    const startedAt = Date.now();
    const connectId = randomUUID();
    const sessionId = randomUUID();
    const headers = buildV3WsHeaders({
      appKey: this.config.volcAppKey,
      accessKey: this.config.ttsApiKey,
      resourceId,
      connectId,
    });

    try {
      const audio = await this.runSession(endpoint, headers, sessionId, speaker, trimmed);
      const latencyMs = Date.now() - startedAt;
      this.metrics.ttsLatency.observe(latencyMs);

      if (audio.length === 0) {
        throw new Error('tts produced 0 audio bytes');
      }
      this.metrics.ttsRequestsTotal.labels({ status: 'ok' }).inc();
      this.metrics.ttsAudioBytesTotal.inc(audio.length);
      this.log.info('TTS synthesized', {
        event_type: 'tts_result',
        metadata: {
          chars: trimmed.length,
          audio_bytes: audio.length,
          latency_ms: latencyMs,
          speaker,
        },
      });
      return { audio, format: 'mp3', latencyMs };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const isTimeout = /timeout/i.test(msg);
      this.metrics.ttsRequestsTotal
        .labels({ status: isTimeout ? 'timeout' : 'error' })
        .inc();
      this.log.warn('TTS failed', {
        event_type: 'tts_failed',
        metadata: {
          chars: trimmed.length,
          error: msg.slice(0, 200),
          is_timeout: isTimeout,
        },
      });
      return null;
    }
  }

  private runSession(
    endpoint: string,
    headers: Record<string, string>,
    sessionId: string,
    speaker: string,
    text: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* noop */ }
        reject(new Error(`timeout ${this.config.ttsTimeoutMs}ms`));
      }, this.config.ttsTimeoutMs);

      const ws = this.wsFactory(endpoint, { headers });

      const finish = (err: Error | null, audio?: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch { /* noop */ }
        if (err) reject(err);
        else resolve(audio ?? Buffer.concat(chunks));
      };

      ws.on('open', () => {
        ws.send(encodeFrameNoSession(V3_TTS_EVENT.START_CONNECTION, {}));
      });

      ws.on('message', (data: Buffer) => {
        let frame;
        try {
          frame = parseFrame(data);
        } catch (e) {
          finish(e as Error);
          return;
        }
        switch (frame.event) {
          case V3_TTS_EVENT.CONNECTION_STARTED:
            ws.send(
              encodeFrameWithSession(V3_TTS_EVENT.START_SESSION, sessionId, {
                event: V3_TTS_EVENT.START_SESSION,
                req_params: {
                  speaker,
                  audio_params: { format: 'mp3', sample_rate: 24000 },
                },
              }),
            );
            break;
          case V3_TTS_EVENT.SESSION_STARTED:
            ws.send(
              encodeFrameWithSession(V3_TTS_EVENT.TASK_REQUEST, sessionId, {
                event: V3_TTS_EVENT.TASK_REQUEST,
                req_params: { text },
              }),
            );
            ws.send(
              encodeFrameWithSession(V3_TTS_EVENT.FINISH_SESSION, sessionId, {
                event: V3_TTS_EVENT.FINISH_SESSION,
              }),
            );
            break;
          case V3_TTS_EVENT.TTS_RESPONSE:
            chunks.push(frame.payload);
            break;
          case V3_TTS_EVENT.SESSION_FINISHED:
            finish(null, Buffer.concat(chunks));
            break;
          case V3_TTS_EVENT.CONNECTION_FAILED:
          case V3_TTS_EVENT.SESSION_FAILED:
            finish(
              new Error(
                `volc v3 tts event=${frame.event} payload=${JSON.stringify(frame.payloadJson).slice(0, 200)}`,
              ),
            );
            break;
          default:
            // sentence_start / sentence_end 等忽略
            break;
        }
      });

      ws.on('error', (e) => finish(e));
    });
  }
}
