import { Module } from '@nestjs/common';
import { TtsService } from './tts.service';
import { TtsPipelineService } from './tts-pipeline.service';

@Module({
  providers: [TtsService, TtsPipelineService],
  exports: [TtsService, TtsPipelineService],
})
export class TtsModule {}
