/**
 * 探测 V3 TTS 不同 resource_id / 鉴权组合 — 定位 401 根因
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APP_KEY = process.env.VOLC_APP_KEY ?? '';
const API_KEY = process.env.VOLC_API_KEY ?? ''; // ASR 的 UUID 形式
const ACCESS_TOKEN = process.env.VOLC_ACCESS_TOKEN ?? ''; // 旧 token
const TTS_TOKEN = process.env.VOLC_TTS_ACCESS_TOKEN ?? '';
const TTS_SECRET = process.env.VOLC_TTS_SECRET_KEY ?? '';
const ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';

const RESOURCE_IDS = [
  'volc.service_type.10029', // 大模型 TTS 双向流式 (官方 demo)
  'volc.service_type.10028',
  'volc.service_type.10030',
  'volc.megatts.default',
  'volc.service_type.10054', // HTTP V1 的 ID
];

interface Combo {
  label: string;
  headers: Record<string, string>;
}

function buildCombos(resourceId: string): Combo[] {
  return [
    {
      label: 'V3 X-Api (ASR keys)',
      headers: {
        'X-Api-App-Key': APP_KEY,
        'X-Api-Access-Key': API_KEY,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': randomUUID(),
      },
    },
    {
      label: 'V3 X-Api (legacy ACCESS_TOKEN)',
      headers: {
        'X-Api-App-Key': APP_KEY,
        'X-Api-Access-Key': ACCESS_TOKEN,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': randomUUID(),
      },
    },
    {
      label: 'V3 X-Api (TTS_ACCESS_TOKEN)',
      headers: {
        'X-Api-App-Key': APP_KEY,
        'X-Api-Access-Key': TTS_TOKEN,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': randomUUID(),
      },
    },
    {
      label: 'V3 Bearer + X-Api-Resource',
      headers: {
        Authorization: `Bearer; ${TTS_TOKEN}`,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': randomUUID(),
      },
    },
    {
      label: 'V3 X-Api (TTS_SECRET as access)',
      headers: {
        'X-Api-App-Key': APP_KEY,
        'X-Api-Access-Key': TTS_SECRET,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': randomUUID(),
      },
    },
  ];
}

async function tryCombo(label: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocket(ENDPOINT, { headers });
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* noop */ }
      resolve('timeout');
    }, 4000);
    ws.on('open', () => {
      clearTimeout(t);
      settled = true;
      try { ws.close(); } catch { /* noop */ }
      resolve('OPEN ✓ (auth accepted)');
    });
    ws.on('unexpected-response', (req, res) => {
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
  console.log(`app=${APP_KEY} api_key=${API_KEY.slice(0, 8)}... access=${ACCESS_TOKEN.slice(0, 6)}... tts_tok=${TTS_TOKEN.slice(0, 6)}... tts_sec=${TTS_SECRET.slice(0, 6)}...\n`);

  for (const rid of RESOURCE_IDS) {
    console.log(`=== resource_id: ${rid} ===`);
    for (const c of buildCombos(rid)) {
      const r = await tryCombo(c.label, c.headers);
      console.log(`  ${r.padEnd(36)} :: ${c.label}`);
    }
    console.log();
  }
}

void main();
