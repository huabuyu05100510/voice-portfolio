/**
 * 深入探测 TTS — 尝试多种鉴权/协议变体
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APP_ID = process.env.VOLC_TTS_APP_ID ?? '';
const ACCESS_TOKEN = process.env.VOLC_TTS_ACCESS_TOKEN ?? '';
const SECRET_KEY = process.env.VOLC_TTS_SECRET_KEY ?? '';
const ENDPOINT =
  process.env.VOLC_TTS_ENDPOINT ?? 'https://openspeech.bytedance.com/api/v1/tts';
const VOICE = process.env.VOLC_TTS_VOICE_TYPE ?? 'BV001_streaming';

async function post(
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<void> {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const txt = await resp.text();
    let info = txt.slice(0, 200);
    try {
      const j = JSON.parse(txt);
      info = `code=${j.code} message=${j.message} ${
        j.code === 3000 ? `(audio ${j.data?.length ?? 0} b64chars)` : ''
      }`;
    } catch {
      /* keep raw */
    }
    console.log(`  [${label}] http=${resp.status} :: ${info}`);
  } catch (e) {
    console.log(`  [${label}] NET ERR ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log(
    `appid=${APP_ID} token=${ACCESS_TOKEN.slice(0, 6)}... secret=${SECRET_KEY.slice(0, 6)}... voice=${VOICE}`,
  );

  // 1) 标准 Bearer Token + cluster (V1 HTTP 非流式)
  await post(
    'V1+cluster',
    ENDPOINT,
    {
      'Content-Type': 'application/json',
      'Resource-Id': 'volc.service_type.10054',
      Authorization: `Bearer; ${ACCESS_TOKEN}`,
    },
    {
      app: { appid: APP_ID, token: ACCESS_TOKEN, cluster: 'volcano_tts' },
      user: { uid: 'probe' },
      audio: { voice_type: VOICE, encoding: 'mp3' },
      request: { reqid: randomUUID(), text: '测试', text_type: 'plain', operation: 'query' },
    },
  );

  // 2) 没有 cluster 字段 (新版大模型流式 — 不需要 cluster)
  await post(
    'V1 NO-cluster',
    ENDPOINT,
    {
      'Content-Type': 'application/json',
      'Resource-Id': 'volc.service_type.10054',
      Authorization: `Bearer; ${ACCESS_TOKEN}`,
    },
    {
      app: { appid: APP_ID, token: ACCESS_TOKEN },
      user: { uid: 'probe' },
      audio: { voice_type: VOICE, encoding: 'mp3' },
      request: { reqid: randomUUID(), text: '测试', text_type: 'plain', operation: 'query' },
    },
  );

  // 3) Authorization 用 access_token 前后双空格变体
  await post(
    'V1 Bearer-space',
    ENDPOINT,
    {
      'Content-Type': 'application/json',
      'Resource-Id': 'volc.service_type.10054',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    {
      app: { appid: APP_ID, token: ACCESS_TOKEN, cluster: 'volcano_tts' },
      user: { uid: 'probe' },
      audio: { voice_type: VOICE, encoding: 'mp3' },
      request: { reqid: randomUUID(), text: '测试', text_type: 'plain', operation: 'query' },
    },
  );

  // 4) HMAC256 鉴权 — 用 secret_key 签名 body
  const body = {
    app: { appid: APP_ID, token: 'access_token', cluster: 'volcano_tts' },
    user: { uid: 'probe' },
    audio: { voice_type: VOICE, encoding: 'mp3' },
    request: { reqid: randomUUID(), text: '测试', text_type: 'plain', operation: 'query' },
  };
  const bodyStr = JSON.stringify(body);
  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(bodyStr)
    .digest('hex');
  await post(
    'V1 HMAC256',
    ENDPOINT,
    {
      'Content-Type': 'application/json',
      'Resource-Id': 'volc.service_type.10054',
      Authorization: `Bearer; ${ACCESS_TOKEN}`,
      'X-Api-Resource-Key': SECRET_KEY,
      'X-Api-Access-Key': ACCESS_TOKEN,
      'X-Api-App-Key': APP_ID,
    },
    body,
  );

  // 5) 试试 OpenSpeech 小程序网关端点 (变体)
  await post(
    'V1 alt-path /api/v1/tts_async',
    'https://openspeech.bytedance.com/api/v1/tts_async',
    {
      'Content-Type': 'application/json',
      'Resource-Id': 'volc.service_type.10054',
      Authorization: `Bearer; ${ACCESS_TOKEN}`,
    },
    {
      app: { appid: APP_ID, token: ACCESS_TOKEN, cluster: 'volcano_tts' },
      user: { uid: 'probe' },
      audio: { voice_type: VOICE, encoding: 'mp3' },
      request: { reqid: randomUUID(), text: '测试', text_type: 'plain', operation: 'query' },
    },
  );
}

void main();
