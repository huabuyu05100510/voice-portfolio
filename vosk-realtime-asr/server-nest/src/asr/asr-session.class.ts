/**
 * VolcengineAsrSession — 单 sid 的火山引擎 ASR 会话 (v3 协议)
 *
 * 对照 server/volcengine_session.py:VolcengineSession
 *
 * 生命周期:
 *   const s = new VolcengineAsrSession(sid, cfg, cbs);
 *   s.start();                       // 异步握手
 *   await s.waitUntilReady(5000);    // 等握手 + config 发送完成 (F1 门控)
 *   s.sendAudio(chunk);              // 推 PCM
 *   s.finalize(lastChunk);           // 发 LAST 帧
 *   s.close();                       // 关 WSS
 *
 * ws (node) 是事件驱动的, 不需要像 Python 那样起 reader 线程.
 * 回调在 ws 的事件回调线程里调用.
 */
import WebSocket from 'ws';
import { Logger } from '@nestjs/common';
import {
  buildFullRequestPayload,
  buildWsHeaders,
  encodeAudioOnly,
  encodeAudioLast,
  encodeFullClientRequest,
  parseServerResponseV3,
} from '../volcengine-proto/protocol';
import { extractUtterances, ExtractResult } from '../volcengine-proto/extract';

export interface AsrSessionConfig {
  endpoint: string;
  appKey: string;
  accessToken: string;
  apiKey?: string;
  resourceId: string;
  modelName?: string;
  enableDiarization?: boolean;
  extraRequest?: Record<string, unknown>;
  platform?: string;
}

export interface AsrCallbacks {
  onPartial: (text: string, sid: string) => void;
  onFinal: (
    text: string,
    utterances: ExtractResult['utterances'],
    speakers: ExtractResult['speakers'],
    latencyMs: number,
    sid: string,
  ) => void;
  onError: (code: number, message: string, sid: string) => void;
}

export class VolcengineAsrSession {
  private readonly logger: Logger;
  readonly sid: string;
  private readonly cfg: AsrSessionConfig;
  private readonly cbs: AsrCallbacks;

  private ws: WebSocket | null = null;
  private opened = false;
  private openedAt: number | null = null;
  private lastAudioSentAt: number | null = null;

  // F1 门控: 握手 + config 发送完成
  private readonly readyPromise: Promise<boolean>;
  private resolveReady!: (ok: boolean) => void;

  // 观测
  audioBytesSent = 0;
  framesSent = 0;

  constructor(sid: string, cfg: AsrSessionConfig, cbs: AsrCallbacks) {
    this.sid = sid;
    this.cfg = cfg;
    this.cbs = cbs;
    this.logger = new Logger(`AsrSession:${sid.slice(0, 6)}`);
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  start(): void {
    if (this.ws) return;
    const url = this.cfg.endpoint;
    const headers = buildWsHeaders({
      appKey: this.cfg.appKey,
      accessToken: this.cfg.accessToken,
      resourceId: this.cfg.resourceId,
      apiKey: this.cfg.apiKey,
    });
    // ws 库的 headers 选项是 plain object; 转 dict
    const headerObj: Record<string, string> = {};
    for (const h of headers) {
      const idx = h.indexOf(':');
      if (idx > 0) headerObj[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    }
    try {
      this.ws = new WebSocket(url, {
        headers: headerObj,
        perMessageDeflate: false,
      });
    } catch (e) {
      this.cbs.onError(0, `ws ctor failed: ${(e as Error).message}`, this.sid);
      this.resolveReady(false);
      return;
    }

    this.ws.binaryType = 'nodebuffer';

    this.ws.on('open', () => this.handleOpen());
    this.ws.on('message', (data) => this.handleMessage(data as Buffer));
    this.ws.on('error', (err) => {
      this.cbs.onError(0, `ws error: ${err.message}`, this.sid);
      if (!this.opened) this.resolveReady(false);
    });
    this.ws.on('close', () => {
      this.opened = false;
    });
    this.ws.on('unexpected-response', (req, res) => {
      this.cbs.onError(
        0,
        `unexpected-response status=${res.statusCode}`,
        this.sid,
      );
      this.resolveReady(false);
    });
  }

  /** F1: 阻塞等握手完成. timeoutMs 毫秒超时返 false. */
  async waitUntilReady(timeoutMs = 5000): Promise<boolean> {
    return Promise.race([
      this.readyPromise,
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(this.opened), timeoutMs),
      ),
    ]);
  }

  sendAudio(audio: Buffer): void {
    if (!this.ws || !this.opened || audio.length === 0) return;
    try {
      this.ws.send(encodeAudioOnly(audio));
      this.audioBytesSent += audio.length;
      this.framesSent += 1;
      this.lastAudioSentAt = Date.now();
    } catch (e) {
      this.cbs.onError(0, `send_audio failed: ${(e as Error).message}`, this.sid);
    }
  }

  finalize(lastAudio: Buffer = Buffer.alloc(2, 0)): void {
    if (!this.ws || !this.opened) return;
    try {
      this.ws.send(encodeAudioLast(lastAudio));
      this.framesSent += 1;
    } catch (e) {
      this.cbs.onError(0, `finalize failed: ${(e as Error).message}`, this.sid);
    }
  }

  close(): void {
    this.opened = false;
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }

  get isAlive(): boolean {
    return !!this.ws && this.opened && this.ws.readyState === WebSocket.OPEN;
  }

  // ------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------
  private handleOpen(): void {
    this.opened = true;
    this.openedAt = Date.now();
    // 发 0x1 full request (config only)
    const payload = buildFullRequestPayload({
      appKey: this.cfg.appKey,
      accessToken: this.cfg.accessToken,
      modelName: this.cfg.modelName ?? 'bigmodel',
      uid: `web-${this.sid.slice(0, 12)}`,
      enableDiarization: this.cfg.enableDiarization ?? true,
      enablePunc: true,
      enableItn: true,
      platform: this.cfg.platform ?? 'Web',
      extraRequest: this.cfg.extraRequest,
      diarizationSpeakerCount: -1,
      enableNonstream: true,
      endWindowSize: 500,
      forceToSpeechTime: 1000,
    });
    try {
      this.ws!.send(encodeFullClientRequest(payload));
      this.framesSent += 1;
    } catch (e) {
      this.cbs.onError(
        0,
        `send config failed: ${(e as Error).message}`,
        this.sid,
      );
      this.resolveReady(false);
      return;
    }
    // F1 门控解除
    this.resolveReady(true);
  }

  private handleMessage(data: Buffer): void {
    let parsed;
    try {
      parsed = parseServerResponseV3(data);
    } catch (e) {
      this.cbs.onError(0, `parse failed: ${(e as Error).message}`, this.sid);
      return;
    }

    const ptype = parsed.type;
    const payload = parsed.payload ?? {};

    if (ptype === 'error') {
      const code = (payload.code ?? payload.backend_code ?? 0) as number;
      const msg = (payload.message ??
        payload._raw ??
        JSON.stringify(payload)) as string;
      this.cbs.onError(code, String(msg), this.sid);
      return;
    }

    if (ptype === 'partial') {
      const text = (((payload.result as Record<string, any>) ?? {}).text ??
        '') as string;
      if (text) this.cbs.onPartial(text, this.sid);
      return;
    }

    if (ptype === 'final' || ptype === 'full') {
      const result =
        (ptype === 'final'
          ? (payload.result ?? payload)
          : (payload.result ?? {})) as Record<string, any>;
      // full 帧无 utterances 时忽略 (Python 端同样行为)
      if (ptype === 'full' && !(result.utterances?.length > 0)) return;

      const latencyMs = this.computeLatency();
      const text = (result.text ?? '') as string;
      const { utterances, speakers } = extractUtterances(result);
      this.logger.debug(
        `final utt_count=${utterances.length} spk_count=${speakers.length} text_len=${text.length}`,
      );
      this.cbs.onFinal(text, utterances, speakers, latencyMs, this.sid);
      return;
    }

    // 其他类型 (full ack 等) 忽略
  }

  private computeLatency(): number {
    const now = Date.now();
    if (this.lastAudioSentAt) return now - this.lastAudioSentAt;
    if (this.openedAt) return now - this.openedAt;
    return 0;
  }
}
