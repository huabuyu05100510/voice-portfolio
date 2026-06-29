/**
 * 探测可用的 voice_type — 遍历官方音色列表 + 不同 cluster 组合
 * 用法: npx ts-node scripts/probe-tts-voices.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APP_ID = process.env.VOLC_TTS_APP_ID ?? '';
const ACCESS_TOKEN = process.env.VOLC_TTS_ACCESS_TOKEN ?? '';
const ENDPOINT =
  process.env.VOLC_TTS_ENDPOINT ?? 'https://openspeech.bytedance.com/api/v1/tts';

// 官方音色列表 (豆包大模型 TTS 常见 voice_type)
const VOICES = [
  'BV700_streaming', // 普通话女声
  'BV701_streaming', // 普通话男声
  'BV704_streaming', // 普通话女声
  'BV405_streaming', // 普通话女声
  'BV406_streaming', // 普通话男声
  'BV001_streaming', // 兼容旧版
  'BV002_streaming',
  'BV700_V2_streaming', // V2 版本
  'BV701_V2_streaming',
  'zh_female_qingxin',
  'zh_male_M392_conversation_wvae',
  'BV123_streaming',
  'BV120_streaming',
  'BV104_streaming',
];

const CLUSTERS = [
  'volcano_tts',
  'volcano_icl',
  'speech_05_ttls',
];

async function tryCombo(
  voice: string,
  cluster: string,
): Promise<{ ok: boolean; info: string }> {
  const body = {
    app: { appid: APP_ID, token: ACCESS_TOKEN, cluster },
    user: { uid: 'probe' },
    audio: { voice_type: voice, encoding: 'mp3', speed_ratio: 1.0, volume_ratio: 1.0, pitch_ratio: 1.0 },
    request: {
      reqid: randomUUID(),
      text: '你好,这是测试',
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
        'Resource-Id': 'volc.service_type.10054',
        Authorization: `Bearer; ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    const txt = await resp.text();
    try {
      const j = JSON.parse(txt);
      const ok = j.code === 3000;
      return {
        ok,
        info: ok
          ? `OK audio=${j.data?.length ?? 0} b64chars`
          : `code=${j.code} msg=${(j.message ?? '').slice(0, 80)}`,
      };
    } catch {
      return { ok: false, info: `http=${resp.status} ${txt.slice(0, 80)}` };
    }
  } catch (e) {
    return { ok: false, info: `ERR ${(e as Error).message.slice(0, 60)}` };
  }
}

async function main(): Promise<void> {
  console.log(
    `appid=${APP_ID} token=${ACCESS_TOKEN.slice(0, 6)}... endpoint=${ENDPOINT}`,
  );
  console.log(`Probing ${VOICES.length} voices × ${CLUSTERS.length} clusters = ${VOICES.length * CLUSTERS.length} combos\n`);

  let firstSuccess: { voice: string; cluster: string } | null = null;
  for (const cluster of CLUSTERS) {
    console.log(`\n=== cluster: ${cluster} ===`);
    for (const voice of VOICES) {
      const r = await tryCombo(voice, cluster);
      const tag = r.ok ? '✓' : '✗';
      console.log(`  ${tag} voice=${voice.padEnd(28)} :: ${r.info}`);
      if (r.ok && !firstSuccess) {
        firstSuccess = { voice, cluster };
      }
    }
  }

  console.log('\n--- summary ---');
  if (firstSuccess) {
    console.log(
      `FIRST SUCCESS: voice_type=${firstSuccess.voice} cluster=${firstSuccess.cluster}`,
    );
    console.log(
      `→ Set in .env: VOLC_TTS_VOICE_TYPE=${firstSuccess.voice} VOLC_TTS_CLUSTER=${firstSuccess.cluster}`,
    );
  } else {
    console.log('NO SUCCESS — all combos failed.');
    console.log('Account-level issue: see docs/2026-06-25-nestjs-rewrite-tts.md');
  }
}

void main();
