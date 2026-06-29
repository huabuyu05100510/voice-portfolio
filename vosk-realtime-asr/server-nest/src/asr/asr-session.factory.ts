/**
 * AsrSessionFactory — 用 ConfigService 构造 VolcengineAsrSession
 * 把 config 组装逻辑集中在一处, gateway 只关心 sid 与回调.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import {
  AsrCallbacks,
  AsrSessionConfig,
  VolcengineAsrSession,
} from './asr-session.class';

@Injectable()
export class AsrSessionFactory {
  constructor(private readonly config: ConfigService) {}

  create(sid: string, cbs: AsrCallbacks): VolcengineAsrSession {
    const cfg: AsrSessionConfig = {
      endpoint: this.config.volcEndpoint,
      appKey: this.config.volcAppKey,
      accessToken: this.config.volcAccessToken,
      apiKey: this.config.volcApiKey || undefined,
      resourceId: this.config.volcResourceId,
      modelName: this.config.volcModelName,
      enableDiarization: true,
      platform: 'Web',
    };
    return new VolcengineAsrSession(sid, cfg, cbs);
  }
}
