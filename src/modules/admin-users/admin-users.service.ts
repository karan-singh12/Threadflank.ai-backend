import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminPanelUserFilterDto } from './dto/user-filter.dto';
import { MESSAGES } from '../../common/constants/messages.constant';
import { APP_CONSTANTS } from '../../common/constants/app.constant';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

/**
 * Admin-panel read/suspend view over the EXISTING `User` table — reads via
 * PrismaService.user directly (no schema change to User needed for reads).
 *
 * IMPORTANT: suspend()/unsuspend() only write a UserSuspension audit record.
 * They do NOT block the suspended user from logging in — wiring that into
 * auth.service.ts#login is outside this task's scope (auth/ is off-limits),
 * so this is a visibility + audit-trail feature today, not an enforcement
 * mechanism. Flagged explicitly to the caller via the suspend()/unsuspend()
 * response — do not assume suspended users are actually locked out.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async findAll(filter: AdminPanelUserFilterDto) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? APP_CONSTANTS.pagination.adminLimit, APP_CONSTANTS.pagination.maxLimit);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.search) {
      where.OR = [
        { email: { contains: filter.search, mode: 'insensitive' } },
        { username: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, username: true, role: true, isOnline: true, lastSeen: true, createdAt: true, avatar: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    const userIds = users.map((u) => u.id);
    const suspensions = await this.activeSuspensionsFor(userIds);

    const usersWithStatus = users.map((u) => ({ ...u, isSuspended: suspensions.has(u.id) }));

    return { users: usersWithStatus, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, username: true, role: true, isOnline: true, lastSeen: true, createdAt: true, avatar: true, bio: true, phone: true, location: true },
    });
    if (!user) throw new NotFoundException(MESSAGES.adminUsers.notFound);

    const suspensions = await this.activeSuspensionsFor([id]);
    return { ...user, isSuspended: suspensions.has(id) };
  }

  async suspend(userId: string, reason: string | undefined, admin: AuthenticatedAdmin) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(MESSAGES.adminUsers.notFound);

    const active = await this.activeSuspensionsFor([userId]);
    if (active.has(userId)) throw new BadRequestException(MESSAGES.adminUsers.alreadySuspended);

    const suspension = await this.prisma.userSuspension.create({
      data: { userId, reason, suspendedByAdminId: admin.adminUserId },
    });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'USER_SUSPENDED', entityType: 'User', entityId: userId, metadata: { reason } });
    return suspension;
  }

  async unsuspend(userId: string, admin: AuthenticatedAdmin) {
    const active = await this.prisma.userSuspension.findFirst({
      where: { userId, liftedAt: null },
      orderBy: { suspendedAt: 'desc' },
    });
    if (!active) throw new BadRequestException(MESSAGES.adminUsers.notSuspended);

    const updated = await this.prisma.userSuspension.update({ where: { id: active.id }, data: { liftedAt: new Date() } });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'USER_UNSUSPENDED', entityType: 'User', entityId: userId });
    return updated;
  }

  private async activeSuspensionsFor(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.prisma.userSuspension.findMany({
      where: { userId: { in: userIds }, liftedAt: null },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }
}
