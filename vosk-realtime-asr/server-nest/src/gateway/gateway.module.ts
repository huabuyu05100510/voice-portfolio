import { Module } from '@nestjs/common';
import { AsrGateway } from './asr.gateway';
import { AsrModule } from '../asr/asr.module';
import { TtsModule } from '../tts/tts.module';

@Module({
  imports: [AsrModule, TtsModule],
  providers: [AsrGateway],
})
export class GatewayModule {}
