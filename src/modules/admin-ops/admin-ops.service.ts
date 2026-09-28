import { Injectable, NotFoundException } from '@nestjs/common';
import { BorrowStatus, Prisma, StylistVerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

const DAY_MS = 24 * 60 * 60 * 1000;
const USER_SUMMARY = { id: true, username: true, email: true } as const;

const paging = (q: { page?: unknown; limit?: unknown }, max = 100) => {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(max, Math.max(1, Number(q.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

/** Audit log viewer, community moderation and the extra dashboard counters. */
@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async auditLogs(q: { page?: unknown; limit?: unknown; action?: string; entityType?: string; adminUserId?: string; from?: string; to?: string }) {
    const { page, limit, skip } = paging(q);
    const where: Prisma.AdminAuditLogWhereInput = {};
    if (q.action) where.action = { contains: q.action, mode: 'insensitive' };
    if (q.entityType) where.entityType = q.entityType;
    if (q.adminUserId) where.adminUserId = q.adminUserId;
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };

    const [rows, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { adminUser: { select: { id: true, name: true, email: true, role: true } } },
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async auditFacets() {
    const [entityTypes, admins] = await Promise.all([
      this.prisma.adminAuditLog.findMany({ distinct: ['entityType'], select: { entityType: true } }),
      this.prisma.adminUser.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
    ]);
    return { entityTypes: entityTypes.map((e) => e.entityType), admins };
  }

  /** Counters for the dashboard's "Community & AI" row. */
  async overview() {
    const since = new Date(Date.now() - DAY_MS);
    const [circles, members, upcoming, events, borrowPending, borrowActive, stylistsPending, stylistsVerified, shares, shareOpens, aiDay, aiFailedDay, widgetSessions] =
      await Promise.all([
        this.prisma.twinCircle.count(),
        this.prisma.twinCircleMember.count({ where: { status: 'ACTIVE' } }),
        this.prisma.event.count({ where: { eventDate: { gte: new Date() } } }),
        this.prisma.event.count(),
        this.prisma.borrowRequest.count({ where: { status: BorrowStatus.PENDING } }),
        this.prisma.borrowRequest.count({ where: { status: BorrowStatus.ACCEPTED, returnedAt: null } }),
        this.prisma.stylistProfile.count({ where: { status: StylistVerificationStatus.PENDING } }),
        this.prisma.stylistProfile.count({ where: { status: StylistVerificationStatus.VERIFIED } }),
        this.prisma.shareEvent.count(),
        this.prisma.shareEvent.aggregate({ _sum: { openCount: true } }),
        this.prisma.aiRequestLog.count({ where: { createdAt: { gte: since } } }),
        this.prisma.aiRequestLog.count({ where: { createdAt: { gte: since }, success: false } }),
        this.prisma.brandWidgetSession.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) } } }),
      ]);
    return {
      circles,
      circleMembers: members,
      events,
      upcomingEvents: upcoming,
      borrowPending,
      borrowActive,
      stylistsPending,
      stylistsVerified,
      shares,
      shareOpens: shareOpens._sum.openCount ?? 0,
      aiRequests24h: aiDay,
      aiFailures24h: aiFailedDay,
      widgetSessions30d: widgetSessions,
    };
  }

  async circles(q: { page?: unknown; limit?: unknown }) {
    const { page, limit, skip } = paging(q);
    const [rows, total] = await Promise.all([
      this.prisma.twinCircle.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { _count: { select: { members: true, events: true } }, members: { select: { kind: true, status: true } } },
      }),
      this.prisma.twinCircle.count(),
    ]);
    const owners = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.ownerId) } }, select: USER_SUMMARY });
    const ownerById = new Map(owners.map((o) => [o.id, o]));
    return {
      data: rows.map(({ members, _count, ...c }) => ({
        ...c,
        owner: ownerById.get(c.ownerId) ?? null,
        memberCount: _count.members,
        eventCount: _count.events,
        linkedAccounts: members.filter((m) => m.kind === 'USER' && m.status === 'ACTIVE').length,
        pendingInvites: members.filter((m) => m.status === 'INVITED').length,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async events(q: { page?: unknown; limit?: unknown; search?: string }) {
    const { page, limit, skip } = paging(q);
    const where: Prisma.EventWhereInput = q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {};
    const [rows, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { plans: { select: { status: true, lookId: true } } },
      }),
      this.prisma.event.count({ where }),
    ]);
    const creators = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.createdById) } }, select: USER_SUMMARY });
    const byId = new Map(creators.map((c) => [c.id, c]));
    return {
      data: rows.map(({ plans, ...e }) => ({
        ...e,
        createdBy: byId.get(e.createdById) ?? null,
        participants: plans.length,
        locked: plans.filter((p) => p.status === 'LOCKED').length,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async deleteEvent(id: string, admin: AuthenticatedAdmin) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');
    await this.prisma.event.delete({ where: { id } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'EVENT_DELETED', entityType: 'Event', entityId: id, metadata: { title: event.title } });
    return { deleted: true };
  }

  async borrows(q: { page?: unknown; limit?: unknown; status?: string }) {
    const { page, limit, skip } = paging(q);
    const where: Prisma.BorrowRequestWhereInput = q.status && q.status in BorrowStatus ? { status: q.status as BorrowStatus } : {};
    const [rows, total] = await Promise.all([
      this.prisma.borrowRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { wardrobeItem: { select: { name: true, image: true, category: true } } },
      }),
      this.prisma.borrowRequest.count({ where }),
    ]);
    const people = await this.prisma.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.ownerId, r.requesterId]) } }, select: USER_SUMMARY });
    const byId = new Map(people.map((p) => [p.id, p]));
    return {
      data: rows.map((r) => ({ ...r, owner: byId.get(r.ownerId) ?? null, requester: byId.get(r.requesterId) ?? null })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }
}
