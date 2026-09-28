import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtStrategy } from '../../auth/strategies/jwt.strategy';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Optional HTTP JWT Authentication Guard.
 * If a valid Bearer token is provided, attaches the user to request.user.
 * If no token or an invalid token is provided, lets the request proceed anonymously without throwing 401.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly jwtStrategy: JwtStrategy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (token) {
      try {
        const payload = await this.jwtStrategy.verify(token);
        request['user'] = payload as AuthenticatedUser;
      } catch {
        // Invalid or expired token: fall back to anonymous guest
        request['user'] = undefined;
      }
    } else {
      request['user'] = undefined;
    }

    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const authHeader = request.headers?.authorization;
    if (!authHeader) return undefined;
    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
