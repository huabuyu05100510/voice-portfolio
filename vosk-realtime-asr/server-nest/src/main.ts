/**
 * NestJS 服务启动入口
 *
 * 1. 启动时 ConfigService 校验环境变量
 * 2. NestFactory 启动 Express + SocketIO (gateway 自动挂载到 http server)
 * 3. TtsPipelineService 注入 SocketIO server (用于 emit tts_audio)
 *
 * 端口默认 5001 (与现有 Python 5000 不冲突, 可同时运行).
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
// 加载 .env (放在 nest 注册之前, 让 ConfigService 构造时能读到)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { StructuredLogger } from './logger/logger.service';
import { TtsPipelineService } from './tts/tts-pipeline.service';
import { Server } from 'socket.io';
import type { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  config.validate();

  // Prometheus 指标端点
  // (MetricsController 已通过 AppModule 注册, 自动挂载到 /metrics)

  // 关键: 让 TtsPipelineService 拿到 SocketIO server 实例.
  // @WebSocketGateway 的 server 会在 Nest 启动时自动填充, 但 pipeline
  // 不在 gateway 里, 这里通过 adapter.io 拿.
  await app.init();
  const io: Server = (app as any).getHttpAdapter().getInstance()?.io
    ? (app as any).getHttpAdapter().getInstance().io
    : ((app as any).getHttpAdapter().getInstance() as unknown as Server);
  const ttsPipeline = app.get(TtsPipelineService);
  ttsPipeline.attachServer(io);

  const log = app.get(StructuredLogger);
  log.log('NestJS server starting', {
    event_type: 'server_start',
    metadata: { host: config.host, port: config.port, tts_usable: config.ttsUsable },
  });

  await app.listen(config.port, config.host);
  log.log(`NestJS listening on http://${config.host}:${config.port}`, {
    event_type: 'server_listening',
  });
}

void bootstrap();
