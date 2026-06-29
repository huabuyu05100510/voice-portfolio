/**
 * TDD: V3 TTS 二进制帧编解码
 * 覆盖 roundtrip / 边界 / parse 分支
 */
import { describe, it, expect } from '@jest/globals';
import {
  V3_TTS_EVENT,
  encodeFrameNoSession,
  encodeFrameWithSession,
  parseFrame,
  buildV3WsHeaders,
} from './tts-v3-protocol';

describe('V3 TTS protocol', () => {
  describe('encodeFrameNoSession', () => {
    it('生成固定 4 字节 header 0x11 0x14 0x10 0x00', () => {
      const f = encodeFrameNoSession(V3_TTS_EVENT.START_CONNECTION, {});
      expect(Array.from(f.subarray(0, 4))).toEqual([0x11, 0x14, 0x10, 0x00]);
    });

    it('event_id 写在 header 后 (4 字节 BE)', () => {
      const f = encodeFrameNoSession(V3_TTS_EVENT.START_CONNECTION, {});
      expect(f.readUInt32BE(4)).toBe(V3_TTS_EVENT.START_CONNECTION);
    });

    it('payload 为空对象时 body length = 2 ("{}")', () => {
      const f = encodeFrameNoSession(V3_TTS_EVENT.START_CONNECTION, {});
      expect(f.readUInt32BE(8)).toBe(2);
      expect(f.subarray(12).toString('utf-8')).toBe('{}');
    });

    it('payload 为业务对象时正确序列化', () => {
      const f = encodeFrameNoSession(V3_TTS_EVENT.TASK_REQUEST, {
        event: 200,
        text: '你好',
      });
      const len = f.readUInt32BE(8);
      const body = f.subarray(12, 12 + len).toString('utf-8');
      expect(JSON.parse(body)).toEqual({ event: 200, text: '你好' });
    });
  });

  describe('encodeFrameWithSession', () => {
    it('header 之后是 event_id, session_len, session, payload_len, payload', () => {
      const sid = 'sess-12345';
      const f = encodeFrameWithSession(V3_TTS_EVENT.START_SESSION, sid, {
        event: 100,
      });
      expect(f.readUInt32BE(4)).toBe(V3_TTS_EVENT.START_SESSION);
      expect(f.readUInt32BE(8)).toBe(sid.length);
      expect(f.subarray(12, 12 + sid.length).toString('utf-8')).toBe(sid);
      const payloadLenOff = 12 + sid.length;
      const body = f.subarray(payloadLenOff + 4).toString('utf-8');
      expect(JSON.parse(body)).toEqual({ event: 100 });
    });
  });

  describe('parseFrame roundtrip', () => {
    it('解析服务端 CONNECTION_STARTED (msg_type=0, 无 session_id)', () => {
      // 服务端建连成功: msg_type=0 → 无 session_id 字段
      const header = Buffer.from([0x11, 0x00, 0x10, 0x00]);
      const event = Buffer.alloc(4);
      event.writeUInt32BE(V3_TTS_EVENT.CONNECTION_STARTED, 0);
      const body = Buffer.from(JSON.stringify({ connection_id: 'abc' }), 'utf-8');
      const payloadLen = Buffer.alloc(4);
      payloadLen.writeUInt32BE(body.length, 0);
      const frame = Buffer.concat([header, event, payloadLen, body]);

      const parsed = parseFrame(frame);
      expect(parsed.event).toBe(V3_TTS_EVENT.CONNECTION_STARTED);
      expect(parsed.sessionId).toBeNull();
      expect(parsed.payloadJson).toEqual({ connection_id: 'abc' });
    });

    it('with-session 帧能 roundtrip (sessionId 正确解析)', () => {
      const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const original = encodeFrameWithSession(
        V3_TTS_EVENT.SESSION_FINISHED,
        sid,
        { event: 152 },
      );
      const parsed = parseFrame(original);
      expect(parsed.event).toBe(V3_TTS_EVENT.SESSION_FINISHED);
      expect(parsed.sessionId).toBe(sid);
      expect(parsed.payloadJson).toEqual({ event: 152 });
    });
  });

  describe('parseFrame - 音频 payload', () => {
    it('TTS_RESPONSE 大 payload 不尝试 JSON 解析 (payloadJson=null, payload=原始字节)', () => {
      // 手工构造一个 msg_type=0b0001 带 session_id 的帧, payload 是二进制音频
      const sid = 'sess-abc';
      const fakeAudio = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x00, 0x01, 0x02, 0x03]);
      const header = Buffer.from([0x11, 0x14 | (0b0001 << 4), 0x10, 0x00]);
      const event = Buffer.alloc(4);
      event.writeUInt32BE(V3_TTS_EVENT.TTS_RESPONSE, 0);
      const sidLen = Buffer.alloc(4);
      sidLen.writeUInt32BE(sid.length, 0);
      const sidBuf = Buffer.from(sid, 'utf-8');
      const payloadLen = Buffer.alloc(4);
      payloadLen.writeUInt32BE(fakeAudio.length, 0);
      const frame = Buffer.concat([
        header,
        event,
        sidLen,
        sidBuf,
        payloadLen,
        fakeAudio,
      ]);

      const parsed = parseFrame(frame);
      expect(parsed.event).toBe(V3_TTS_EVENT.TTS_RESPONSE);
      expect(parsed.sessionId).toBe(sid);
      expect(parsed.payload).toEqual(fakeAudio);
      expect(parsed.payloadJson).toBeNull();
    });
  });

  describe('buildV3WsHeaders', () => {
    it('使用 X-Api-Key (新版控制台) 而非 X-Api-Access-Key', () => {
      const h = buildV3WsHeaders({
        appKey: 'app-1',
        accessKey: 'key-1',
        resourceId: 'volc.service_type.10029',
      });
      expect(h['X-Api-Key']).toBe('key-1');
      expect(h['X-Api-Access-Key']).toBeUndefined();
      expect(h['X-Api-App-Key']).toBe('app-1');
      expect(h['X-Api-Resource-Id']).toBe('volc.service_type.10029');
    });

    it('connect_id 自动生成, 也可显式传入', () => {
      const h1 = buildV3WsHeaders({
        appKey: 'a',
        accessKey: 'k',
        resourceId: 'r',
      });
      const h2 = buildV3WsHeaders({
        appKey: 'a',
        accessKey: 'k',
        resourceId: 'r',
        connectId: 'fixed-id',
      });
      expect(h1['X-Api-Connect-Id']).toBeTruthy();
      expect(h2['X-Api-Connect-Id']).toBe('fixed-id');
    });
  });
});
