import { Module } from '@nestjs/common';
import { AsrSessionFactory } from './asr-session.factory';
import { SessionManager } from './session-manager.service';

@Module({
  providers: [AsrSessionFactory, SessionManager],
  exports: [AsrSessionFactory, SessionManager],
})
export class AsrModule {}
