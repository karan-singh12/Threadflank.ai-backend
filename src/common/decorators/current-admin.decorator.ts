import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedAdmin } from '../interfaces/admin-jwt-payload.interface';

/** Pulls the AdminJwtPayload attached to the request by AdminAuthGuard. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedAdmin => {
    const request = ctx.switchToHttp().getRequest();
    return request.adminUser;
  },
);
