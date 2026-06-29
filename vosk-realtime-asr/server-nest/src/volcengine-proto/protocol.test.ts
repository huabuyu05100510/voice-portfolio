/**
 * TDD: volcengine-proto/protocol — 与 Python 行为对齐
 */
import { describe, it, expect } from '@jest/globals';
import {
  encodeFullClientRequest,
  encodeAudioOnly,
  encodeAudioLast,
  parseServerResponseV3,
  buildFullRequestPayload,
  buildWsHeaders,
  PROTOCOL_VERSION,
  MSG_TYPE,
  FLAG,
  SERIALIZATION,
  COMPRESSION,
} from './protocol';
import { gunzipSync } from 'node:zlib';

describe('protocol / encode', () => {
  it('encodeFullClientRequest: 0x11 header + 0x10 msg_type + JSON+gzip', () => {
    const payload = { user: { uid: 'x' } };
    const f = encodeFullClientRequest(payload);
    expect(f[0]).toBe(PROTOCOL_VERSION);
    // msg_type=1<<4 | flags=0 → 0x10
    expect(f[1]).toBe((MSG_TYPE.FULL_REQUEST << 4) | FLAG.NONE);
    // serialization=JSON(1)<<4 | compression=GZIP(1) → 0x11
    expect(f[2]).toBe((SERIALIZATION.JSON << 4) | COMPRESSION.GZIP);
    expect(f[3]).toBe(0x00);
    // bytes 4..7 = size (大端无符号)
    const size = f.readUInt32BE(4);
    expect(size).toBeGreaterThan(0);
    expect(f.length).toBe(8 + size);
    // body 是 gzip JSON
    const body = gunzipSync(f.subarray(8));
    expect(JSON.parse(body.toString('utf-8'))).toEqual(payload);
  });

  it('encodeAudioOnly: msg_type=2, gzip pcm', () => {
    const pcm = Buffer.from([0, 1, 0, 2, 0, 3]);
    const f = encodeAudioOnly(pcm);
    expect(f[1] >> 4).toBe(MSG_TYPE.AUDIO_ONLY);
    expect(f[1] & 0x0f).toBe(FLAG.NONE);
    const body = gunzipSync(f.subarray(8));
    expect(body.equals(pcm)).toBe(true);
  });

  it('encodeAudioLast: flags=LAST(0x2)', () => {
    const f = encodeAudioLast(Buffer.from([0, 0]));
    expect(f[1] >> 4).toBe(MSG_TYPE.AUDIO_ONLY);
    expect(f[1] & 0x0f).toBe(FLAG.LAST);
  });
});

describe('protocol / parseServerResponseV3', () => {
  /** 构造一个服务端风格的响应帧 */
  function makeFrame(
    msgType: number,
    flags: number,
    payloadObj: unknown,
    compression: number = COMPRESSION.NONE,
    withSeq: boolean = false,
    seq: number = 0,
  ): Buffer {
    const byte1 = ((msgType & 0x0f) << 4) | (flags & 0x0f);
    const byte2 = ((SERIALIZATION.JSON << 4) | (compression & 0x0f)) & 0xff;
    const head = Buffer.from([PROTOCOL_VERSION, byte1, byte2, 0x00]);
    let body = Buffer.from(JSON.stringify(payloadObj), 'utf-8');
    if (compression === COMPRESSION.GZIP) {
      const { gzipSync } = require('node:zlib');
      body = gzipSync(body);
    }
    const seqBuf = withSeq
      ? (() => {
          const b = Buffer.alloc(4);
          b.writeInt32BE(seq, 0);
          return b;
        })()
      : Buffer.alloc(0);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(body.length, 0);
    return Buffer.concat([head, seqBuf, size, body]);
  }

  it('final 帧 (msgType=0xF): type=final, payload 解析正确', () => {
    const frame = makeFrame(MSG_TYPE.FINAL_RESPONSE, 0, {
      result: { text: '你好', utterances: [] },
    });
    const parsed = parseServerResponseV3(frame);
    expect(parsed.type).toBe('final');
    expect(parsed.payload.result.text).toBe('你好');
  });

  it('partial 帧 (msgType=0xC): type=partial', () => {
    const frame = makeFrame(MSG_TYPE.PARTIAL_RESPONSE, 0, {
      result: { text: '你' },
    });
    expect(parseServerResponseV3(frame).type).toBe('partial');
  });

  it('full 帧 (msgType=0x9): type=full (config ack)', () => {
    const frame = makeFrame(MSG_TYPE.FULL_RESPONSE, 0, { ok: true });
    expect(parseServerResponseV3(frame).type).toBe('full');
  });

  it('error 帧 (msgType=0xB): type=error', () => {
    const frame = makeFrame(MSG_TYPE.ERROR, 0, { code: 1001, message: 'bad' });
    const parsed = parseServerResponseV3(frame);
    expect(parsed.type).toBe('error');
    expect(parsed.payload.code).toBe(1001);
  });

  it('flags 带 HAS_SEQ: 解析 4 字节 seq', () => {
    const frame = makeFrame(
      MSG_TYPE.FINAL_RESPONSE,
      FLAG.HAS_SEQ,
      { result: { text: 'x' } },
      COMPRESSION.NONE,
      true,
      42,
    );
    const parsed = parseServerResponseV3(frame);
    expect(parsed.seq).toBe(42);
    expect(parsed.type).toBe('final');
  });

  it('gzip 压缩响应: 自动解压', () => {
    const frame = makeFrame(
      MSG_TYPE.FINAL_RESPONSE,
      0,
      { result: { text: '解压' } },
      COMPRESSION.GZIP,
    );
    const parsed = parseServerResponseV3(frame);
    expect(parsed.payload.result.text).toBe('解压');
  });

  it('未知 msgType: type=unknown_0xX', () => {
    const frame = makeFrame(0x7, 0, {});
    expect(parseServerResponseV3(frame).type).toBe('unknown_0x7');
  });

  it('过短帧 (<4B): type=unknown', () => {
    const parsed = parseServerResponseV3(Buffer.from([0x11, 0x00]));
    expect(parsed.type).toBe('unknown');
  });

  it('roundtrip: encode 后 parse 能解回 payload', () => {
    // 客户端发的 full request 用 gzip; parse 也能解
    const payload = buildFullRequestPayload({
      appKey: 'test-key',
      accessToken: 'tok',
    });
    const frame = encodeFullClientRequest(payload);
    const parsed = parseServerResponseV3(frame);
    expect(parsed.type).not.toBe('error');
    // payload 内 reqid 等字段保留
    expect(parsed.payload.user.uid).toBe('web-client');
    expect(parsed.payload.request.model_name).toBe('bigmodel');
  });
});

describe('protocol / buildFullRequestPayload', () => {
  it('含 user/audio/request/app 四块, appid 取 appKey 前 8 位', () => {
    const p = buildFullRequestPayload({
      appKey: '1234567890abcdef',
      accessToken: 'tok',
    });
    expect(p.user.uid).toBe('web-client');
    expect(p.audio.format).toBe('pcm');
    expect(p.audio.rate).toBe(16000);
    expect(p.request.model_name).toBe('bigmodel');
    expect(p.request.result_type).toBe('full');
    expect(p.request.reqid).toBeTruthy();
    expect(p.app.appid).toBe('12345678');
    expect(p.app.token).toBe('tok');
  });

  it('appKey 含 -: 取 split("-")[0]', () => {
    const p = buildFullRequestPayload({
      appKey: 'abc-def-12345',
      accessToken: 't',
    });
    expect(p.app.appid).toBe('abc');
  });

  it('默认开启 speaker diarization, diarization_speaker_count=-1', () => {
    const p = buildFullRequestPayload({
      appKey: 'k',
      accessToken: 't',
    });
    expect(p.request.enable_speaker_info).toBe(true);
    expect(p.request.diarization_speaker_count).toBe(-1);
  });
});

describe('protocol / buildWsHeaders', () => {
  it('新控制台 X-Api-Key 模式: 单鉴权 header', () => {
    const hs = buildWsHeaders({
      appKey: 'app',
      accessToken: 'tok',
      resourceId: 'volc.seedasr.sauc.duration',
      apiKey: 'NEW_KEY',
    });
    expect(hs.some((h) => h.startsWith('X-Api-Key: NEW_KEY'))).toBe(true);
    expect(hs.some((h) => h.startsWith('Authorization: Bearer; NEW_KEY'))).toBe(
      true,
    );
    // 新模式不再发 X-Api-App-Key / X-Api-Access-Key
    expect(hs.some((h) => h.startsWith('X-Api-App-Key:'))).toBe(false);
  });

  it('旧控制台双 header 模式', () => {
    const hs = buildWsHeaders({
      appKey: 'APPID',
      accessToken: 'TOK',
      resourceId: 'r',
    });
    expect(hs.some((h) => h.startsWith('X-Api-App-Key: APPID'))).toBe(true);
    expect(hs.some((h) => h.startsWith('X-Api-Access-Key: TOK'))).toBe(true);
  });

  it('Authorization 永远带分号 (字节 SAUC 网关特殊)', () => {
    const hs = buildWsHeaders({
      appKey: 'a',
      accessToken: 't',
      resourceId: 'r',
      apiKey: 'K',
    });
    expect(hs[0]).toMatch(/^Authorization: Bearer; /);
  });
});
