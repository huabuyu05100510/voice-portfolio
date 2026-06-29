/**
 * 端到端冒烟: 实例化真正的 TtsService (V3 WS), 调火山引擎生产 endpoint.
 * 验证: synthesize('你好, 这是测试') 返回非空 mp3 buffer.
 *
 * 用法: npx ts-node scripts/smoke-v3-tts.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { TtsService } from '../src/tts/tts.service';
import { ConfigService } from '../src/config/config.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { StructuredLogger } from '../src/logger/logger.service';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const config = new ConfigService();
config.validate();

const metrics = new MetricsService();
const log = new StructuredLogger();

const svc = new TtsService(config, metrics, log);

async function main(): Promise<void> {
  console.log(`\nendpoint=${config.ttsEndpoint}`);
  console.log(`resource=${config.ttsResourceId}`);
  console.log(`speaker=${config.ttsSpeaker}`);
  console.log(`app_key=${config.volcAppKey} api_key=${config.ttsApiKey.slice(0, 8)}...`);
  console.log(`ttsUsable=${config.ttsUsable}\n`);

  const r = await svc.synthesize('你好, 这是 V3 双向流式 TTS 的端到端冒烟测试。');
  if (!r) {
    console.error('✗ FAIL: synthesize returned null');
    process.exit(1);
  }
  const head = Array.from(r.audio.subarray(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  console.log(`✓ OK: ${r.audio.length} bytes mp3, latency=${r.latencyMs}ms, head=[${head}]`);
}

void main();
