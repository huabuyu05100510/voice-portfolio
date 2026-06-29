/**
 * 火山引擎 v3/sauc/bigmodel_async 二进制协议编解码 (TypeScript 移植)
 * 直接对照 server/volcengine_engine.py, 行为等价.
 *
 * 帧布局:
 *   byte0 = 0x11 (protocol_version<<4 | header_size)
 *   byte1 = (msg_type<<4) | flags
 *   byte2 = (serialization<<4) | compression
 *   byte3 = 0x00 (reserved)
 *   [seq: 4B BE signed]   (仅当 flags & 0x01)
 *   size: 4B BE unsigned
 *   body: <size> bytes (gzip if compression==1)
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

// ============================================================================
// 协议常量
// ============================================================================
export const PROTOCOL_VERSION = 0x11;

export const MSG_TYPE = {
  FULL_REQUEST: 0x1,
  AUDIO_ONLY: 0x2,
  FULL_RESPONSE: 0x9,
  ERROR: 0xb,
  PARTIAL_RESPONSE: 0xc,
  FINAL_RESPONSE: 0xf,
} as const;

export const FLAG = {
  NONE: 0x0,
  HAS_SEQ: 0x1,
  LAST: 0x2,
} as const;

export const SERIALIZATION = {
  JSON: 0x1,
  PROTOBUF: 0x2,
} as const;

export const COMPRESSION = {
  NONE: 0x0,
  GZIP: 0x1,
} as const;

const RESPONSE_TYPE_NAMES: Record<number, string> = {
  [MSG_TYPE.FULL_RESPONSE]: 'full',
  [MSG_TYPE.PARTIAL_RESPONSE]: 'partial',
  [MSG_TYPE.FINAL_RESPONSE]: 'final',
  [MSG_TYPE.ERROR]: 'error',
};

// ============================================================================
// 内部: 帧头 + gzip 包装
// ============================================================================
function makeHeader(
  msgType: number,
  flags: number,
  serialization: number,
  compression: number,
): Buffer {
  const byte1 = ((msgType & 0x0f) << 4) | (flags & 0x0f);
  const byte2 = ((serialization & 0x0f) << 4) | (compression & 0x0f);
  return Buffer.from([PROTOCOL_VERSION, byte1, byte2, 0x00]);
}

function frame(
  header: Buffer,
  payload: Buffer,
  compression: number = COMPRESSION.GZIP,
): Buffer {
  const body =
    compression === COMPRESSION.GZIP ? gzipSync(payload) : payload;
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, size, body]);
}

// ============================================================================
// 客户端 → 服务端: 编码
// ============================================================================
export function encodeFullClientRequest(payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  const header = makeHeader(
    MSG_TYPE.FULL_REQUEST,
    FLAG.NONE,
    SERIALIZATION.JSON,
    COMPRESSION.GZIP,
  );
  return frame(header, body, COMPRESSION.GZIP);
}

export function encodeAudioOnly(audio: Buffer): Buffer {
  const header = makeHeader(
    MSG_TYPE.AUDIO_ONLY,
    FLAG.NONE,
    SERIALIZATION.JSON,
    COMPRESSION.GZIP,
  );
  return frame(header, audio, COMPRESSION.GZIP);
}

export function encodeAudioLast(audio: Buffer): Buffer {
  const header = makeHeader(
    MSG_TYPE.AUDIO_ONLY,
    FLAG.LAST,
    SERIALIZATION.JSON,
    COMPRESSION.GZIP,
  );
  return frame(header, audio, COMPRESSION.GZIP);
}

// ============================================================================
// 服务端 → 客户端: 解码 (v3 协议, 可能带 seq 字段)
// ============================================================================
export interface ParsedResponse {
  type: string;
  flags?: number;
  seq?: number | null;
  payload: Record<string, any>;
  rawSize: number;
}

export function parseServerResponseV3(data: Buffer | Uint8Array): ParsedResponse {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 4) {
    return {
      type: 'unknown',
      payload: { raw: buf.toString('hex') },
      rawSize: buf.length,
    };
  }

  const msgType = (buf[1] >> 4) & 0x0f;
  const flags = buf[1] & 0x0f;
  const compression = buf[2] & 0x0f;

  let off = 4;
  let seq: number | null = null;
  if (flags & 0x01) {
    if (buf.length < off + 4) {
      return {
        type: 'unknown',
        payload: { raw: buf.toString('hex') },
        rawSize: buf.length,
      };
    }
    seq = buf.readInt32BE(off);
    off += 4;
  }

  if (buf.length < off + 4) {
    return {
      type: 'unknown',
      payload: { raw: buf.toString('hex') },
      rawSize: buf.length,
    };
  }
  const size = buf.readUInt32BE(off);
  off += 4;
  let body = buf.subarray(off, off + size);

  if (compression === COMPRESSION.GZIP) {
    try {
      body = gunzipSync(body);
    } catch (e) {
      return {
        type: 'error',
        payload: { code: -1, message: `gzip fail: ${(e as Error).message}` },
        rawSize: buf.length,
      };
    }
  }

  let parsed: Record<string, any> = {};
  if (body.length > 0) {
    try {
      parsed = JSON.parse(body.toString('utf-8'));
    } catch (e) {
      parsed = {
        _parse_error: (e as Error).message,
        _raw: body.subarray(0, 500).toString('utf-8'),
      };
    }
  }

  const typeName =
    RESPONSE_TYPE_NAMES[msgType] ?? `unknown_0x${msgType.toString(16).toUpperCase()}`;
  return {
    type: typeName,
    flags,
    seq,
    payload: parsed,
    rawSize: buf.length,
  };
}

// ============================================================================
// 构造 full request payload (v3)
// ============================================================================
export interface BuildPayloadOptions {
  appKey: string;
  accessToken: string;
  apiKey?: string;
  cluster?: string;
  modelName?: string;
  uid?: string;
  enableItn?: boolean;
  enablePunc?: boolean;
  showUtterances?: boolean;
  enableSpeakerInfo?: boolean;
  enableDiarization?: boolean;
  resultType?: 'single' | 'full';
  sampleRate?: number;
  bits?: number;
  channels?: number;
  platform?: string;
  extraRequest?: Record<string, unknown>;
  enableNonstream?: boolean;
  endWindowSize?: number;
  forceToSpeechTime?: number;
  diarizationSpeakerCount?: number;
}

export function buildFullRequestPayload(
  opts: BuildPayloadOptions,
): Record<string, any> {
  const {
    appKey,
    accessToken,
    cluster,
    modelName = 'bigmodel',
    uid = 'web-client',
    enableItn = true,
    enablePunc = true,
    showUtterances = true,
    enableSpeakerInfo = true,
    enableDiarization = true,
    resultType = 'full',
    sampleRate = 16000,
    bits = 16,
    channels = 1,
    platform = 'Web',
    extraRequest,
    enableNonstream = false,
    endWindowSize,
    forceToSpeechTime,
    diarizationSpeakerCount = -1,
  } = opts;

  const req: Record<string, unknown> = {
    model_name: modelName,
    enable_itn: enableItn,
    enable_punc: enablePunc,
    enable_ddc: false,
    show_utterances: showUtterances,
    result_type: resultType,
    reqid: randomUUID(),
  };
  if (enableNonstream) req.enable_nonstream = true;
  if (endWindowSize !== undefined) req.end_window_size = endWindowSize;
  if (forceToSpeechTime !== undefined) req.force_to_speech_time = forceToSpeechTime;
  if (enableDiarization || enableSpeakerInfo) {
    req.enable_speaker_info = true;
    req.show_speaker_info = true;
    req.diarization_speaker_count = diarizationSpeakerCount;
    req.speaker_count = diarizationSpeakerCount;
  }
  if (extraRequest) Object.assign(req, extraRequest);

  const payload: Record<string, any> = {
    user: { uid, platform },
    audio: {
      format: 'pcm',
      codec: 'raw',
      rate: sampleRate,
      bits,
      channel: channels,
    },
    request: req,
  };

  const c = cluster ?? 'volcengine_streaming_common';
  payload.app = {
    appid: appKey.includes('-') ? appKey.split('-')[0] : appKey.slice(0, 8),
    token: accessToken,
    cluster: c,
  };
  return payload;
}

// ============================================================================
// WebSocket 握手 headers
// ============================================================================
export function buildWsHeaders(opts: {
  appKey: string;
  accessToken: string;
  resourceId: string;
  requestId?: string;
  connectId?: string;
  apiKey?: string;
}): string[] {
  const { appKey, accessToken, resourceId, apiKey } = opts;
  const requestId = opts.requestId ?? randomUUID();
  const connectId = opts.connectId ?? randomUUID();
  const authToken = apiKey || accessToken;

  const headers: string[] = [
    `Authorization: Bearer; ${authToken}`,
    `X-Api-Resource-Id: ${resourceId}`,
    `X-Api-Request-Id: ${requestId}`,
    `X-Api-Connect-Id: ${connectId}`,
    'X-Api-Sequence: -1',
  ];
  if (apiKey) {
    headers.splice(1, 0, `X-Api-Key: ${apiKey}`);
  } else {
    headers.splice(1, 0, `X-Api-App-Key: ${appKey}`);
    headers.splice(2, 0, `X-Api-Access-Key: ${accessToken}`);
  }
  return headers;
}
