import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './logger/logger.module';
import { MetricsModule } from './metrics/metrics.module';
import { AsrModule } from './asr/asr.module';
import { TtsModule } from './tts/tts.module';
import { GatewayModule } from './gateway/gateway.module';
import { MetricsController } from './metrics/metrics.controller';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    MetricsModule,
    AsrModule,
    TtsModule,
    GatewayModule,
  ],
  controllers: [MetricsController],
})
export class AppModule {}
