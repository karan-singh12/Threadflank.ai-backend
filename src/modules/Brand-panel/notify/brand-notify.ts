import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailerService } from '../../../shared/mailer/mailer.service';
import { AppLogger } from '../../../shared/logger/logger.service';

/**
 * The emails a brand team can get, each one switchable in Settings. Stored on Brand.notifyPrefs;
 * anything not stored is on, so a new kind reaches existing brands without a migration.
 */
export const NOTIFY_KINDS = {
  inbox: 'A shopper sends a message',
  reviews: 'A shopper reviews a piece',
  looks: 'A shopper sends a look for your store',
  collabs: 'A creator answers or delivers a collab',
  ranking: 'Your monthly rank is final',
} as const;

export type NotifyKind = keyof typeof NOTIFY_KINDS;
export type NotifyPrefs = Record<NotifyKind, boolean>;

export function notifyPrefsOf(stored: unknown): NotifyPrefs {
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  return Object.fromEntries((Object.keys(NOTIFY_KINDS) as NotifyKind[]).map((k) => [k, s[k] !== false])) as NotifyPrefs;
}

/** Keeps only known kinds with boolean values, so the stored JSON never grows junk. */
export function cleanNotifyPrefs(input: Record<string, unknown>, current: unknown): NotifyPrefs {
  const base = notifyPrefsOf(current);
  for (const k of Object.keys(NOTIFY_KINDS) as NotifyKind[]) if (typeof input[k] === 'boolean') base[k] = input[k] as boolean;
  return base;
}

/** BRAND_PANEL_URL, else the site the verification emails already point at. */
export function brandPanelOrigin() {
  const explicit = process.env.BRAND_PANEL_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  try {
    return new URL(process.env.BRAND_EMAIL_VERIFY_URL || 'http://localhost:3000').origin;
  } catch {
    return 'http://localhost:3000';
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Emails a brand's team (owner and managers with a confirmed inbox), when the brand has that kind switched on. */
@Injectable()
export class BrandNotifyService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly mailer?: MailerService,
    @Optional() private readonly logger?: AppLogger,
  ) {}

  /** Fire and forget: the shopper's action never waits on, or fails because of, the email. */
  send(brandId: string, kind: NotifyKind, input: { subject: string; lines: string[]; path?: string }) {
    void this.deliver(brandId, kind, input).catch((err) => this.logger?.warn('BrandNotify', `Brand email (${kind}) failed: ${err?.message ?? err}`));
  }

  private async deliver(brandId: string, kind: NotifyKind, input: { subject: string; lines: string[]; path?: string }) {
    if (!this.mailer) return;
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: { name: true, notifyPrefs: true, accounts: { where: { isActive: true, emailVerified: true, role: { in: ['OWNER', 'MANAGER'] } }, select: { email: true } } },
    });
    if (!brand || !notifyPrefsOf(brand.notifyPrefs)[kind] || brand.accounts.length === 0) return;
    const base = brandPanelOrigin();
    const link = input.path ? `<p><a href="${base}${input.path}">Open in your brand panel</a></p>` : '';
    const html =
      input.lines.map((l) => `<p>${esc(l)}</p>`).join('') +
      link +
      `<p style="color:#888;font-size:12px">You get this because “${esc(NOTIFY_KINDS[kind])}” is on for ${esc(brand.name)}. Change it in Settings → Notifications.</p>`;
    for (const { email } of brand.accounts) await this.mailer.send({ to: email, subject: input.subject, html });
  }
}
