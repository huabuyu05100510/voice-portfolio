/**
 * 火山引擎 V3 TTS 二进制帧编解码 (doc 1329505)
 *
 * 帧布局:
 *   [4B header][4B event_id][optional 4B sid_len + sid bytes][4B payload_len + payload bytes]
 *
 * Header (4 字节固定):
 *   0x11            protocol_version = 1
 *   0x14            header_size = 1 (4 bytes) | msg_type = 1 (full client→server)
 *   0x10            message_type_specific_flags (serial=JSON, compress=NONE)
 *   0x00            reserved
 *
 * 事件常量参考: doc 1329505 (双向流式 V3)
 */

export const V3_TTS_EVENT = {
  START_CONNECTION: 1,
  FINISH_CONNECTION: 2,
  CONNECTION_STARTED: 50,
  CONNECTION_FAILED: 51,
  START_SESSION: 100,
  FINISH_SESSION: 102,
  SESSION_STARTED: 150,
  SESSION_FINISHED: 152,
  SESSION_FAILED: 153,
  TASK_REQUEST: 200,
  TTS_SENTENCE_START: 350,
  TTS_SENTENCE_END: 351,
  TTS_RESPONSE: 352,
} as const;

export type V3TtsEvent = (typeof V3_TTS_EVENT)[keyof typeof V3_TTS_EVENT];

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

/** V3 client→server frame header (msg_type=1 full, flags=JSON/no-compress) */
function clientHeader(): Buffer {
  return Buffer.from([0x11, 0x14, 0x10, 0x00]);
}

/** 无 session 帧用于建连握手 */
export function encodeFrameNoSession(
  eventId: number,
  payload: Record<string, unknown> = {},
): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  return Buffer.concat([clientHeader(), u32be(eventId), u32be(body.length), body]);
}

/** 带 session_id 的帧 (建连成功后所有业务帧) */
export function encodeFrameWithSession(
  eventId: number,
  sessionId: string,
  payload: Record<string, unknown>,
): Buffer {
  const sid = Buffer.from(sessionId, 'utf-8');
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  return Buffer.concat([
    clientHeader(),
    u32be(eventId),
    u32be(sid.length),
    sid,
    u32be(body.length),
    body,
  ]);
}

export interface ParsedV3Frame {
  /** 事件 id */
  event: number;
  /** 会话 id (server→client 在 SESSION_* / TASK_RESPONSE 类事件里会带) */
  sessionId: string | null;
  /** 原始 payload 字节 (TTS_RESPONSE 是 mp3 音频字节, 其他事件是 JSON) */
  payload: Buffer;
  /** 若 payload 是 JSON 则解析后的对象, 否则 null */
  payloadJson: Record<string, unknown> | null;
}

/** 连接级事件 (无 session_id 字段) */
const CONNECTION_LEVEL_EVENTS = new Set<number>([
  V3_TTS_EVENT.START_CONNECTION,
  V3_TTS_EVENT.FINISH_CONNECTION,
  V3_TTS_EVENT.CONNECTION_STARTED,
  V3_TTS_EVENT.CONNECTION_FAILED,
]);

/**
 * 解析服务端帧. 是否读 session_id 由两层判断:
 *   1. 连接级事件 (START/CONNECTION_STARTED/CONNECTION_FAILED/FINISH_CONNECTION) 一定无 session_id
 *   2. 其他事件按 msg_type bit pattern: 0b0001 / 0b1001 / 0b1011 → 带 session_id
 */
export function parseFrame(buf: Buffer): ParsedV3Frame {
  if (buf.length < 8) {
    throw new Error(`V3 frame too short: ${buf.length}`);
  }
  const msgType = (buf[1] >> 4) & 0x0f;
  let off = 4; // skip 4-byte header
  const event = buf.readUInt32BE(off);
  off += 4;

  let sessionId: string | null = null;
  const isConnectionLevel = CONNECTION_LEVEL_EVENTS.has(event);
  if (!isConnectionLevel && [0b0001, 0b1001, 0b1011].includes(msgType)) {
    const sidLen = buf.readUInt32BE(off);
    off += 4;
    sessionId = buf.subarray(off, off + sidLen).toString('utf-8');
    off += sidLen;
  }

  const payloadLen = buf.readUInt32BE(off);
  off += 4;
  const payload = buf.subarray(off, off + payloadLen);

  let payloadJson: Record<string, unknown> | null = null;
  if (payload.length > 0 && payload.length < 200_000) {
    try {
      payloadJson = JSON.parse(payload.toString('utf-8'));
    } catch {
      payloadJson = null;
    }
  }
  return { event, sessionId, payload, payloadJson };
}

/** 构造建连 WS 握手 headers */
export function buildV3WsHeaders(opts: {
  appKey: string;
  accessKey: string;
  resourceId: string;
  connectId?: string;
}): Record<string, string> {
  return {
    'X-Api-App-Key': opts.appKey,
    // 新版控制台用 X-Api-Key (旧版 X-Api-Access-Key 已弃用)
    'X-Api-Key': opts.accessKey,
    'X-Api-Resource-Id': opts.resourceId,
    'X-Api-Connect-Id': opts.connectId ?? randomConnectId(),
  };
}

/** 简单的随机 connect-id (避免依赖 node:crypto 以便纯函数测试) */
function randomConnectId(): string {
  return `tts-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
