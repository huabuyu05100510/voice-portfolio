/**
 * TtsPipelineService — per-sid 异步 TTS 调度
 *
 * 职责:
 *  - 每次 ASR final 触发一句 TTS (definite utterance only)
 *  - LRU 去重: 相同源文不重复合成
 *  - 失败/超时静默降级, 不影响 ASR 主链路
 *  - emit `tts_audio` (base64 mp3) 到对应 sid
 *
 * 不做跨句流式合成 (整句合成简单可靠, P1 再优化延迟).
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import { TtsService } from './tts.service';
import { ConfigService } from '../config/config.service';
import { StructuredLogger } from '../logger/logger.service';

interface PendingJob {
  sid: string;
  text: string;
  utteranceStart?: number;
  speakerId?: string;
}

@Injectable()
export class TtsPipelineService implements OnModuleDestroy {
  private server: Server | null = null;
  private readonly perSidQueue = new Map<string, PendingJob[]>();
  private readonly perSidRunning = new Map<string, boolean>();
  private readonly cache = new Map<string, Buffer>(); // normalizedText → audio
  private cacheOrder: string[] = [];

  constructor(
    private readonly tts: TtsService,
    private readonly config: ConfigService,
    private readonly log: StructuredLogger,
  ) {}

  /** gateway 启动后注入 SocketIO server */
  attachServer(server: Server): void {
    this.server = server;
  }

  /** 提交一句待合成 */
  submit(
    sid: string,
    text: string,
    utteranceStart?: number,
    speakerId?: string,
  ): void {
    if (!this.config.ttsUsable) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const key = this.normalize(trimmed);
    // LRU 命中: 直接重放音频 (异步 emit, 不阻塞)
    const cached = this.cache.get(key);
    if (cached) {
      this.emitAudio(sid, cached, utteranceStart, speakerId);
      return;
    }

    const queue = this.perSidQueue.get(sid) ?? [];
    queue.push({ sid, text: trimmed, utteranceStart, speakerId });
    this.perSidQueue.set(sid, queue);
    void this.drain(sid);
  }

  /** session 结束时清理队列 */
  shutdown(sid: string): void {
    this.perSidQueue.delete(sid);
    this.perSidRunning.delete(sid);
  }

  onModuleDestroy(): void {
    this.perSidQueue.clear();
    this.perSidRunning.clear();
  }

  // ------------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------------
  private async drain(sid: string): Promise<void> {
    if (this.perSidRunning.get(sid)) return;
    this.perSidRunning.set(sid, true);
    try {
      while (true) {
        const queue = this.perSidQueue.get(sid);
        if (!queue || queue.length === 0) break;
        const job = queue.shift()!;
        const audio = await this.tts.synthesize(job.text);
        if (!audio) continue;
        // 写 LRU
        const key = this.normalize(job.text);
        if (!this.cache.has(key)) {
          this.cache.set(key, audio.audio);
          this.cacheOrder.push(key);
          while (this.cacheOrder.length > this.config.ttsCacheSize) {
            const oldest = this.cacheOrder.shift();
            if (oldest) this.cache.delete(oldest);
          }
        }
        this.emitAudio(sid, audio.audio, job.utteranceStart, job.speakerId);
      }
    } finally {
      this.perSidRunning.set(sid, false);
    }
  }

  private emitAudio(
    sid: string,
    audio: Buffer,
    utteranceStart?: number,
    speakerId?: string,
  ): void {
    if (!this.server) return;
    this.server.to(sid).emit('tts_audio', {
      audio_base64: audio.toString('base64'),
      format: 'mp3',
      utterance_start: utteranceStart,
      speaker_id: speakerId,
      timestamp: new Date().toISOString(),
    });
  }

  private normalize(s: string): string {
    return s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  }
}
