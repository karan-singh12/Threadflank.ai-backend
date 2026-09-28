import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminJwtStrategy } from '../strategies/admin-jwt.strategy';
import { MESSAGES } from '../../../common/constants/messages.constant';
import { AuthenticatedAdmin } from '../../../common/interfaces/admin-jwt-payload.interface';

/**
 * HTTP guard for the /admin-panel/* surface. Mirrors common/guards/auth.guard.ts
 * but verifies against the separate admin secret and attaches the payload to
 * request.adminUser (never request.user, to avoid any ambiguity with the
 * end-user AuthGuard).
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly adminJwtStrategy: AdminJwtStrategy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException(MESSAGES.adminAuth.tokenMissing);
    }

    const payload = await this.adminJwtStrategy.verifyAccessToken(token);
    request['adminUser'] = payload as AuthenticatedAdmin;
    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const authHeader = request.headers?.authorization;
    if (!authHeader) return undefined;
    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
