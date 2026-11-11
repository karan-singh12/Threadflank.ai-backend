import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BrandAccountRole } from '@prisma/client';

/** Decoded brand JWT. Shaped unlike the user (`userId`) and admin (`adminUserId`) payloads. */
export interface BrandJwtPayload {
  brandAccountId: string;
  brandId: string;
  email: string;
  role: BrandAccountRole;
  typ: 'brand';
  iat?: number;
  exp?: number;
}

export type AuthenticatedBrand = BrandJwtPayload;

export const BRAND_AUTH = {
  accessTokenExpiry: process.env.BRAND_ACCESS_TOKEN_EXPIRES_IN || '15m',
  refreshTokenExpiry: process.env.BRAND_REFRESH_TOKEN_EXPIRES_IN || '7d',
  refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // used to compute BrandRefreshToken.expiresAt
};

function secret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set in production (brand panel tokens).`);
  }
  return devFallback;
}

/**
 * Signs and verifies brand JWTs with their own secrets, so a brand token can never
 * be produced from, or mistaken for, a user or admin token (same approach as AdminJwtStrategy).
 */
@Injectable()
export class BrandJwtStrategy {
  private readonly accessSecret = secret('BRAND_JWT_SECRET', 'dev-only-brand-access-secret-change-me');
  private readonly refreshSecret = secret('BRAND_JWT_REFRESH_SECRET', 'dev-only-brand-refresh-secret-change-me');

  constructor(private readonly jwt: JwtService) {}

  signAccessToken(payload: Omit<BrandJwtPayload, 'iat' | 'exp'>): Promise<string> {
    return this.jwt.signAsync(payload, { secret: this.accessSecret, expiresIn: BRAND_AUTH.accessTokenExpiry as any });
  }

  signRefreshToken(payload: Omit<BrandJwtPayload, 'iat' | 'exp'>): Promise<string> {
    return this.jwt.signAsync(payload, { secret: this.refreshSecret, expiresIn: BRAND_AUTH.refreshTokenExpiry as any });
  }

  async verifyAccessToken(token: string): Promise<BrandJwtPayload> {
    return this.verify(token, this.accessSecret, 'Your session has expired. Please sign in again.');
  }

  async verifyRefreshToken(token: string): Promise<BrandJwtPayload> {
    return this.verify(token, this.refreshSecret, 'Refresh token is invalid or expired. Please sign in again.');
  }

  private async verify(token: string, secretKey: string, message: string): Promise<BrandJwtPayload> {
    try {
      const payload = await this.jwt.verifyAsync<BrandJwtPayload>(token, { secret: secretKey });
      if (payload.typ !== 'brand' || !payload.brandId) throw new Error('wrong token type');
      return payload;
    } catch {
      throw new UnauthorizedException(message);
    }
  }
}
