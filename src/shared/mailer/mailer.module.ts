import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { AppLogger } from '../logger/logger.service';

@Module({
  providers: [MailerService, AppLogger],
  exports: [MailerService],
})
export class MailerModule {}
