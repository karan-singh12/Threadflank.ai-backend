import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { BorrowStatus, CircleMemberKind, CircleMemberStatus, FriendshipStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

/** Max people in a circle besides the owner (spec: an intimate circle of 4–5). */
export const CIRCLE_MEMBER_LIMIT = 5;

export const USER_SUMMARY = { id: true, username: true, email: true, avatar: true } as const;

export type ProfileMemberInput = {
  name?: string;
  relation?: string;
  gender?: string;
  age?: number;
  heightCm?: number;
  weightKg?: number;
  skinTone?: string;
  photo?: string;
  twin?: string;
};

export type BorrowInput = {
  wardrobeItemId: string;
  kind?: "BORROW" | "SWAP";
  swapItemId?: string;
  eventId?: string;
  message?: string;
  neededBy?: string;
};

const int = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const displayName = (u: { username: string | null; email: string }) => u.username || u.email.split("@")[0];

@Injectable()
export class TwinCircleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Circle & members ──────────────────────────────────────────────────────

  async ensureCircle(ownerId: string) {
    return this.prisma.twinCircle.upsert({ where: { ownerId }, create: { ownerId }, update: {} });
  }

  /** Members with USER accounts get their live profile and twin merged in. */
  private async enrich(members: Awaited<ReturnType<PrismaService["twinCircleMember"]["findMany"]>>) {
    const userIds = members.map((m) => m.userId).filter((id): id is string => Boolean(id));
    const [users, twins] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: USER_SUMMARY }),
      this.prisma.twinProfile.findMany({ where: { userId: { in: userIds } } }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const twinById = new Map(twins.map((t) => [t.userId, t]));

    return members.map((m) => {
      if (m.kind !== CircleMemberKind.USER || !m.userId) return { ...m, user: null };
      const u = userById.get(m.userId);
      const t = twinById.get(m.userId);
      return {
        ...m,
        user: u ?? null,
        name: u ? displayName(u) : m.name,
        gender: t?.gender ?? m.gender,
        age: t?.age ?? m.age,
        heightCm: t?.heightCm ?? m.heightCm,
        weightKg: t?.weightKg ?? m.weightKg,
        skinTone: t?.skinTone ?? m.skinTone,
        photo: t?.selfieUrl || u?.avatar || m.photo,
        twin: t?.baseAvatarUrl || null,
      };
    });
  }

  async getMine(userId: string) {
    const circle = await this.ensureCircle(userId);
    const members = await this.prisma.twinCircleMember.findMany({
      where: { circleId: circle.id, status: { not: CircleMemberStatus.DECLINED } },
      orderBy: { createdAt: "asc" },
    });

    const memberships = await this.prisma.twinCircleMember.findMany({
      where: { userId, kind: CircleMemberKind.USER, status: { in: [CircleMemberStatus.INVITED, CircleMemberStatus.ACTIVE] } },
      include: { circle: true },
    });
    const owners = await this.prisma.user.findMany({
      where: { id: { in: memberships.map((m) => m.circle.ownerId) } },
      select: USER_SUMMARY,
    });
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    return {
      circle: { ...circle, limit: CIRCLE_MEMBER_LIMIT, members: await this.enrich(members) },
      memberships: memberships.map((m) => ({
        memberId: m.id,
        circleId: m.circleId,
        status: m.status,
        relation: m.relation,
        owner: ownerById.get(m.circle.ownerId) ?? null,
        invitedAt: m.createdAt,
      })),
    };
  }

  private async assertRoom(circleId: string) {
    const count = await this.prisma.twinCircleMember.count({
      where: { circleId, status: { not: CircleMemberStatus.DECLINED } },
    });
    if (count >= CIRCLE_MEMBER_LIMIT) {
      throw new BadRequestException(`Your circle is full (${CIRCLE_MEMBER_LIMIT} members).`);
    }
  }

  private profileData(input: ProfileMemberInput) {
    return {
      relation: text(input.relation, 30),
      gender: text(input.gender, 20),
      age: int(input.age),
      heightCm: int(input.heightCm),
      weightKg: int(input.weightKg),
      skinTone: text(input.skinTone, 20),
      photo: text(input.photo, 500),
      twin: text(input.twin, 500),
    };
  }

  async addProfile(ownerId: string, input: ProfileMemberInput) {
    const name = text(input.name, 40);
    if (!name) throw new BadRequestException("Name is required");
    const circle = await this.ensureCircle(ownerId);
    await this.assertRoom(circle.id);
    return this.prisma.twinCircleMember.create({
      data: { circleId: circle.id, kind: CircleMemberKind.PROFILE, status: CircleMemberStatus.ACTIVE, name, ...this.profileData(input) },
    });
  }

  private async ownedMember(ownerId: string, memberId: string) {
    const member = await this.prisma.twinCircleMember.findUnique({ where: { id: memberId }, include: { circle: true } });
    if (!member || member.circle.ownerId !== ownerId) throw new NotFoundException("Circle member not found");
    return member;
  }

  async updateMember(ownerId: string, memberId: string, input: ProfileMemberInput) {
    const member = await this.ownedMember(ownerId, memberId);
    if (member.kind === CircleMemberKind.USER) {
      // A linked friend owns their own body details and twin; only the label is ours.
      return this.prisma.twinCircleMember.update({ where: { id: memberId }, data: { relation: text(input.relation, 30) } });
    }
    const name = input.name !== undefined ? text(input.name, 40) : member.name;
    if (!name) throw new BadRequestException("Name is required");
    return this.prisma.twinCircleMember.update({ where: { id: memberId }, data: { name, ...this.profileData(input) } });
  }

  async removeMember(ownerId: string, memberId: string) {
    await this.ownedMember(ownerId, memberId);
    await this.prisma.twinCircleMember.delete({ where: { id: memberId } });
    return { removed: true };
  }

  private async areFriends(a: string, b: string) {
    const f = await this.prisma.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { senderId: a, receiverId: b },
          { senderId: b, receiverId: a },
        ],
      },
    });
    return Boolean(f);
  }

  async inviteFriend(ownerId: string, friendId: string, relation?: string) {
    if (!friendId || friendId === ownerId) throw new BadRequestException("Pick a friend to invite");
    if (!(await this.areFriends(ownerId, friendId))) {
      throw new ForbiddenException("You can only invite people who are already your friends.");
    }
    const friend = await this.prisma.user.findUnique({ where: { id: friendId }, select: USER_SUMMARY });
    if (!friend) throw new NotFoundException("User not found");

    const circle = await this.ensureCircle(ownerId);
    const existing = await this.prisma.twinCircleMember.findUnique({ where: { circleId_userId: { circleId: circle.id, userId: friendId } } });
    if (existing && existing.status !== CircleMemberStatus.DECLINED) {
      throw new BadRequestException(existing.status === CircleMemberStatus.ACTIVE ? "Already in your circle" : "Invite already sent");
    }
    await this.assertRoom(circle.id);

    const data = {
      kind: CircleMemberKind.USER,
      status: CircleMemberStatus.INVITED,
      name: displayName(friend),
      relation: text(relation, 30),
    };
    const member = existing
      ? await this.prisma.twinCircleMember.update({ where: { id: existing.id }, data })
      : await this.prisma.twinCircleMember.create({ data: { circleId: circle.id, userId: friendId, ...data } });

    const owner = await this.prisma.user.findUnique({ where: { id: ownerId }, select: USER_SUMMARY });
    await this.notifications.create(friendId, {
      type: "CIRCLE_INVITE",
      title: `${owner ? displayName(owner) : "A friend"} invited you to their Twin Circle`,
      body: "Join to plan events, share wardrobes and get ready together.",
      link: "/profile?tab=circle",
      data: { memberId: member.id, circleId: circle.id },
    });
    return member;
  }

  async respondInvite(userId: string, memberId: string, accept: boolean) {
    const member = await this.prisma.twinCircleMember.findUnique({ where: { id: memberId }, include: { circle: true } });
    if (!member || member.userId !== userId) throw new NotFoundException("Invite not found");
    if (member.status !== CircleMemberStatus.INVITED) throw new BadRequestException("This invite was already answered");

    const updated = await this.prisma.twinCircleMember.update({
      where: { id: memberId },
      data: { status: accept ? CircleMemberStatus.ACTIVE : CircleMemberStatus.DECLINED },
    });
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SUMMARY });
    await this.notifications.create(member.circle.ownerId, {
      type: accept ? "CIRCLE_JOINED" : "CIRCLE_DECLINED",
      title: `${me ? displayName(me) : "Your friend"} ${accept ? "joined" : "declined"} your Twin Circle`,
      link: "/profile?tab=circle",
    });
    return updated;
  }

  async leave(userId: string, circleId: string) {
    const member = await this.prisma.twinCircleMember.findUnique({ where: { circleId_userId: { circleId, userId } } });
    if (!member) throw new NotFoundException("You're not in this circle");
    await this.prisma.twinCircleMember.delete({ where: { id: member.id } });
    return { left: true };
  }

  // ─── Access helpers (also used by Events) ──────────────────────────────────

  /** Circles the user can act in: their own, plus ones they've joined. */
  async accessibleCircleIds(userId: string) {
    const own = await this.ensureCircle(userId);
    const joined = await this.prisma.twinCircleMember.findMany({
      where: { userId, kind: CircleMemberKind.USER, status: CircleMemberStatus.ACTIVE },
      select: { circleId: true },
    });
    return [own.id, ...joined.map((j) => j.circleId)];
  }

  async assertCircleAccess(userId: string, circleId: string) {
    const ids = await this.accessibleCircleIds(userId);
    if (!ids.includes(circleId)) throw new ForbiddenException("You're not part of this circle");
    return this.prisma.twinCircle.findUniqueOrThrow({ where: { id: circleId } });
  }

  /** Everyone in a circle: owner, active linked users and managed profiles. */
  async participants(circleId: string) {
    const circle = await this.prisma.twinCircle.findUniqueOrThrow({ where: { id: circleId } });
    const members = await this.prisma.twinCircleMember.findMany({
      where: { circleId, status: CircleMemberStatus.ACTIVE },
      orderBy: { createdAt: "asc" },
    });
    const owner = await this.prisma.user.findUnique({ where: { id: circle.ownerId }, select: USER_SUMMARY });
    const ownerTwin = await this.prisma.twinProfile.findUnique({ where: { userId: circle.ownerId } });
    return {
      circle,
      owner: owner ? { ...owner, name: displayName(owner), twin: ownerTwin?.baseAvatarUrl ?? null, photo: ownerTwin?.selfieUrl || owner.avatar } : null,
      members: await this.enrich(members),
    };
  }

  /** Account holders in the circle (owner + active linked users). */
  async accountHolderIds(circleId: string) {
    const { circle, members } = await this.participants(circleId);
    return [circle.ownerId, ...members.filter((m) => m.kind === CircleMemberKind.USER && m.userId).map((m) => m.userId!)];
  }

  /** A circle both users are account holders in, or null. */
  async sharedCircleId(a: string, b: string) {
    const [aIds, bIds] = await Promise.all([this.accessibleCircleIds(a), this.accessibleCircleIds(b)]);
    return aIds.find((id) => bIds.includes(id)) ?? null;
  }

  // ─── Shared wardrobes ──────────────────────────────────────────────────────

  async memberWardrobe(viewerId: string, ownerId: string) {
    if (viewerId !== ownerId && !(await this.sharedCircleId(viewerId, ownerId))) {
      throw new ForbiddenException("You can only browse wardrobes of people in your Twin Circle");
    }
    const items = await this.prisma.wardrobeItem.findMany({ where: { userId: ownerId }, orderBy: { createdAt: "desc" } });
    const lent = await this.prisma.borrowRequest.findMany({
      where: { ownerId, status: BorrowStatus.ACCEPTED },
      select: { wardrobeItemId: true, returnedAt: true },
    });
    const onLoan = new Set(lent.filter((l) => !l.returnedAt).map((l) => l.wardrobeItemId));
    return items.map((i) => ({
      id: i.id,
      name: i.name,
      brand: i.brand,
      category: i.category,
      image: i.image,
      color: i.color,
      onLoan: onLoan.has(i.id),
    }));
  }

  // ─── Borrow / swap ─────────────────────────────────────────────────────────

  async createBorrow(requesterId: string, input: BorrowInput) {
    const item = await this.prisma.wardrobeItem.findUnique({ where: { id: input.wardrobeItemId } });
    if (!item) throw new NotFoundException("Item not found");
    if (item.userId === requesterId) throw new BadRequestException("That item is already yours");

    const circleId = await this.sharedCircleId(requesterId, item.userId);
    if (!circleId) throw new ForbiddenException("You can only borrow from people in your Twin Circle");

    const kind = input.kind === "SWAP" ? "SWAP" : "BORROW";
    if (kind === "SWAP") {
      if (!input.swapItemId) throw new BadRequestException("Pick one of your items to offer in the swap");
      const mine = await this.prisma.wardrobeItem.findFirst({ where: { id: input.swapItemId, userId: requesterId } });
      if (!mine) throw new BadRequestException("The swap item must be in your wardrobe");
    }

    const open = await this.prisma.borrowRequest.findFirst({
      where: { wardrobeItemId: item.id, requesterId, status: { in: [BorrowStatus.PENDING, BorrowStatus.ACCEPTED] }, returnedAt: null },
    });
    if (open) throw new BadRequestException("You already have an open request for this item");

    const neededBy = input.neededBy ? new Date(input.neededBy) : null;
    const request = await this.prisma.borrowRequest.create({
      data: {
        circleId,
        ownerId: item.userId,
        requesterId,
        wardrobeItemId: item.id,
        eventId: input.eventId || null,
        kind,
        swapItemId: kind === "SWAP" ? input.swapItemId! : null,
        message: text(input.message, 300),
        neededBy: neededBy && !Number.isNaN(neededBy.getTime()) ? neededBy : null,
      },
    });

    const requester = await this.prisma.user.findUnique({ where: { id: requesterId }, select: USER_SUMMARY });
    await this.notifications.create(item.userId, {
      type: "BORROW_REQUEST",
      title: `${requester ? displayName(requester) : "Someone"} wants to ${kind === "SWAP" ? "swap for" : "borrow"} your ${item.name}`,
      body: request.message ?? undefined,
      link: "/wardrobe?tab=borrow",
      data: { requestId: request.id },
    });
    return request;
  }

  async listBorrows(userId: string) {
    const rows = await this.prisma.borrowRequest.findMany({
      where: { OR: [{ ownerId: userId }, { requesterId: userId }] },
      orderBy: { createdAt: "desc" },
      include: { wardrobeItem: { select: { id: true, name: true, brand: true, category: true, image: true, color: true } } },
      take: 100,
    });
    const peopleIds = [...new Set(rows.flatMap((r) => [r.ownerId, r.requesterId]))];
    const swapIds = rows.map((r) => r.swapItemId).filter((id): id is string => Boolean(id));
    const [people, swapItems] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: peopleIds } }, select: USER_SUMMARY }),
      this.prisma.wardrobeItem.findMany({ where: { id: { in: swapIds } }, select: { id: true, name: true, image: true, category: true } }),
    ]);
    const personById = new Map(people.map((p) => [p.id, p]));
    const swapById = new Map(swapItems.map((s) => [s.id, s]));
    const shaped = rows.map((r) => ({
      ...r,
      owner: personById.get(r.ownerId) ?? null,
      requester: personById.get(r.requesterId) ?? null,
      swapItem: r.swapItemId ? swapById.get(r.swapItemId) ?? null : null,
    }));
    return {
      incoming: shaped.filter((r) => r.ownerId === userId),
      outgoing: shaped.filter((r) => r.requesterId === userId),
    };
  }

  async respondBorrow(userId: string, id: string, action: "accept" | "decline" | "returned" | "cancel") {
    const req = await this.prisma.borrowRequest.findUnique({ where: { id }, include: { wardrobeItem: true } });
    if (!req) throw new NotFoundException("Request not found");

    const isOwner = req.ownerId === userId;
    const isRequester = req.requesterId === userId;
    let data: Record<string, unknown>;
    let notify: { to: string; title: string } | null = null;

    switch (action) {
      case "accept":
      case "decline":
        if (!isOwner) throw new ForbiddenException("Only the item's owner can answer this request");
        if (req.status !== BorrowStatus.PENDING) throw new BadRequestException("This request was already answered");
        data = { status: action === "accept" ? BorrowStatus.ACCEPTED : BorrowStatus.DECLINED, respondedAt: new Date() };
        notify = { to: req.requesterId, title: `Your request for ${req.wardrobeItem.name} was ${action === "accept" ? "accepted" : "declined"}` };
        break;
      case "returned":
        if (!isOwner && !isRequester) throw new ForbiddenException();
        if (req.status !== BorrowStatus.ACCEPTED) throw new BadRequestException("Only accepted requests can be marked returned");
        data = { status: BorrowStatus.RETURNED, returnedAt: new Date() };
        notify = { to: isOwner ? req.requesterId : req.ownerId, title: `${req.wardrobeItem.name} was marked as returned` };
        break;
      case "cancel":
        if (!isRequester) throw new ForbiddenException("Only the requester can cancel");
        if (req.status !== BorrowStatus.PENDING) throw new BadRequestException("Only pending requests can be cancelled");
        data = { status: BorrowStatus.CANCELLED, respondedAt: new Date() };
        break;
      default:
        throw new BadRequestException("Unknown action");
    }

    const updated = await this.prisma.borrowRequest.update({ where: { id }, data });
    if (notify) await this.notifications.create(notify.to, { type: "BORROW_UPDATE", title: notify.title, link: "/wardrobe?tab=borrow" });
    return updated;
  }
}
