/**
 * TDD: VolcengineAsrSession — mock ws 模块, 验证握手/分发/编码
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { gzipSync } from 'node:zlib';

// ---- mock ws ----
type WsHandlers = {
  open: () => void;
  message: (data: Buffer) => void;
  error: (err: Error) => void;
  close: () => void;
  unexpectedResponse?: () => void;
};

interface MockWs {
  readyState: number;
  binaryType: string;
  sent: Buffer[];
  on: (ev: string, h: () => void) => void;
  send: (b: Buffer) => void;
  close: () => void;
}

const OPEN = 1;
const mockInstances: MockWs[] = [];

jest.mock('ws', () => {
  return {
    __esModule: true,
    default: class FakeWs {
      static OPEN = 1;
      static CLOSED = 3;
      static lastUrl = '';
      static lastHeaders: Record<string, string> | null = null;
      readyState = OPEN;
      binaryType = 'nodebuffer';
      sent: Buffer[] = [];
      private handlers: Record<string, Array<() => void>> = {};

      constructor(
        url: string,
        opts: { headers?: Record<string, string> } = {},
      ) {
        (FakeWs as any).lastUrl = url;
        (FakeWs as any).lastHeaders = opts.headers ?? null;
        mockInstances.push(this as unknown as MockWs);
        // 异步触发 open (下一个 tick)
        Promise.resolve().then(() => {
          this.handlers.open?.forEach((h) => (h as () => void)());
        });
      }
      on(ev: string, h: () => void) {
        (this.handlers[ev] = this.handlers[ev] || []).push(h);
      }
      send(b: Buffer) {
        this.sent.push(b);
      }
      close() {
        this.readyState = 3; // CLOSED
        this.handlers.close?.forEach((h) => (h as () => void)());
      }
      // 测试 helper: 模拟服务端推帧
      _simulateMessage(data: Buffer) {
        this.handlers.message?.forEach((h) =>
          (h as (d: Buffer) => void)(data),
        );
      }
      _simulateError(err: Error) {
        this.handlers.error?.forEach((h) => (h as (e: Error) => void)(err));
      }
    },
  };
});

// 在 mock 设置之后再 import
import { VolcengineAsrSession } from './asr-session.class';
import {
  PROTOCOL_VERSION,
  MSG_TYPE,
  FLAG,
  parseServerResponseV3,
} from '../volcengine-proto/protocol';

function makeServerFrame(
  msgType: number,
  flags: number,
  payloadObj: unknown,
  compression: number = 0,
): Buffer {
  const byte1 = ((msgType & 0x0f) << 4) | (flags & 0x0f);
  const byte2 = ((1 << 4) | (compression & 0x0f)) & 0xff;
  const head = Buffer.from([PROTOCOL_VERSION, byte1, byte2, 0x00]);
  let body = Buffer.from(JSON.stringify(payloadObj), 'utf-8');
  if (compression === 1) body = gzipSync(body);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, size, body]);
}

const basicCfg = {
  endpoint: 'wss://fake.example.com/api',
  appKey: 'APP',
  accessToken: 'TOK',
  resourceId: 'volc.seedasr.sauc.duration',
};

describe('VolcengineAsrSession', () => {
  beforeEach(() => {
    mockInstances.length = 0;
  });

  it('start() 用配置的 endpoint + 鉴权 headers 创建 WebSocket', async () => {
    const Ws = (await import('ws')).default as any;
    const s = new VolcengineAsrSession(
      'sid-1',
      basicCfg,
      { onPartial: jest.fn(), onFinal: jest.fn(), onError: jest.fn() },
    );
    s.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(Ws.lastUrl).toBe('wss://fake.example.com/api');
    expect(Ws.lastHeaders).toBeTruthy();
    expect(Ws.lastHeaders['X-Api-App-Key']).toBe('APP');
    expect(Ws.lastHeaders['X-Api-Access-Key']).toBe('TOK');
    expect(Ws.lastHeaders['Authorization']).toMatch(/^Bearer; /);
  });

  it('握手成功后发 0x1 full request, ready=true', async () => {
    const ws = (await import('ws')).default as any;
    const s = new VolcengineAsrSession(
      'sid-2',
      basicCfg,
      { onPartial: jest.fn(), onFinal: jest.fn(), onError: jest.fn() },
    );
    s.start();
    const ok = await s.waitUntilReady(500);
    expect(ok).toBe(true);
    // 第一帧是 full request (msgType=0x1)
    const mock = mockInstances[mockInstances.length - 1];
    expect(mock.sent.length).toBeGreaterThanOrEqual(1);
    const firstFrame = mock.sent[0];
    expect(firstFrame[1] >> 4).toBe(MSG_TYPE.FULL_REQUEST);
  });

  it('partial 帧: onPartial 被回调, 文本透传', async () => {
    const onPartial = jest.fn();
    const s = new VolcengineAsrSession(
      'sid-3',
      basicCfg,
      { onPartial, onFinal: jest.fn(), onError: jest.fn() },
    );
    s.start();
    await new Promise((r) => setTimeout(r, 0));
    const mock = mockInstances[mockInstances.length - 1] as any;
    mock._simulateMessage(
      makeServerFrame(MSG_TYPE.PARTIAL_RESPONSE, 0, {
        result: { text: '你好' },
      }),
    );
    expect(onPartial).toHaveBeenCalledWith('你好', 'sid-3');
  });

  it('final 帧: onFinal 被回调, 含 utterances/speakers/latency', async () => {
    const onFinal = jest.fn();
    const s = new VolcengineAsrSession(
      'sid-4',
      basicCfg,
      { onPartial: jest.fn(), onFinal, onError: jest.fn() },
    );
    s.start();
    await new Promise((r) => setTimeout(r, 0));
    const mock = mockInstances[mockInstances.length - 1] as any;
    mock._simulateMessage(
      makeServerFrame(MSG_TYPE.FINAL_RESPONSE, 0, {
        result: {
          text: '你好世界',
          utterances: [
            {
              text: '你好世界',
              start_time: 0,
              end_time: 500,
              additions: { speaker_id: 'spk0' },
              definite: true,
            },
          ],
        },
      }),
    );
    expect(onFinal).toHaveBeenCalledTimes(1);
    const [text, utts, spks, latency, sid] = onFinal.mock.calls[0] as [
      string,
      any[],
      any[],
      number,
      string,
    ];
    expect(text).toBe('你好世界');
    expect(utts.length).toBe(1);
    expect(utts[0].speaker_id).toBe('spk0');
    expect(spks.length).toBe(1);
    expect(spks[0].id).toBe('spk0');
    expect(typeof latency).toBe('number');
    expect(sid).toBe('sid-4');
  });

  it('error 帧: onError 被回调, 含 code/message', async () => {
    const onError = jest.fn();
    const s = new VolcengineAsrSession(
      'sid-5',
      basicCfg,
      { onPartial: jest.fn(), onFinal: jest.fn(), onError },
    );
    s.start();
    await new Promise((r) => setTimeout(r, 0));
    const mock = mockInstances[mockInstances.length - 1] as any;
    mock._simulateMessage(
      makeServerFrame(MSG_TYPE.ERROR, 0, { code: 1001, message: 'bad token' }),
    );
    expect(onError).toHaveBeenCalledWith(1001, 'bad token', 'sid-5');
  });

  it('sendAudio: 编码 audio-only 帧并推到 ws', async () => {
    const s = new VolcengineAsrSession(
      'sid-6',
      basicCfg,
      { onPartial: jest.fn(), onFinal: jest.fn(), onError: jest.fn() },
    );
    s.start();
    await new Promise((r) => setTimeout(r, 0));
    const mock = mockInstances[mockInstances.length - 1];
    const before = mock.sent.length;
    const pcm = Buffer.alloc(320, 0xab);
    s.sendAudio(pcm);
    expect(mock.sent.length).toBe(before + 1);
    const audioFrame = mock.sent[mock.sent.length - 1];
    expect(audioFrame[1] >> 4).toBe(MSG_TYPE.AUDIO_ONLY);
    expect(audioFrame[1] & 0x0f).toBe(FLAG.NONE);
    expect(s.audioBytesSent).toBe(320);
  });

  it('finalize: 发 LAST flag 帧', async () => {
    const s = new VolcengineAsrSession(
      'sid-7',
      basicCfg,
      { onPartial: jest.fn(), onFinal: jest.fn(), onError: jest.fn() },
    );
    s.start();
    await new Promise((r) => setTimeout(r, 0));
    const mock = mockInstances[mockInstances.length - 1];
    const before = mock.sent.length;
    s.finalize();
    const lastFrame = mock.sent[mock.sent.length - 1];
    expect(lastFrame[1] >> 4).toBe(MSG_TYPE.AUDIO_ONLY);
    expect(lastFrame[1] & 0x0f).toBe(FLAG.LAST);
  });

  it('close(): readyState=CLOSED, isAlive=false', async () => {
    const s = new VolcengineAsrSession(
      'sid-8',
      basicCfg,
      { onPartial: jest.fn(), onFinal: jest.fn(), onError: jest.fn() },
    );
    s.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.isAlive).toBe(true);
    s.close();
    expect(s.isAlive).toBe(false);
  });

  it('ws error 事件: onError 被回调', async () => {
    const onError = jest.fn();
    const s = new VolcengineAsrSession(
      'sid-9',
      basicCfg,
      { onPartial: jest.fn(), onFinal: jest.fn(), onError },
    );
    s.start();
    await new Promise((r) => setTimeout(r, 0));
    const mock = mockInstances[mockInstances.length - 1] as any;
    mock._simulateError(new Error('conn reset'));
    expect(onError).toHaveBeenCalled();
    const [, msg, sid] = onError.mock.calls[0];
    expect(msg).toMatch(/conn reset/);
    expect(sid).toBe('sid-9');
  });
});
