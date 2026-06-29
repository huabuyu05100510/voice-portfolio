/**
 * 探测 V3 TTS 双向流式协议 (doc 1329505)
 * 用法: npx ts-node scripts/probe-v3-tts.ts
 *
 * 复用 ASR 的 X-Api 鉴权 (VOLC_API_KEY + VOLC_APP_KEY),
 * 切换 resource_id 到 volc.service_type.10029 (TTS 大模型).
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APP_KEY = process.env.VOLC_APP_KEY ?? '';
// V3 用 IAM-style X-Api-Access-Key (ASR 已用通的是 VOLC_API_KEY, 不是 VOLC_ACCESS_TOKEN)
const ACCESS_KEY = process.env.VOLC_API_KEY ?? '';
const RESOURCE_ID = 'volc.service_type.10029';
const ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';

// V3 协议事件常量
const EVENT = {
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

// 候选 speaker — 官方大模型音色 + 字符版常见预设
const SPEAKERS = [
  'zh_female_wanwan_moon_bigtts',
  'zh_male_M392_conversation_wvae_bigtts',
  'zh_female_qingxin_jie',
  'S_b3qibSk1',
  'S_sUsoBSk1',
  'BV700_streaming',
  'BV701_streaming',
  'zh_female_XiaoXiao_moon_bigtts',
];

// 4 字节 BE
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function frameHeader(): Buffer {
  // 0x11 0x14 0x10 0x00 — protocol_v1, header_size_1, msg_type=1|flags=4, serial=JSON|compress=NONE
  return Buffer.from([0x11, 0x14, 0x10, 0x00]);
}

function frameNoSession(eventId: number, payload: Record<string, unknown> = {}): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  return Buffer.concat([frameHeader(), u32(eventId), u32(body.length), body]);
}

function frameWithSession(
  eventId: number,
  sessionId: string,
  payload: Record<string, unknown>,
): Buffer {
  const sid = Buffer.from(sessionId, 'utf-8');
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  return Buffer.concat([
    frameHeader(),
    u32(eventId),
    u32(sid.length),
    sid,
    u32(body.length),
    body,
  ]);
}

interface ParsedFrame {
  event: number;
  sessionId: string | null;
  payload: Buffer;
  payloadJson: Record<string, unknown> | null;
}

function parseFrame(buf: Buffer): ParsedFrame {
  const msgType = (buf[1] >> 4) & 0x0f;
  const flags = buf[1] & 0x0f;
  let off = 4;
  // event id always present in V3 (flag 0x4 means event-number-present)
  const event = buf.readUInt32BE(off);
  off += 4;
  let sessionId: string | null = null;
  // msg_type 0b0001 / 0b1001 / 0b1011 carry session_id (per Python demo parse logic)
  if ([0b0001, 0b1001, 0b1011].includes(msgType)) {
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

async function trySpeaker(speaker: string): Promise<{ ok: boolean; audioBytes: number; info: string }> {
  return new Promise((resolve) => {
    const requestId = randomUUID();
    const sessionId = randomUUID();
    let audioBytes = 0;
    let info = '';
    let settled = false;
    const finish = (ok: boolean, msg: string) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* noop */ }
      resolve({ ok, audioBytes, info: msg });
    };

    const ws = new WebSocket(ENDPOINT, {
      headers: {
        'X-Api-App-Key': APP_KEY,
        'X-Api-Key': ACCESS_KEY, // 新版控制台: X-Api-Key (不是 X-Api-Access-Key)
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-Connect-Id': requestId,
      },
    });

    const timeout = setTimeout(() => finish(false, 'timeout 8s'), 8000);

    ws.on('open', () => {
      ws.send(frameNoSession(EVENT.START_CONNECTION, {}));
    });

    ws.on('message', (data: Buffer) => {
      const f = parseFrame(data);
      switch (f.event) {
        case EVENT.CONNECTION_STARTED:
          ws.send(
            frameWithSession(
              EVENT.START_SESSION,
              sessionId,
              {
                event: EVENT.START_SESSION,
                req_params: {
                  speaker,
                  audio_params: { format: 'mp3', sample_rate: 24000 },
                },
              },
            ),
          );
          break;
        case EVENT.SESSION_STARTED:
          ws.send(
            frameWithSession(
              EVENT.TASK_REQUEST,
              sessionId,
              { event: EVENT.TASK_REQUEST, req_params: { text: '你好,这是测试。' } },
            ),
          );
          ws.send(
            frameWithSession(EVENT.FINISH_SESSION, sessionId, { event: EVENT.FINISH_SESSION }),
          );
          break;
        case EVENT.TTS_RESPONSE:
          audioBytes += f.payload.length;
          break;
        case EVENT.TTS_SENTENCE_START:
          if (!info) info = `sentence_start ${JSON.stringify(f.payloadJson).slice(0, 80)}`;
          break;
        case EVENT.SESSION_FINISHED:
          clearTimeout(timeout);
          finish(audioBytes > 0, `${info} | audio=${audioBytes}B`);
          break;
        case EVENT.SESSION_FAILED:
        case EVENT.CONNECTION_FAILED:
          clearTimeout(timeout);
          finish(false, `failed event=${f.event} payload=${JSON.stringify(f.payloadJson).slice(0, 200)}`);
          break;
        default:
          // 其他事件忽略
          break;
      }
    });

    ws.on('error', (e) => {
      clearTimeout(timeout);
      finish(false, `ws error: ${e.message.slice(0, 120)}`);
    });
  });
}

async function main(): Promise<void> {
  console.log(`app_key=${APP_KEY} access_key=${ACCESS_KEY.slice(0, 8)}... resource=${RESOURCE_ID}`);
  console.log(`Probing ${SPEAKERS.length} speakers on V3 WS bidirection...\n`);

  let firstSuccess: string | null = null;
  for (const speaker of SPEAKERS) {
    const r = await trySpeaker(speaker);
    const tag = r.ok ? '✓' : '✗';
    console.log(`  ${tag} speaker=${speaker.padEnd(42)} :: ${r.info}`);
    if (r.ok && !firstSuccess) firstSuccess = speaker;
  }

  console.log('\n--- summary ---');
  if (firstSuccess) {
    console.log(`FIRST SUCCESS: speaker=${firstSuccess}`);
    console.log(`→ Set in .env: VOLC_TTS_SPEAKER=${firstSuccess}`);
  } else {
    console.log('NO SUCCESS — all speakers failed.');
    console.log('Likely causes:');
    console.log('  1. VOLC_API_KEY is ASR-only (need separate TTS access key from console)');
    console.log('  2. Resource-Id mismatch (try volc.service_type.10028 / 10030)');
    console.log('  3. No voice activated in console → control panel 语音合成大模型 → 音色管理');
  }
}

void main();
