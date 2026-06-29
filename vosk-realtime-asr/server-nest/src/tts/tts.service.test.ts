/**
 * TDD: TtsService (V3 WS) — 鉴权契约 + 协议契约
 *
 * 用 mock WebSocket 验证:
 *   1. WS 连接的 headers 用 X-Api-Key (新版控制台, 非 X-Api-Access-Key)
 *   2. 连接成功后发 START_CONNECTION 帧 (无 session_id)
 *   3. 收到 CONNECTION_STARTED → 发 START_SESSION (带 speaker)
 *   4. 收到 SESSION_STARTED → 发 TASK_REQUEST + FINISH_SESSION
 *   5. TTS_RESPONSE 音频字节累加, SESSION_FINISHED 触发 resolve
 *   6. SESSION_FAILED → 返回 null (降级)
 *   7. ttsUsable=false → 直接 null, 不连 WS
 */
import { describe, it, expect, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { TtsService, type WebSocketFactory } from './tts.service';
import { ConfigService } from '../config/config.service';
import { MetricsService } from '../metrics/metrics.service';
import { StructuredLogger } from '../logger/logger.service';
import {
  V3_TTS_EVENT,
  encodeFrameNoSession,
  encodeFrameWithSession,
} from './tts-v3-protocol';

class FakeWs extends EventEmitter {
  sent: Buffer[] = [];
  closed = false;
  constructor(public url: string, public opts: { headers: Record<string, string> }) {
    super();
    // 用 setImmediate 让 open 事件在 synthesize 订阅后才触发
    setImmediate(() => this.emit('open'));
  }
  send(data: Buffer): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

function makeConfig(over: Partial<ConfigService> = {}): ConfigService {
  return {
    ttsUsable: true,
    ttsApiKey: 'apikey-test',
    volcAppKey: 'app-123',
    ttsResourceId: 'volc.service_type.10029',
    ttsSpeaker: 'zh_male_M392_conversation_wvae_bigtts',
    ttsEndpoint: 'wss://example.test/api/v3/tts/bidirection',
    ttsTimeoutMs: 2000,
    ...over,
  } as unknown as ConfigService;
}

function makeMetrics(): MetricsService {
  return {
    ttsLatency: { observe: jest.fn() } as any,
    ttsRequestsTotal: { labels: jest.fn(() => ({ inc: jest.fn() })) } as any,
    ttsAudioBytesTotal: { inc: jest.fn() } as any,
  } as unknown as MetricsService;
}

function makeLogger(): StructuredLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as StructuredLogger;
}

/** 驱动 fake WS 走完一次成功握手: 拦截 send, 按协议推进状态机 */
function driveSuccessSession(fake: FakeWs, audioPayload: Buffer): void {
  const sidSeen = new Set<string>();
  let respondedStartSession = false;
  let respondedTaskRequest = false;
  const origSend = fake.send.bind(fake);
  (fake as any).send = (data: Buffer) => {
    origSend(data);
    const eventId = data.readUInt32BE(4);
    setImmediate(() => {
      if (eventId === V3_TTS_EVENT.START_CONNECTION) {
        fake.emit('message', encodeFrameNoSession(V3_TTS_EVENT.CONNECTION_STARTED, {}));
      } else if (eventId === V3_TTS_EVENT.START_SESSION) {
        const sidLen = data.readUInt32BE(8);
        const sid = data.subarray(12, 12 + sidLen).toString('utf-8');
        sidSeen.add(sid);
        if (!respondedStartSession) {
          respondedStartSession = true;
          fake.emit(
            'message',
            encodeFrameWithSession(V3_TTS_EVENT.SESSION_STARTED, sid, {
              event: V3_TTS_EVENT.SESSION_STARTED,
            }),
          );
        }
      } else if (eventId === V3_TTS_EVENT.TASK_REQUEST) {
        const sid = [...sidSeen][0];
        if (!respondedTaskRequest) {
          respondedTaskRequest = true;
          fake.emit('message', makeAudioFrame(sid, audioPayload));
          fake.emit(
            'message',
            encodeFrameWithSession(V3_TTS_EVENT.SESSION_FINISHED, sid, {
              event: V3_TTS_EVENT.SESSION_FINISHED,
            }),
          );
        }
      }
    });
  };
}

function makeAudioFrame(sid: string, audio: Buffer): Buffer {
  const header = Buffer.from([0x11, 0x14 | (0b0001 << 4), 0x10, 0x00]);
  const event = Buffer.alloc(4);
  event.writeUInt32BE(V3_TTS_EVENT.TTS_RESPONSE, 0);
  const sidBuf = Buffer.from(sid, 'utf-8');
  const sidLen = Buffer.alloc(4);
  sidLen.writeUInt32BE(sidBuf.length, 0);
  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32BE(audio.length, 0);
  return Buffer.concat([header, event, sidLen, sidBuf, payloadLen, audio]);
}

describe('TtsService (V3 WS)', () => {
  it('握手 headers 使用 X-Api-Key (不是 X-Api-Access-Key)', async () => {
    let capturedHeaders: Record<string, string> = {};
    const factory: WebSocketFactory = (url, opts) => {
      capturedHeaders = opts.headers;
      return new FakeWs(url, opts) as any;
    };
    const svc = new TtsService(makeConfig(), makeMetrics(), makeLogger(), factory);
    const p = svc.synthesize('你好');
    // 阻止超时: 让 promise 永远 hang 然后直接断言 headers (我们只关心 WS 连接参数)
    await new Promise((r) => setImmediate(r));
    expect(capturedHeaders['X-Api-Key']).toBe('apikey-test');
    expect(capturedHeaders['X-Api-App-Key']).toBe('app-123');
    expect(capturedHeaders['X-Api-Resource-Id']).toBe('volc.service_type.10029');
    expect(capturedHeaders['X-Api-Access-Key']).toBeUndefined();
    // 不 await p — 让它最终超时
    p.catch(() => { /* 防止 unhandled rejection */ });
  });

  it('ttsUsable=false 直接返回 null, 不连 WS', async () => {
    const factory = jest.fn<WebSocketFactory>();
    const svc = new TtsService(
      makeConfig({ ttsUsable: false } as any),
      makeMetrics(),
      makeLogger(),
      (factory as unknown) as WebSocketFactory,
    );
    const result = await svc.synthesize('你好');
    expect(result).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('空字符串直接返回 null', async () => {
    const factory = jest.fn<WebSocketFactory>();
    const svc = new TtsService(
      makeConfig(),
      makeMetrics(),
      makeLogger(),
      (factory as unknown) as WebSocketFactory,
    );
    const result = await svc.synthesize('   ');
    expect(result).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('成功路径: CONNECTION_STARTED → START_SESSION → TASK_REQUEST → 累计 TTS_RESPONSE → SESSION_FINISHED 返回 mp3', async () => {
    const fakeRef: { ws?: FakeWs } = {};
    const factory: WebSocketFactory = (url, opts) => {
      const ws = new FakeWs(url, opts);
      fakeRef.ws = ws;
      // 立刻装上驱动器 (在 open 事件触发前)
      driveSuccessSession(ws, Buffer.from([0x01, 0x02, 0x03, 0x04]));
      return ws as any;
    };
    const svc = new TtsService(makeConfig(), makeMetrics(), makeLogger(), factory);

    const result = await svc.synthesize('你好世界');
    expect(result).not.toBeNull();
    expect(result?.format).toBe('mp3');
    expect(Array.from(result!.audio)).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it('SESSION_FAILED → 降级返回 null (不抛错)', async () => {
    const fakeRef: { ws?: FakeWs } = {};
    const factory: WebSocketFactory = (url, opts) => {
      const ws = new FakeWs(url, opts);
      fakeRef.ws = ws;
      return ws as any;
    };
    const svc = new TtsService(makeConfig(), makeMetrics(), makeLogger(), factory);

    const p = svc.synthesize('你好');
    await new Promise((r) => setImmediate(r));
    const fake = fakeRef.ws!;

    // 拦截 send, 收到 START_CONNECTION 后回 SESSION_FAILED
    const origSend = fake.send.bind(fake);
    (fake as any).send = (data: Buffer) => {
      origSend(data);
      const eventId = data.readUInt32BE(4);
      if (eventId === V3_TTS_EVENT.START_CONNECTION) {
        setImmediate(() =>
          fake.emit('message', encodeFrameNoSession(V3_TTS_EVENT.CONNECTION_FAILED, { error: 'denied' })),
        );
      }
    };
    setImmediate(() => fake.emit('open'));

    const result = await p;
    expect(result).toBeNull();
  });

  it('超时 → 降级返回 null', async () => {
    const factory: WebSocketFactory = (url, opts) => new FakeWs(url, opts) as any;
    const svc = new TtsService(
      makeConfig({ ttsTimeoutMs: 50 } as any),
      makeMetrics(),
      makeLogger(),
      factory,
    );
    // FakeWs 构造时 emit open, START_CONNECTION 发出但无响应 → 50ms 超时
    const result = await svc.synthesize('你好');
    expect(result).toBeNull();
  }, 5000);
});
