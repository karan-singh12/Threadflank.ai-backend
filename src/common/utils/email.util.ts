import * as nodemailer from 'nodemailer';

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  /** Plain-text alternative; derived from the HTML when omitted. */
  text?: string;
  replyTo?: string;
}

/**
 * SMTP settings come from SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS, or from
 * SERVICE (a nodemailer well-known service such as "gmail") with SMTP_USER / SMTP_PASS. The older
 * HOST / EMAIL_PORT / EMAIL / PASS names still work as fallbacks.
 */
function readSmtpConfig() {
  const user = process.env.SMTP_USER || process.env.EMAIL || '';
  const pass = process.env.SMTP_PASS || process.env.PASS || '';
  const service = process.env.SERVICE || '';
  const host = process.env.SMTP_HOST || process.env.HOST || '';
  const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587);
  // Port 465 is implicit TLS; other ports start plain and upgrade with STARTTLS.
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
  return { user, pass, service, host, port, secure };
}

let transporter: nodemailer.Transporter | null = null;

/** True once credentials and either a host or a service are set, i.e. outgoing mail can be sent. */
export function isEmailConfigured(): boolean {
  if (usesHttpApi()) return true;
  const { user, pass, service, host } = readSmtpConfig();
  return !!(user && pass && (service || host));
}

/**
 * Hosts such as Render's free tier block outbound SMTP ports (25/465/587), so SMTP times out
 * there. With RESEND_API_KEY set, mail goes through Resend's HTTPS API instead.
 */
export function usesHttpApi(): boolean {
  return !!process.env.RESEND_API_KEY;
}

async function sendViaResend(message: { from?: string; to: string | string[]; subject: string; html: string; text: string; replyTo?: string }): Promise<string> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: message.from,
      to: Array.isArray(message.to) ? message.to : [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: message.replyTo,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new Error(`Resend API error ${res.status}: ${body.message ?? 'request failed'}`);
  return body.id ?? '';
}

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;
  if (!isEmailConfigured()) {
    throw new Error('Mailer is not configured (set SMTP_HOST, SMTP_USER and SMTP_PASS, or SERVICE with SMTP_USER and SMTP_PASS)');
  }

  const { user, pass, service, host, port, secure } = readSmtpConfig();
  transporter = nodemailer.createTransport({
    ...(service ? { service } : { host, port, secure }),
    auth: { user, pass },
    // Generous limits: connecting to Gmail from a cloud host can take longer than a few seconds.
    connectionTimeout: 60_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
  return transporter;
}

/** Opens a connection and authenticates without sending anything; use it to check SMTP settings. */
export async function verifyEmailTransport(): Promise<void> {
  if (usesHttpApi()) return;
  await getTransporter().verify();
}

const htmlToText = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>|<\/(p|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Network-level failures that are worth one more try; auth and address errors are not. */
const isTransient = (error: unknown) =>
  ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EDNS'].includes((error as { code?: string })?.code ?? '');

/** Sends one email over SMTP through nodemailer, retrying once on a transient connection error. Returns the message id. */
export async function sendEmail({ to, subject, html, text, replyTo }: SendEmailInput): Promise<string> {
  const message = {
    from: process.env.MAIL_FROM || readSmtpConfig().user,
    to,
    subject,
    html,
    text: text ?? htmlToText(html),
    replyTo,
  };

  if (usesHttpApi()) return sendViaResend(message);

  try {
    return (await getTransporter().sendMail(message)).messageId;
  } catch (error) {
    if (!isTransient(error)) throw error;
    return (await getTransporter().sendMail(message)).messageId;
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Shared ThreadFlank email shell: heading, body copy and one call-to-action button. */
function emailLayout(opts: { heading: string; greeting: string; body: string; cta: string; url: string; footnote: string }): string {
  const url = escapeHtml(opts.url);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#0b0a14;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#16142a;border-radius:16px;padding:32px;">
        <tr><td style="font-size:22px;font-weight:700;color:#ffffff;padding-bottom:20px;">Thread<span style="color:#7c5cff;">Flank</span></td></tr>
        <tr><td style="font-size:18px;font-weight:600;color:#ffffff;padding-bottom:12px;">${opts.heading}</td></tr>
        <tr><td style="font-size:14px;line-height:22px;color:#c9c7de;padding-bottom:24px;">${escapeHtml(opts.greeting)}<br/><br/>${opts.body}</td></tr>
        <tr><td style="padding-bottom:24px;"><a href="${url}" style="display:inline-block;background:#6645eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:999px;">${opts.cta}</a></td></tr>
        <tr><td style="font-size:12px;line-height:18px;color:#8f8cab;">If the button doesn't work, copy this link into your browser:<br/><a href="${url}" style="color:#a99bff;word-break:break-all;">${url}</a><br/><br/>${opts.footnote}</td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
}

export function verificationEmailHtml(opts: { name?: string | null; url: string; expiresInHours: number }): string {
  return emailLayout({
    heading: 'Verify your email',
    greeting: `Hi ${opts.name || 'there'},`,
    body: `Welcome to ThreadFlank! Confirm your email address to activate your account. This link expires in ${opts.expiresInHours} hours.`,
    cta: 'Verify email',
    url: opts.url,
    footnote: "If you didn't create a ThreadFlank account, you can ignore this email.",
  });
}

export function passwordResetEmailHtml(opts: { name?: string | null; url: string; expiresInMinutes: number }): string {
  return emailLayout({
    heading: 'Reset your password',
    greeting: `Hi ${opts.name || 'there'},`,
    body: `We received a request to reset your ThreadFlank password. This link expires in ${opts.expiresInMinutes} minutes.`,
    cta: 'Reset password',
    url: opts.url,
    footnote: "If you didn't ask for this, you can ignore this email — your password won't change.",
  });
}
