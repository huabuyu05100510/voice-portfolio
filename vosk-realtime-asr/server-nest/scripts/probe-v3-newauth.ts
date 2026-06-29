/**
 * 探测 V3 TTS 新版鉴权方案 — X-Api-Key + 不同 resource_id
 * 文档 1329505 / 2277844 提示: 新版控制台只用 X-Api-Key
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APP_KEY = process.env.VOLC_APP_KEY ?? '';
const NEW_API_KEY = process.env.VOLC_TTS_API_KEY ?? 'be7a469d-3937-40ff-882a-7d72398c44c6';
const LEGACY_API_KEY = process.env.VOLC_API_KEY ?? '';
const ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';

const RESOURCE_IDS = [
  'volc.service_type.10029',
  'volc.megatts.default',
  'seed-tts',
  'seed-tts-2.0',
  'volc.service_type.10028',
];

const EVENT = {
  START_CONNECTION: 1,
  CONNECTION_STARTED: 50,
  CONNECTION_FAILED: 51,
} as const;

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function frameNoSession(eventId: number, payload: Record<string, unknown> = {}): Buffer {
  const header = Buffer.from([0x11, 0x14, 0x10, 0x00]);
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  return Buffer.concat([header, u32(eventId), u32(body.length), body]);
}

interface Combo {
  label: string;
  headers: Record<string, string>;
}

function buildCombos(rid: string): Combo[] {
  return [
    {
      label: 'X-Api-Key (new UUID key)',
      headers: {
        'X-Api-App-Key': APP_KEY,
        'X-Api-Key': NEW_API_KEY,
        'X-Api-Resource-Id': rid,
        'X-Api-Connect-Id': randomUUID(),
      },
    },
    {
      label: 'X-Api-Access-Key (new UUID key)',
      headers: {
        'X-Api-App-Key': APP_KEY,
        'X-Api-Access-Key': NEW_API_KEY,
        'X-Api-Resource-Id': rid,
        'X-Api-Connect-Id': randomUUID(),
      },
    },
    {
      label: 'X-Api-Key (legacy ASR UUID)',
      headers: {
        'X-Api-App-Key': APP_KEY,
        'X-Api-Key': LEGACY_API_KEY,
        'X-Api-Resource-Id': rid,
        'X-Api-Connect-Id': randomUUID(),
      },
    },
  ];
}

async function tryCombo(label: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    let gotData = '';
    const ws = new WebSocket(ENDPOINT, { headers });
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* noop */ }
      resolve(gotData || 'timeout');
    }, 4000);
    ws.on('open', () => {
      ws.send(frameNoSession(EVENT.START_CONNECTION, {}));
    });
    ws.on('message', (data: Buffer) => {
      // event id at offset 4
      const event = data.readUInt32BE(4);
      let payloadStr = '';
      try {
        const payloadLen = data.readUInt32BE(8);
        payloadStr = data.subarray(12, 12 + payloadLen).toString('utf-8').slice(0, 100);
      } catch { /* noop */ }
      gotData = `event=${event} ${payloadStr}`;
      if (event === EVENT.CONNECTION_STARTED) {
        clearTimeout(t);
        settled = true;
        try { ws.close(); } catch { /* noop */ }
        resolve(`CONNECTED ✓ ${payloadStr}`);
      } else if (event === EVENT.CONNECTION_FAILED) {
        clearTimeout(t);
        settled = true;
        try { ws.close(); } catch { /* noop */ }
        resolve(`FAILED event=51 ${payloadStr}`);
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(t);
      if (settled) return;
      settled = true;
      resolve(`http=${res.statusCode}`);
    });
    ws.on('error', (e) => {
      clearTimeout(t);
      if (settled) return;
      settled = true;
      resolve(`err ${(e as Error).message.slice(0, 60)}`);
    });
  });
}

async function main(): Promise<void> {
  console.log(`app=${APP_KEY} new_key=${NEW_API_KEY.slice(0, 8)}... legacy=${LEGACY_API_KEY.slice(0, 8)}...\n`);

  let firstSuccess: { rid: string; label: string } | null = null;
  for (const rid of RESOURCE_IDS) {
    console.log(`=== resource_id: ${rid} ===`);
    for (const c of buildCombos(rid)) {
      const r = await tryCombo(c.label, c.headers);
      console.log(`  ${r.padEnd(80)} :: ${c.label}`);
      if (r.startsWith('CONNECTED') && !firstSuccess) {
        firstSuccess = { rid, label: c.label };
      }
    }
    console.log();
  }

  console.log('--- summary ---');
  if (firstSuccess) {
    console.log(`✓ SUCCESS: resource_id=${firstSuccess.rid} combo="${firstSuccess.label}"`);
  } else {
    console.log('✗ All combos failed.');
  }
}

void main();
