import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Brand, BrandAccount, BrandAuthTokenPurpose } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BrandLoginDto, RegisterBrandDto } from '../dto/brand-common.dto';
import { BRAND_AUTH, BrandJwtStrategy } from './brand-jwt.strategy';
import { MailerService } from '../../../shared/mailer/mailer.service';
import { assertPlanRoom } from '../billing/plans';
import { AppLogger } from '../../../shared/logger/logger.service';
import { passwordResetEmailHtml, verificationEmailHtml } from '../../../common/utils/email.util';

const INVITE_EXPIRY_HOURS = 72;
const escapeHtml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const INVALID_CREDENTIALS = 'Invalid email or password.';
const FREE_WELCOME_CREDITS = 100;
const VERIFY_EMAIL_EXPIRY_HOURS = Number(process.env.VERIFY_EMAIL_EXPIRY_HOURS || 24);
const RESET_PASSWORD_EXPIRY_MIN = Number(process.env.BRAND_PASSWORD_RESET_EXPIRES_MIN || 30);
const MSG_NOT_VERIFIED = 'Please verify your email before logging in. Check your inbox for the link.';
const MSG_DISABLED = 'This brand account is disabled. Contact Threadflank support.';
const MSG_LINK_INVALID = 'This link is invalid or has expired.';

@Injectable()
export class BrandAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandJwt: BrandJwtStrategy,
    private readonly mailer: MailerService,
    private readonly logger: AppLogger,
  ) {}

  /** The shape the brand panel reads. Values with no data source yet are 0/empty, not invented. */
  toProfile(brand: Brand) {
    const social = (brand.socialLinks as Record<string, any> | null) ?? {};
    return {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      logo: brand.logoUrl ?? '',
      banner: social.banner ?? '',
      story: brand.description ?? '',
      verified: brand.isVerified,
      /** PENDING = email-verified brand awaiting admin approval; hidden from shoppers until ACTIVE. */
      status: brand.status,
      themeAccent: social.themeAccent ?? '#6342f0',
      announcementText: social.announcementText ?? '',
      websiteUrl: brand.websiteUrl ?? '',
      physicalStoreAddress: social.flagshipAddress ?? '',
      isOnlineOnly: social.isOnlineOnly ?? !social.flagshipAddress,
      followersCount: 0,
      aiCredits: social.aiCredits ?? 0,
      gstin: brand.gstin ?? '',
      currentRank: 0,
      totalBrands: 0,
      rankScore: social.rankScore ?? 0,
      widgetKey: brand.widgetKey,
      widgetEnabled: brand.widgetEnabled,
    };
  }

  async getProfile(brandId: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand || brand.isDeleted) throw new NotFoundException('Brand not found.');
    return this.toProfile(brand);
  }

  private accountView(account: BrandAccount) {
    return { id: account.id, email: account.email, name: account.name, role: account.role };
  }

  private async issueTokenPair(account: BrandAccount, meta: RequestMeta) {
    const payload = { brandAccountId: account.id, brandId: account.brandId, email: account.email, role: account.role, typ: 'brand' as const };
    const [accessToken, refreshToken] = await Promise.all([this.brandJwt.signAccessToken(payload), this.brandJwt.signRefreshToken(payload)]);
    await this.prisma.brandRefreshToken.create({
      data: {
        brandAccountId: account.id,
        tokenHash: hashToken(refreshToken),
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
        expiresAt: new Date(Date.now() + BRAND_AUTH.refreshTokenExpiryMs),
      },
    });
    return { accessToken, refreshToken };
  }

  async register(dto: RegisterBrandDto) {
    const email = dto.email.trim().toLowerCase();
    const slug = (dto.slug?.trim() || dto.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    if (!slug) throw new BadRequestException('Enter a brand name using letters or numbers.');

    if (await this.prisma.brandAccount.findUnique({ where: { email } })) {
      throw new ConflictException('An account with this email already exists. Sign in instead.');
    }
    if (await this.prisma.brand.findUnique({ where: { slug } })) {
      throw new ConflictException(`A brand named "${dto.name}" already exists. Choose a different name or link.`);
    }

    const password = await bcrypt.hash(dto.password, 10);
    const { brand, account } = await this.prisma.$transaction(async (tx) => {
      const brand = await tx.brand.create({
        data: {
          name: dto.name.trim(),
          slug,
          category: dto.category || null,
          websiteUrl: dto.websiteUrl || null,
          isVerified: false,
          status: 'PENDING',
          widgetEnabled: true,
          socialLinks: {
            workEmail: email,
            flagshipAddress: dto.physicalStoreAddress || '',
            themeAccent: '#7c5cff',
            aiCredits: FREE_WELCOME_CREDITS,
            rankScore: 0,
          },
        },
      });
      const account = await tx.brandAccount.create({
        data: { brandId: brand.id, email, password, name: dto.name.trim(), role: 'OWNER' },
      });
      return { brand, account };
    });

    await this.sendVerificationEmail(account, brand.name);
    this.notifyStaffOfApplication(brand.name, account.email);
    // No session yet: the brand must open the emailed link first.
    return { requiresVerification: true as const, email: account.email, brand: { name: brand.name } };
  }

  async login(dto: BrandLoginDto, meta: RequestMeta) {
    const account = await this.prisma.brandAccount.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      include: { brand: true },
    });
    // One message for unknown email and wrong password, so this can't be used to probe accounts.
    if (!account || !(await bcrypt.compare(dto.password, account.password))) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (!account.emailVerified) throw new ForbiddenException(MSG_NOT_VERIFIED);
    // PENDING (awaiting admin approval) may sign in and work; only a disabled brand may not.
    if (!account.isActive || account.brand.isDeleted || account.brand.status === 'INACTIVE') {
      throw new ForbiddenException(MSG_DISABLED);
    }

    const tokens = await this.issueTokenPair(account, meta);
    await this.prisma.brandAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    return { ...tokens, account: this.accountView(account), brand: this.toProfile(account.brand) };
  }

  async refresh(refreshToken: string, meta: RequestMeta) {
    const payload = await this.brandJwt.verifyRefreshToken(refreshToken);
    const stored = await this.prisma.brandRefreshToken.findFirst({
      where: { brandAccountId: payload.brandAccountId, tokenHash: hashToken(refreshToken), revokedAt: null },
    });
    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired. Please sign in again.');
    }
    const account = await this.prisma.brandAccount.findUnique({ where: { id: payload.brandAccountId }, include: { brand: true } });
    if (!account || !account.isActive || !account.emailVerified || account.brand.isDeleted || account.brand.status === 'INACTIVE') {
      throw new UnauthorizedException('Refresh token is invalid or expired. Please sign in again.');
    }
    // Rotate: the used refresh token can never be replayed.
    await this.prisma.brandRefreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issueTokenPair(account, meta);
  }

  async logout(refreshToken: string) {
    await this.prisma.brandRefreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(brandAccountId: string, brandId: string) {
    const account = await this.prisma.brandAccount.findUnique({ where: { id: brandAccountId } });
    if (!account || !account.isActive || account.brandId !== brandId) throw new UnauthorizedException('Sign in to continue.');
    return { account: this.accountView(account), brand: await this.getProfile(brandId) };
  }

  // ─── Emailed links: verify email, reset password ───────────────────────────

  private async createToken(brandAccountId: string, purpose: BrandAuthTokenPurpose, ttlMs: number) {
    const raw = randomBytes(32).toString('hex');
    await this.prisma.brandAuthToken.create({
      data: { brandAccountId, purpose, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return raw;
  }

  private async consumeToken(raw: string, purpose: BrandAuthTokenPurpose) {
    const record = await this.prisma.brandAuthToken.findFirst({
      where: { tokenHash: hashToken(raw), purpose, usedAt: null },
    });
    if (!record || record.expiresAt < new Date()) throw new BadRequestException(MSG_LINK_INVALID);
    return record;
  }

  private sendInBackground(label: string, link: string, mail: { to: string; subject: string; html: string }) {
    // Not awaited, so a slow mail server never holds up the response. The link is logged for local testing.
    this.mailer.send(mail).catch((error) => {
      this.logger.warn('BrandAuthService', `${label} email not delivered — dev link: ${link}`);
      this.logger.error('BrandAuthService', `Failed to send ${label} email`, error);
    });
  }

  private async sendVerificationEmail(account: { id: string; email: string }, brandName: string) {
    const raw = await this.createToken(account.id, 'EMAIL_VERIFY', VERIFY_EMAIL_EXPIRY_HOURS * 3_600_000);
    const base = (process.env.BRAND_EMAIL_VERIFY_URL || 'http://localhost:3000/verify-email').replace(/\/+$/, '');
    const url = `${base}/${raw}`;
    this.sendInBackground('verification', url, {
      to: account.email,
      subject: 'Verify your Threadflank brand email',
      html: verificationEmailHtml({ name: brandName, url, expiresInHours: VERIFY_EMAIL_EXPIRY_HOURS }),
    });
  }

  async verifyEmail(token: string) {
    const record = await this.consumeToken(token, 'EMAIL_VERIFY');
    await this.prisma.$transaction([
      this.prisma.brandAccount.update({ where: { id: record.brandAccountId }, data: { emailVerified: true } }),
      this.prisma.brandAuthToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
  }

  async resendVerification(email: string) {
    const account = await this.prisma.brandAccount.findUnique({ where: { email: email.trim().toLowerCase() }, include: { brand: true } });
    // Same silent outcome for unknown or already-verified emails, so this can't be used to probe accounts.
    if (!account || account.emailVerified) return;
    await this.sendVerificationEmail(account, account.brand.name);
  }

  async forgotPassword(email: string) {
    const account = await this.prisma.brandAccount.findUnique({ where: { email: email.trim().toLowerCase() }, include: { brand: true } });
    if (!account || !account.isActive) return; // always the same response
    const raw = await this.createToken(account.id, 'PASSWORD_RESET', RESET_PASSWORD_EXPIRY_MIN * 60_000);
    const base = (process.env.BRAND_PASSWORD_RESET_URL || 'http://localhost:3000/reset-password').replace(/\/+$/, '');
    const url = `${base}/${raw}`;
    this.sendInBackground('password reset', url, {
      to: account.email,
      subject: 'Reset your Threadflank brand password',
      html: passwordResetEmailHtml({ name: account.brand.name, url, expiresInMinutes: RESET_PASSWORD_EXPIRY_MIN }),
    });
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.consumeToken(token, 'PASSWORD_RESET');
    const password = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      // Following the emailed link also proves the inbox, so the email counts as verified.
      this.prisma.brandAccount.update({ where: { id: record.brandAccountId }, data: { password, emailVerified: true } }),
      this.prisma.brandAuthToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Sign out every device still holding sessions from the old password.
      this.prisma.brandRefreshToken.updateMany({ where: { brandAccountId: record.brandAccountId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  /** Best effort: tell the team a brand applied. Set ADMIN_NOTIFY_EMAIL (comma-separated) to turn it on. */
  private notifyStaffOfApplication(brandName: string, workEmail: string) {
    const to = (process.env.ADMIN_NOTIFY_EMAIL ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    for (const address of to) {
      this.mailer
        .send({ to: address, subject: `New brand application: ${brandName}`, html: `<p><b>${escapeHtml(brandName)}</b> (${escapeHtml(workEmail)}) applied to join Threadflank and is waiting for review in the admin panel, under Brands &gt; Brand Portal.</p>` })
        .catch((e) => this.logger.warn('BrandAuthService', `Staff notification not delivered: ${e?.message ?? e}`));
    }
  }

  // ─── Signed-in account: change password ────────────────────────────────────

  async changePassword(brandAccountId: string, currentPassword: string, newPassword: string) {
    const account = await this.prisma.brandAccount.findUnique({ where: { id: brandAccountId } });
    if (!account || !account.isActive) throw new UnauthorizedException('Sign in to continue.');
    if (!(await bcrypt.compare(currentPassword, account.password))) throw new BadRequestException('Your current password is not correct.');
    if (await bcrypt.compare(newPassword, account.password)) throw new BadRequestException('Choose a password you have not used just now.');
    const password = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.brandAccount.update({ where: { id: brandAccountId }, data: { password } }),
      // Every device, including this one, signs in again with the new password.
      this.prisma.brandRefreshToken.updateMany({ where: { brandAccountId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  // ─── Team: the owner invites teammates ─────────────────────────────────────

  private async requireOwner(brandAccountId: string, brandId: string) {
    const me = await this.prisma.brandAccount.findUnique({ where: { id: brandAccountId } });
    if (!me || !me.isActive || me.brandId !== brandId) throw new UnauthorizedException('Sign in to continue.');
    if (me.role !== 'OWNER') throw new ForbiddenException('Only the brand owner can manage the team.');
    return me;
  }

  async listTeam(brandId: string) {
    const rows = await this.prisma.brandAccount.findMany({ where: { brandId }, orderBy: { createdAt: 'asc' } });
    return rows.map((a) => ({ id: a.id, name: a.name, email: a.email, role: a.role, isActive: a.isActive, pending: !a.emailVerified, lastLoginAt: a.lastLoginAt?.toISOString() ?? null }));
  }

  private async sendInvite(account: { id: string; email: string; name: string }, brandName: string, inviterName: string) {
    const raw = await this.createToken(account.id, 'PASSWORD_RESET', INVITE_EXPIRY_HOURS * 3_600_000);
    const base = (process.env.BRAND_PASSWORD_RESET_URL || 'http://localhost:3000/reset-password').replace(/\/+$/, '');
    const url = `${base}/${raw}`;
    this.sendInBackground('team invite', url, {
      to: account.email,
      subject: `${inviterName} invited you to ${brandName} on Threadflank`,
      html: `<p>Hi ${escapeHtml(account.name)},</p><p>${escapeHtml(inviterName)} added you to the <b>${escapeHtml(brandName)}</b> brand panel on Threadflank. Choose a password to get started:</p><p><a href="${url}">Set your password</a></p><p>This link works for ${INVITE_EXPIRY_HOURS} hours.</p>`,
    });
  }

  async inviteMember(brandAccountId: string, brandId: string, input: { email: string; name: string; role?: 'MANAGER' | 'VIEWER' }) {
    const owner = await this.requireOwner(brandAccountId, brandId);
    await assertPlanRoom(this.prisma, brandId, 'team');
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.brandAccount.findUnique({ where: { email } })) throw new ConflictException('That email already has a Threadflank brand account.');
    const brand = await this.prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
    // The invitee never sees this: they set their own password from the emailed link.
    const password = await bcrypt.hash(randomBytes(24).toString('hex'), 10);
    const member = await this.prisma.brandAccount.create({ data: { brandId, email, password, name: input.name.trim(), role: input.role === 'VIEWER' ? 'VIEWER' : 'MANAGER' } });
    await this.sendInvite(member, brand.name, owner.name);
    return { id: member.id, name: member.name, email: member.email, role: member.role, isActive: member.isActive, pending: true, lastLoginAt: null };
  }

  async resendInvite(brandAccountId: string, brandId: string, memberId: string) {
    const owner = await this.requireOwner(brandAccountId, brandId);
    const member = await this.prisma.brandAccount.findFirst({ where: { id: memberId, brandId } });
    if (!member) throw new NotFoundException('Team member not found.');
    if (member.emailVerified) throw new BadRequestException('This person has already joined.');
    const brand = await this.prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
    await this.sendInvite(member, brand.name, owner.name);
  }

  /** Changes a teammate's role. Their sessions are ended so the new role applies the next time they sign in. */
  async setMemberRole(brandAccountId: string, brandId: string, memberId: string, role: 'MANAGER' | 'VIEWER') {
    await this.requireOwner(brandAccountId, brandId);
    const member = await this.prisma.brandAccount.findFirst({ where: { id: memberId, brandId } });
    if (!member) throw new NotFoundException('Team member not found.');
    if (member.role === 'OWNER') throw new ForbiddenException('The owner' + "'" + 's role cannot be changed.');
    await this.prisma.brandAccount.update({ where: { id: memberId }, data: { role } });
    await this.prisma.brandRefreshToken.updateMany({ where: { brandAccountId: memberId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { id: memberId, role };
  }

  async setMemberActive(brandAccountId: string, brandId: string, memberId: string, isActive: boolean) {
    await this.requireOwner(brandAccountId, brandId);
    if (memberId === brandAccountId) throw new BadRequestException('You cannot disable your own account.');
    const member = await this.prisma.brandAccount.findFirst({ where: { id: memberId, brandId } });
    if (!member) throw new NotFoundException('Team member not found.');
    if (member.role === 'OWNER') throw new ForbiddenException('The owner account cannot be disabled.');
    await this.prisma.brandAccount.update({ where: { id: memberId }, data: { isActive } });
    if (!isActive) await this.prisma.brandRefreshToken.updateMany({ where: { brandAccountId: memberId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { id: memberId, isActive };
  }
}
