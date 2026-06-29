/**
 * 直接调用火山引擎 TTS API 验证凭证有效性
 * 用法: npx ts-node scripts/smoke-tts.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APP_ID = process.env.VOLC_TTS_APP_ID ?? '';
const ACCESS_TOKEN = process.env.VOLC_TTS_ACCESS_TOKEN ?? '';
const SECRET_KEY = process.env.VOLC_TTS_SECRET_KEY ?? '';
const CLUSTER = process.env.VOLC_TTS_CLUSTER ?? 'volcano_tts';
const RESOURCE_ID =
  process.env.VOLC_TTS_RESOURCE_ID ?? 'volc.service_type.10054';
const ENDPOINT =
  process.env.VOLC_TTS_ENDPOINT ?? 'https://openspeech.bytedance.com/api/v1/tts';
const VOICE = process.env.VOLC_TTS_VOICE_TYPE ?? 'BV001_streaming';

async function main(): Promise<void> {
  if (!APP_ID || !ACCESS_TOKEN) {
    console.error('missing VOLC_TTS_APP_ID / ACCESS_TOKEN');
    process.exit(1);
  }
  console.log(
    `appid=${APP_ID} token=${ACCESS_TOKEN.slice(0, 6)}... cluster=${CLUSTER} voice=${VOICE}`,
  );

  const body = {
    app: { appid: APP_ID, token: ACCESS_TOKEN, cluster: CLUSTER },
    user: { uid: 'smoke-test' },
    audio: {
      voice_type: VOICE,
      encoding: 'mp3',
      speed_ratio: 1.0,
      volume_ratio: 1.0,
      pitch_ratio: 1.0,
    },
    request: {
      reqid: randomUUID(),
      text: '你好, 这是一个语音合成测试。',
      text_type: 'plain',
      operation: 'query',
      with_frontend: 1,
      frontend_type: 'unitTson',
    },
  };

  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Resource-Id': RESOURCE_ID,
      'Authorization': `Bearer; ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  console.log(`http ${resp.status}`);
  const txt = await resp.text();
  console.log(`body head: ${txt.slice(0, 200)}`);

  try {
    const json = JSON.parse(txt);
    console.log(`code=${json.code} message=${json.message}`);
    if (json.code === 3000 && json.data) {
      const buf = Buffer.from(json.data, 'base64');
      const outPath = path.resolve(__dirname, 'smoke-out.mp3');
      writeFileSync(outPath, buf);
      console.log(`wrote ${buf.length} bytes to ${outPath}`);
    } else {
      console.log('NOT OK — response code != 3000 or no data');
      console.log(`Secret key available: ${!!SECRET_KEY}`);
    }
  } catch (e) {
    console.error('JSON parse failed:', (e as Error).message);
  }
}

void main();
