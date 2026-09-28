import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { MESSAGES } from '../../common/constants/messages.constant';
import { APP_CONSTANTS } from '../../common/constants/app.constant';
import { PrismaService } from '../../prisma/prisma.service';

/** How long a user id stays confirmed before it's looked up again. */
const KNOWN_USER_TTL_MS = 60_000;
const KNOWN_USER_CACHE_MAX = 10_000;

// Shared service to handle JWT verification consistently
@Injectable()
export class JwtStrategy {
  private readonly secret: string;
  /** User ids confirmed to exist, so most requests skip the lookup. */
  private readonly knownUsers = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {
    this.secret = process.env.JWT_SECRET || APP_CONSTANTS.jwt.fallbackSecret;
  }

  /**
   * A token outlives its account when the user is deleted or the database is
   * reset. Rejecting it (401) signs the browser out instead of failing every
   * write with a foreign-key error. Database errors propagate, so an outage is
   * a 500, not a sign-out.
   */
  private async userExists(userId: string): Promise<boolean> {
    if ((this.knownUsers.get(userId) ?? 0) > Date.now()) return true;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return false;
    if (this.knownUsers.size >= KNOWN_USER_CACHE_MAX) this.knownUsers.clear();
    this.knownUsers.set(userId, Date.now() + KNOWN_USER_TTL_MS);
    return true;
  }

  // Verifies HTTP headers token and returns payload or throws
  async verify(token: string): Promise<JwtPayload> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.secret,
      });
    } catch {
      throw new UnauthorizedException(MESSAGES.auth.tokenInvalid);
    }
    if (!(await this.userExists(payload.userId))) {
      throw new UnauthorizedException(MESSAGES.auth.tokenInvalid);
    }
    return payload;
  }

  // Verifies WebSocket connection token; returns null on error
  async verifyWs(token: string): Promise<JwtPayload | null> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.secret,
      });
      return (await this.userExists(payload.userId)) ? payload : null;
    } catch {
      return null;
    }
  }
}
