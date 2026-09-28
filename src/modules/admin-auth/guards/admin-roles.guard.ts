import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_ROLES_KEY } from '../../../common/decorators/admin-roles.decorator';
import { MESSAGES } from '../../../common/constants/messages.constant';
import { AdminRole } from '@prisma/client';

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const admin = request['adminUser'];

    if (!admin || !admin.role) {
      throw new ForbiddenException('Admin role not found on authenticated request');
    }

    if (!requiredRoles.includes(admin.role)) {
      throw new ForbiddenException(MESSAGES.adminAuth.forbidden(requiredRoles));
    }

    return true;
  }
}
