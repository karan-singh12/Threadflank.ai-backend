import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { Brand, BrandAccount } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BrandLoginDto, RegisterBrandDto } from '../dto/brand-common.dto';
import { BRAND_AUTH, BrandJwtStrategy } from './brand-jwt.strategy';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const INVALID_CREDENTIALS = 'Invalid email or password.';
const FREE_WELCOME_CREDITS = 100;

@Injectable()
export class BrandAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandJwt: BrandJwtStrategy,
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
      themeAccent: social.themeAccent ?? '#6342f0',
      announcementText: social.announcementText ?? '',
      websiteUrl: brand.websiteUrl ?? '',
      physicalStoreAddress: social.flagshipAddress ?? '',
      isOnlineOnly: social.isOnlineOnly ?? !social.flagshipAddress,
      followersCount: 0,
      aiCredits: social.aiCredits ?? 0,
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

  async register(dto: RegisterBrandDto, meta: RequestMeta) {
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

    const tokens = await this.issueTokenPair(account, meta);
    return { ...tokens, account: this.accountView(account), brand: this.toProfile(brand) };
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
    if (!account.isActive || account.brand.isDeleted || account.brand.status !== 'ACTIVE') {
      throw new ForbiddenException('This brand account is disabled. Contact Threadflank support.');
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
    if (!account || !account.isActive || account.brand.isDeleted || account.brand.status !== 'ACTIVE') {
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
}
