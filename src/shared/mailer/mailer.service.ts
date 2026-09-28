import { Injectable, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { AppLogger } from '../logger/logger.service';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * Thin nodemailer wrapper reused by admin-auth (password reset) and the
 * email-templates module (preview/send-test). Uses the SERVICE/EMAIL/PASS/
 * HOST/EMAIL_PORT env vars already scaffolded in .env.
 */
@Injectable()
export class MailerService implements OnModuleInit {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly logger: AppLogger) {}

  onModuleInit() {
    const host = process.env.HOST;
    const service = process.env.SERVICE;
    const user = process.env.EMAIL;
    const pass = process.env.PASS;

    if (!user || !pass) {
      this.logger.warn('MailerService', 'EMAIL/PASS not configured — outgoing email is disabled until set');
      return;
    }

    this.transporter = nodemailer.createTransport({
      service: service || undefined,
      host: !service ? host : undefined,
      port: !service && process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : undefined,
      secure: false,
      auth: { user, pass },
    });
  }

  async send(input: SendMailInput): Promise<void> {
    if (!this.transporter) {
      throw new Error('Mailer is not configured (missing EMAIL/PASS env vars)');
    }

    const from = process.env.MAIL_FROM || process.env.EMAIL;

    try {
      await this.transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
    } catch (error) {
      this.logger.error('MailerService', `Failed to send email to ${input.to}`, error);
      throw error;
    }
  }
}
