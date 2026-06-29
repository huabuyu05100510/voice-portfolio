/**
 * ConfigService — 集中读取环境变量, 启动时校验必填项
 * 对应 Python 端的 server/config.py
 */
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ConfigService {
  private readonly logger = new Logger('Config');

  readonly host = process.env.HOST ?? '0.0.0.0';
  readonly port = parseInt(process.env.PORT ?? '5001', 10);
  readonly logLevel = process.env.LOG_LEVEL ?? 'info';
  readonly prometheusPort = parseInt(process.env.PROMETHEUS_PORT ?? '9092', 10);

  // ASR
  readonly volcApiKey = process.env.VOLC_API_KEY ?? '';
  readonly volcAppKey = process.env.VOLC_APP_KEY ?? '';
  readonly volcAccessToken = process.env.VOLC_ACCESS_TOKEN ?? '';
  readonly volcResourceId =
    process.env.VOLC_RESOURCE_ID ?? 'volc.seedasr.sauc.duration';
  readonly volcModelName = process.env.VOLC_MODEL_NAME ?? 'bigmodel';
  readonly volcEndpoint =
    process.env.VOLC_ENDPOINT ??
    'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';

  // TTS — V3 WS 双向流式 (doc 1329505)
  // 鉴权: X-Api-App-Key + X-Api-Key (新版控制台 UUID 形式 API Key)
  // 注: 与 ASR 共用 VOLC_APP_KEY + VOLC_API_KEY 即可, 同一个 API Key 同时具备 ASR+TTS 权限.
  // 如需独立 TTS key, 用 VOLC_TTS_API_KEY 覆盖.
  readonly ttsApiKey = process.env.VOLC_TTS_API_KEY ?? this.volcApiKey;
  readonly ttsSpeaker =
    process.env.VOLC_TTS_SPEAKER ?? 'zh_male_M392_conversation_wvae_bigtts';
  readonly ttsResourceId =
    process.env.VOLC_TTS_RESOURCE_ID ?? 'volc.service_type.10029';
  readonly ttsEndpoint =
    process.env.VOLC_TTS_ENDPOINT ??
    'wss://openspeech.bytedance.com/api/v3/tts/bidirection';
  readonly ttsEnabled = (process.env.TTS_ENABLED ?? 'true').toLowerCase() !== 'false';
  readonly ttsTimeoutMs = parseInt(process.env.TTS_TIMEOUT_MS ?? '5000', 10);
  readonly ttsCacheSize = parseInt(process.env.TTS_CACHE_SIZE ?? '200', 10);

  /** 启动时打印配置摘要, 校验致命缺失 */
  validate(): void {
    const hasAsrAuth = !!this.volcApiKey || (!!this.volcAppKey && !!this.volcAccessToken);
    if (!hasAsrAuth) {
      this.logger.warn(
        'ASR auth missing: set VOLC_API_KEY (new console) or VOLC_APP_KEY+VOLC_ACCESS_TOKEN (legacy)',
      );
    }
    if (this.ttsEnabled) {
      if (!this.ttsApiKey || !this.volcAppKey) {
        this.logger.warn(
          'TTS enabled but VOLC_APP_KEY/VOLC_API_KEY missing — TTS will be disabled at runtime',
        );
      }
    }
    this.logger.log(
      `endpoint=${this.volcEndpoint} resource=${this.volcResourceId} model=${this.volcModelName} tts=${this.ttsEnabled}`,
    );
  }

  /** TTS 是否真的可用 (配置齐全 + 开关) */
  get ttsUsable(): boolean {
    return this.ttsEnabled && !!this.ttsApiKey && !!this.volcAppKey;
  }
}
