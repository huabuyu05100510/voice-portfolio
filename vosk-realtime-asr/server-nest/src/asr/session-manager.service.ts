/**
 * SessionManager — per-sid 状态容器
 * 对照 server/app.py 里的 sessions dict + create_session/end_session
 */
import { Injectable } from '@nestjs/common';
import { VolcengineAsrSession } from './asr-session.class';
import { ExtractedSpeaker, ExtractedUtterance } from '../volcengine-proto/extract';

export interface ClientSession {
  id: string;
  startTime: number;
  status: 'idle' | 'recording' | 'transcribing' | 'completed' | 'error';
  volcSession: VolcengineAsrSession | null;

  // 文本累积
  textBuffer: string;
  speakersSeen: Map<string, { id: string; label: string }>;
  currentSpeakerId: string | null;
  lastKnownSpeakerId: string | null;

  // 客户端开关
  enableTts: boolean;

  // metrics
  metrics: {
    audioBytes: number;
    transcriptionChars: number;
    chunksProcessed: number;
    latencies: number[];
    speakerCount: number;
  };

  lastMetricsEmitAt: number;
}

@Injectable()
export class SessionManager {
  private readonly sessions = new Map<string, ClientSession>();

  create(sid: string): ClientSession {
    const s: ClientSession = {
      id: sid,
      startTime: Date.now(),
      status: 'idle',
      volcSession: null,
      textBuffer: '',
      speakersSeen: new Map(),
      currentSpeakerId: null,
      lastKnownSpeakerId: null,
      enableTts: false,
      metrics: {
        audioBytes: 0,
        transcriptionChars: 0,
        chunksProcessed: 0,
        latencies: [],
        speakerCount: 0,
      },
      lastMetricsEmitAt: 0,
    };
    this.sessions.set(sid, s);
    return s;
  }

  get(sid: string): ClientSession | undefined {
    return this.sessions.get(sid);
  }

  getOrThrow(sid: string): ClientSession {
    const s = this.sessions.get(sid);
    if (!s) throw new Error(`session not found: ${sid}`);
    return s;
  }

  delete(sid: string): ClientSession | undefined {
    const s = this.sessions.get(sid);
    this.sessions.delete(sid);
    return s;
  }

  size(): number {
    return this.sessions.size;
  }

  /** 说话人池更新 — 仅在首次见到该 id 时插入 (label 按 session 顺序编号) */
  upsertSpeaker(sid: string, spkId: string): void {
    const s = this.get(sid);
    if (!s) return;
    if (!spkId || s.speakersSeen.has(spkId)) return;
    s.speakersSeen.set(spkId, {
      id: spkId,
      label: `发言人 ${s.speakersSeen.size + 1}`,
    });
    s.metrics.speakerCount = s.speakersSeen.size;
  }
}
