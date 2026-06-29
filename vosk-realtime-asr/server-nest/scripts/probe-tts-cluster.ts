/**
 * 探测正确的 TTS cluster — 遍历社区常见的 cluster 名, 找到能返回 code=3000 的那一个.
 * 用法: npx ts-node scripts/probe-tts-cluster.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APP_ID = process.env.VOLC_TTS_APP_ID ?? '';
const ACCESS_TOKEN = process.env.VOLC_TTS_ACCESS_TOKEN ?? '';
const SECRET_KEY = process.env.VOLC_TTS_SECRET_KEY ?? '';
const ENDPOINT =
  process.env.VOLC_TTS_ENDPOINT ?? 'https://openspeech.bytedance.com/api/v1/tts';
const VOICE = process.env.VOLC_TTS_VOICE_TYPE ?? 'BV001_streaming';
const RESOURCE_ID =
  process.env.VOLC_TTS_RESOURCE_ID ?? 'volc.service_type.10054';

// 候选 cluster — 见 docs/6561/1257584 + 社区资料
const CANDIDATES = [
  'volcano_tts',
  'volcano_icl',
  'volcano_mega',
  'speech_05_ttls',
  'volcano_tts_open',
  'cluster_will',
];

async function tryCluster(cluster: string): Promise<void> {
  const body = {
    app: { appid: APP_ID, token: ACCESS_TOKEN, cluster },
    user: { uid: 'probe' },
    audio: {
      voice_type: VOICE,
      encoding: 'mp3',
      speed_ratio: 1.0,
      volume_ratio: 1.0,
      pitch_ratio: 1.0,
    },
    request: {
      reqid: randomUUID(),
      text: '测试',
      text_type: 'plain',
      operation: 'query',
      with_frontend: 1,
      frontend_type: 'unitTson',
    },
  };
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Resource-Id': RESOURCE_ID,
        Authorization: `Bearer; ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    const txt = await resp.text();
    let info = txt;
    try {
      const j = JSON.parse(txt);
      info = `code=${j.code} message=${j.message} ${
        j.code === 3000 ? `audio=${j.data?.length ?? 0} chars` : ''
      }`;
    } catch {
      /* keep raw */
    }
    console.log(`  [${cluster}] http=${resp.status} :: ${info.slice(0, 150)}`);
  } catch (e) {
    console.log(`  [${cluster}] ERROR ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  if (!APP_ID || !ACCESS_TOKEN) {
    console.error('missing VOLC_TTS_APP_ID / ACCESS_TOKEN');
    process.exit(1);
  }
  console.log(
    `appid=${APP_ID} token=${ACCESS_TOKEN.slice(0, 6)}... voice=${VOICE} secret_key_set=${!!SECRET_KEY}`,
  );
  console.log(`Trying ${CANDIDATES.length} cluster candidates...\n`);
  for (const c of CANDIDATES) {
    await tryCluster(c);
  }
}

void main();
