import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { StylistVerificationStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AuditLogService } from "../../shared/audit/audit-log.service";
import { AuthenticatedAdmin } from "../../common/interfaces/admin-jwt-payload.interface";
import { buildPaginationMeta } from "../../common/dto/pagination-query.dto";

export type StylistApplication = {
  displayName?: string;
  bio?: string;
  city?: string;
  specialties?: string[];
  portfolioUrl?: string;
};

const USER_SUMMARY = { id: true, username: true, email: true, avatar: true } as const;
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

@Injectable()
export class StylistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── End users ─────────────────────────────────────────────────────────────

  async mine(userId: string) {
    return this.prisma.stylistProfile.findUnique({ where: { userId } });
  }

  async apply(userId: string, input: StylistApplication) {
    const displayName = text(input.displayName, 60);
    if (!displayName) throw new BadRequestException("Add the name clients will see");
    const existing = await this.prisma.stylistProfile.findUnique({ where: { userId } });
    if (existing?.status === StylistVerificationStatus.SUSPENDED) throw new ForbiddenException("Your stylist profile is suspended");

    const data = {
      displayName,
      bio: text(input.bio, 600),
      city: text(input.city, 60),
      specialties: Array.isArray(input.specialties) ? input.specialties.map((s) => String(s).slice(0, 30)).slice(0, 10) : undefined,
      portfolioUrl: text(input.portfolioUrl, 300),
    };
    // Editing a verified profile keeps the badge; a rejected one goes back into the queue.
    const status = existing?.status === StylistVerificationStatus.VERIFIED ? StylistVerificationStatus.VERIFIED : StylistVerificationStatus.PENDING;
    return this.prisma.stylistProfile.upsert({
      where: { userId },
      create: { userId, ...data, status },
      update: { ...data, status, ...(status === StylistVerificationStatus.PENDING ? { rejectionReason: null } : {}) },
    });
  }

  private async verified(userId: string) {
    const profile = await this.prisma.stylistProfile.findUnique({ where: { userId } });
    if (profile?.status !== StylistVerificationStatus.VERIFIED) throw new ForbiddenException("Only verified stylists can do this");
    return profile;
  }

  /** Looks whose owners asked for a stylist's opinion. */
  async queue(userId: string) {
    await this.verified(userId);
    const looks = await this.prisma.look.findMany({
      where: { stylistReviewRequested: true, userId: { not: userId } },
      orderBy: { reviewRequestedAt: "desc" },
      take: 60,
      include: { stylistComments: { select: { stylistId: true } } },
    });
    const owners = await this.prisma.user.findMany({ where: { id: { in: looks.map((l) => l.userId) } }, select: USER_SUMMARY });
    const ownerById = new Map(owners.map((o) => [o.id, o]));
    return looks.map(({ stylistComments, ...l }) => ({
      ...l,
      owner: ownerById.get(l.userId) ?? null,
      commentCount: stylistComments.length,
      reviewedByMe: stylistComments.some((c) => c.stylistId === userId),
    }));
  }

  /** Readable by the look's owner and by verified stylists. */
  async comments(userId: string, lookId: string) {
    const look = await this.prisma.look.findUnique({ where: { id: lookId } });
    if (!look) throw new NotFoundException("Look not found");
    if (look.userId !== userId) await this.verified(userId);

    const comments = await this.prisma.lookStylistComment.findMany({ where: { lookId }, orderBy: { createdAt: "asc" } });
    const stylists = await this.prisma.stylistProfile.findMany({
      where: { userId: { in: comments.map((c) => c.stylistId) } },
      select: { userId: true, displayName: true, city: true, specialties: true },
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: comments.map((c) => c.stylistId) } }, select: USER_SUMMARY });
    const stylistById = new Map(stylists.map((s) => [s.userId, s]));
    const userById = new Map(users.map((u) => [u.id, u]));
    return comments.map((c) => ({ ...c, stylist: { ...stylistById.get(c.stylistId), avatar: userById.get(c.stylistId)?.avatar ?? null } }));
  }

  async comment(userId: string, lookId: string, comment: string) {
    const profile = await this.verified(userId);
    const body = text(comment, 1000);
    if (!body) throw new BadRequestException("Write a comment");
    const look = await this.prisma.look.findUnique({ where: { id: lookId } });
    if (!look || !look.stylistReviewRequested) throw new NotFoundException("This look isn't open for stylist review");

    const created = await this.prisma.lookStylistComment.create({ data: { lookId, stylistId: userId, comment: body } });
    await this.notifications.create(look.userId, {
      type: "STYLIST_COMMENT",
      title: `${profile.displayName} (stylist) commented on ${look.name}`,
      body: body.slice(0, 140),
      link: `/saved?look=${look.id}`,
      data: { lookId },
    });
    return created;
  }

  async deleteOwnComment(userId: string, commentId: string) {
    const c = await this.prisma.lookStylistComment.findUnique({ where: { id: commentId } });
    if (!c || c.stylistId !== userId) throw new NotFoundException("Comment not found");
    await this.prisma.lookStylistComment.delete({ where: { id: commentId } });
    return { deleted: true };
  }

  // ─── Admin panel ───────────────────────────────────────────────────────────

  async adminList(filter: { status?: string; page?: number; limit?: number; search?: string }) {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
    const where: any = {};
    if (filter.status && filter.status in StylistVerificationStatus) where.status = filter.status;
    if (filter.search) where.OR = [{ displayName: { contains: filter.search, mode: "insensitive" } }, { city: { contains: filter.search, mode: "insensitive" } }];

    const [rows, total] = await Promise.all([
      this.prisma.stylistProfile.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      this.prisma.stylistProfile.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: USER_SUMMARY });
    const counts = await this.prisma.lookStylistComment.groupBy({ by: ["stylistId"], where: { stylistId: { in: rows.map((r) => r.userId) } }, _count: true });
    const userById = new Map(users.map((u) => [u.id, u]));
    const countById = new Map(counts.map((c) => [c.stylistId, c._count]));
    return {
      data: rows.map((r) => ({ ...r, user: userById.get(r.userId) ?? null, commentCount: countById.get(r.userId) ?? 0 })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async setStatus(id: string, status: StylistVerificationStatus, admin: AuthenticatedAdmin, reason?: string) {
    const profile = await this.prisma.stylistProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException("Stylist not found");
    const updated = await this.prisma.stylistProfile.update({
      where: { id },
      data: {
        status,
        verifiedById: status === StylistVerificationStatus.VERIFIED ? admin.adminUserId : profile.verifiedById,
        reviewedAt: new Date(),
        rejectionReason: status === StylistVerificationStatus.REJECTED || status === StylistVerificationStatus.SUSPENDED ? text(reason, 300) : null,
      },
    });
    await this.audit.log({ adminUserId: admin.adminUserId, action: `STYLIST_${status}`, entityType: "StylistProfile", entityId: id, metadata: { reason } });

    const titles: Partial<Record<StylistVerificationStatus, string>> = {
      VERIFIED: "You're now a verified stylist",
      REJECTED: "Your stylist application wasn't approved",
      SUSPENDED: "Your stylist profile was suspended",
    };
    if (titles[status]) {
      await this.notifications.create(profile.userId, {
        type: "STYLIST_STATUS",
        title: titles[status]!,
        body: updated.rejectionReason ?? (status === "VERIFIED" ? "Open the stylist queue to start reviewing looks." : undefined),
        link: "/stylist",
      });
    }
    return updated;
  }

  async adminComments(filter: { page?: number; limit?: number }) {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
    const [rows, total] = await Promise.all([
      this.prisma.lookStylistComment.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { look: { select: { id: true, name: true, image: true, userId: true } } },
      }),
      this.prisma.lookStylistComment.count(),
    ]);
    const stylists = await this.prisma.stylistProfile.findMany({ where: { userId: { in: rows.map((r) => r.stylistId) } }, select: { userId: true, displayName: true } });
    const byId = new Map(stylists.map((s) => [s.userId, s.displayName]));
    return { data: rows.map((r) => ({ ...r, stylistName: byId.get(r.stylistId) ?? "Unknown" })), meta: buildPaginationMeta(total, page, limit) };
  }

  async adminDeleteComment(id: string, admin: AuthenticatedAdmin) {
    await this.prisma.lookStylistComment.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Comment not found");
    });
    await this.audit.log({ adminUserId: admin.adminUserId, action: "STYLIST_COMMENT_DELETED", entityType: "LookStylistComment", entityId: id });
    return { deleted: true };
  }
}
