import { Injectable, OnModuleInit } from '@nestjs/common';
import { AppLogger } from '../logger/logger.service';
import { isEmailConfigured, sendEmail, verifyEmailTransport, type SendEmailInput } from '../../common/utils/email.util';

export type SendMailInput = SendEmailInput;

/**
 * Nest wrapper around the nodemailer util in common/utils/email.util.ts, reused by
 * admin-auth (password reset), email-templates (preview/send-test) and user auth.
 */
@Injectable()
export class MailerService implements OnModuleInit {
  constructor(private readonly logger: AppLogger) {}

  onModuleInit() {
    if (!isEmailConfigured()) {
      this.logger.warn('MailerService', 'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS) — outgoing email is disabled until set');
      return;
    }

    // Check the SMTP login at startup so a wrong password shows in the logs, not on a user's signup.
    verifyEmailTransport().then(
      () => this.logger.info('MailerService', 'SMTP connection verified'),
      (error) => this.logger.error('MailerService', 'SMTP connection check failed', error),
    );
  }

  async send(input: SendMailInput): Promise<void> {
    try {
      await sendEmail(input);
    } catch (error) {
      this.logger.error('MailerService', `Failed to send email to ${input.to}`, error);
      throw error;
    }
  }
}
