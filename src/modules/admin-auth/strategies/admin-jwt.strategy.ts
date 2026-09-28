import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminJwtPayload } from '../../../common/interfaces/admin-jwt-payload.interface';
import { MESSAGES } from '../../../common/constants/messages.constant';
import { APP_CONSTANTS } from '../../../common/constants/app.constant';

/**
 * Verifies/signs Admin JWTs. Deliberately separate from the end-user
 * JwtStrategy: different secrets for access and refresh tokens, so an admin
 * token can never be produced from — or mistaken for — a user token.
 */
@Injectable()
export class AdminJwtStrategy {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(private readonly jwtService: JwtService) {
    this.accessSecret = process.env.ADMIN_JWT_SECRET || APP_CONSTANTS.adminAuth.fallbackAccessSecret;
    this.refreshSecret = process.env.ADMIN_JWT_REFRESH_SECRET || APP_CONSTANTS.adminAuth.fallbackRefreshSecret;
  }

  async signAccessToken(payload: Omit<AdminJwtPayload, 'iat' | 'exp'>): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: APP_CONSTANTS.adminAuth.accessTokenExpiry as any,
    });
  }

  async signRefreshToken(payload: Omit<AdminJwtPayload, 'iat' | 'exp'>): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.refreshSecret,
      expiresIn: APP_CONSTANTS.adminAuth.refreshTokenExpiry as any,
    });
  }

  async verifyAccessToken(token: string): Promise<AdminJwtPayload> {
    try {
      return await this.jwtService.verifyAsync<AdminJwtPayload>(token, { secret: this.accessSecret });
    } catch {
      throw new UnauthorizedException(MESSAGES.adminAuth.tokenInvalid);
    }
  }

  async verifyRefreshToken(token: string): Promise<AdminJwtPayload> {
    try {
      return await this.jwtService.verifyAsync<AdminJwtPayload>(token, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedException(MESSAGES.adminAuth.refreshInvalid);
    }
  }
}
