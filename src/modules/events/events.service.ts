import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CircleMemberKind, GroupRole, PlanStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { TwinCircleService, USER_SUMMARY } from "../twin-circle/twin-circle.service";
import { SdkService } from "../../sdk/sdk.service";

export type EventInput = {
  circleId?: string;
  title?: string;
  eventType?: string;
  dressCode?: string;
  location?: string;
  eventDate?: string | null;
  budget?: number | null;
  notes?: string;
};

export type PlanInput = { lookId?: string | null; color?: string | null; note?: string | null; status?: "PLANNING" | "LOCKED" };

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const date = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid event date");
  return d;
};

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly circles: TwinCircleService,
    private readonly notifications: NotificationsService,
    private readonly sdk: SdkService,
  ) {}

  private fields(input: EventInput) {
    return {
      eventType: text(input.eventType, 40),
      dressCode: text(input.dressCode, 40),
      location: text(input.location, 120),
      eventDate: date(input.eventDate),
      budget: input.budget == null || input.budget === ("" as any) ? null : Math.max(0, Math.round(Number(input.budget)) || 0),
      notes: text(input.notes, 1000),
    };
  }

  /** Makes sure every current circle participant has a plan row (circles change after events are made). */
  private async syncPlans(eventId: string, circleId: string) {
    const { circle, members } = await this.circles.participants(circleId);
    const existing = await this.prisma.eventOutfitPlan.findMany({ where: { eventId }, select: { userId: true, memberId: true } });
    const haveUser = new Set(existing.map((p) => p.userId).filter(Boolean));
    const haveMember = new Set(existing.map((p) => p.memberId).filter(Boolean));

    const rows: { eventId: string; userId?: string; memberId?: string }[] = [];
    if (!haveUser.has(circle.ownerId)) rows.push({ eventId, userId: circle.ownerId });
    for (const m of members) {
      if (m.kind === CircleMemberKind.USER && m.userId && !haveUser.has(m.userId)) rows.push({ eventId, userId: m.userId });
      if (m.kind === CircleMemberKind.PROFILE && !haveMember.has(m.id)) rows.push({ eventId, memberId: m.id });
    }
    if (rows.length) await this.prisma.eventOutfitPlan.createMany({ data: rows, skipDuplicates: true });
  }

  /** Keeps the event's GRWM group chat in step with the circle's account holders. */
  private async syncGroup(eventId: string) {
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const holders = await this.circles.accountHolderIds(event.circleId);

    if (!event.groupId) {
      const group = await this.prisma.groupConversation.create({
        data: {
          name: `GRWM · ${event.title}`.slice(0, 80),
          description: `Get Ready With Me for ${event.title}`,
          createdBy: event.createdById,
          members: {
            create: holders.map((userId) => ({ userId, role: userId === event.createdById ? GroupRole.ADMIN : GroupRole.MEMBER })),
          },
        },
      });
      await this.prisma.event.update({ where: { id: eventId }, data: { groupId: group.id } });
      return group.id;
    }

    const current = await this.prisma.groupMember.findMany({ where: { groupId: event.groupId }, select: { userId: true } });
    const have = new Set(current.map((c) => c.userId));
    const missing = holders.filter((id) => !have.has(id));
    if (missing.length) {
      await this.prisma.groupMember.createMany({ data: missing.map((userId) => ({ groupId: event.groupId!, userId })), skipDuplicates: true });
    }
    return event.groupId;
  }

  async create(userId: string, input: EventInput) {
    const title = text(input.title, 120);
    if (!title) throw new BadRequestException("Give the event a name");
    const circleId = input.circleId || (await this.circles.ensureCircle(userId)).id;
    await this.circles.assertCircleAccess(userId, circleId);

    const event = await this.prisma.event.create({ data: { circleId, createdById: userId, title, ...this.fields(input) } });
    await this.syncPlans(event.id, circleId);
    await this.syncGroup(event.id);

    const holders = await this.circles.accountHolderIds(circleId);
    await this.notifications.createMany(
      holders.filter((id) => id !== userId),
      {
        type: "EVENT_INVITE",
        title: `New event: ${title}`,
        body: event.eventDate ? `On ${event.eventDate.toDateString()}. Pick your outfit.` : "Pick your outfit.",
        link: `/events/${event.id}`,
        data: { eventId: event.id },
      },
    );
    return this.get(userId, event.id);
  }

  async list(userId: string) {
    const circleIds = await this.circles.accessibleCircleIds(userId);
    const events = await this.prisma.event.findMany({
      where: { circleId: { in: circleIds } },
      orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      include: { plans: { select: { status: true, lookId: true, userId: true } } },
    });
    return events.map(({ plans, ...e }) => ({
      ...e,
      participants: plans.length,
      locked: plans.filter((p) => p.status === PlanStatus.LOCKED).length,
      withLook: plans.filter((p) => p.lookId).length,
      myPlanDone: plans.some((p) => p.userId === userId && p.status === PlanStatus.LOCKED),
      isPast: e.eventDate ? e.eventDate.getTime() < Date.now() - 24 * 3600 * 1000 : false,
    }));
  }

  private async access(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, include: { circle: true } });
    if (!event) throw new NotFoundException("Event not found");
    await this.circles.assertCircleAccess(userId, event.circleId);
    return event;
  }

  async get(userId: string, eventId: string) {
    const event = await this.access(userId, eventId);
    await this.syncPlans(eventId, event.circleId);
    const { owner, members } = await this.circles.participants(event.circleId);

    const plans = await this.prisma.eventOutfitPlan.findMany({
      where: { eventId },
      include: { look: { select: { id: true, name: true, image: true, occasion: true, pieces: true, videoUrl: true } } },
    });
    const holders = await this.prisma.user.findMany({
      where: { id: { in: plans.map((p) => p.userId).filter((id): id is string => Boolean(id)) } },
      select: USER_SUMMARY,
    });
    const twins = await this.prisma.twinProfile.findMany({ where: { userId: { in: holders.map((h) => h.id) } } });
    const holderById = new Map(holders.map((h) => [h.id, h]));
    const twinById = new Map(twins.map((t) => [t.userId, t]));
    const memberById = new Map(members.map((m) => [m.id, m]));

    const isOwner = event.circle.ownerId === userId;
    const shaped = plans
      .map((p) => {
        const member = p.memberId ? memberById.get(p.memberId) : undefined;
        const holder = p.userId ? holderById.get(p.userId) : undefined;
        if (p.memberId && !member) return null; // Removed from the circle since.
        const twin = p.userId ? twinById.get(p.userId) : undefined;
        return {
          ...p,
          person: holder
            ? {
                kind: "USER" as const,
                id: holder.id,
                name: holder.username || holder.email.split("@")[0],
                avatar: holder.avatar,
                twin: twin?.baseAvatarUrl ?? null,
                isMe: holder.id === userId,
              }
            : { kind: "PROFILE" as const, id: member!.id, name: member!.name, avatar: member!.photo, twin: member!.twin, isMe: false },
          canEdit: p.userId === userId || (Boolean(p.memberId) && isOwner),
        };
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .sort((a, b) => Number(b.person.isMe) - Number(a.person.isMe));

    return {
      ...event,
      circle: undefined,
      circleOwner: owner,
      canManage: isOwner || event.createdById === userId,
      plans: shaped,
      warnings: this.clashes(shaped),
    };
  }

  /** Same main colour or the very same look on two people → flag it. */
  private clashes(plans: { id: string; color: string | null; lookId: string | null; person: { name: string } }[]) {
    const warnings: { type: "COLOR" | "LOOK"; message: string; planIds: string[] }[] = [];
    const byColor = new Map<string, typeof plans>();
    const byLook = new Map<string, typeof plans>();
    for (const p of plans) {
      if (p.color) byColor.set(p.color.toLowerCase(), [...(byColor.get(p.color.toLowerCase()) ?? []), p]);
      if (p.lookId) byLook.set(p.lookId, [...(byLook.get(p.lookId) ?? []), p]);
    }
    for (const [color, group] of byColor) {
      if (group.length > 1) {
        warnings.push({ type: "COLOR", message: `${group.map((g) => g.person.name).join(" & ")} are both wearing ${color}.`, planIds: group.map((g) => g.id) });
      }
    }
    for (const group of byLook.values()) {
      if (group.length > 1) {
        warnings.push({ type: "LOOK", message: `${group.map((g) => g.person.name).join(" & ")} picked the same look.`, planIds: group.map((g) => g.id) });
      }
    }
    return warnings;
  }

  async update(userId: string, eventId: string, input: EventInput) {
    const event = await this.access(userId, eventId);
    if (event.createdById !== userId && event.circle.ownerId !== userId) throw new ForbiddenException("Only the organiser can edit this event");
    const title = input.title !== undefined ? text(input.title, 120) : event.title;
    if (!title) throw new BadRequestException("Give the event a name");
    await this.prisma.event.update({ where: { id: eventId }, data: { title, ...this.fields({ ...event, eventDate: event.eventDate?.toISOString(), ...input } as EventInput) } });
    return this.get(userId, eventId);
  }

  async remove(userId: string, eventId: string) {
    const event = await this.access(userId, eventId);
    if (event.createdById !== userId && event.circle.ownerId !== userId) throw new ForbiddenException("Only the organiser can delete this event");
    await this.prisma.event.delete({ where: { id: eventId } });
    return { deleted: true };
  }

  async setPlan(userId: string, eventId: string, planId: string, input: PlanInput) {
    const event = await this.access(userId, eventId);
    const plan = await this.prisma.eventOutfitPlan.findFirst({ where: { id: planId, eventId } });
    if (!plan) throw new NotFoundException("Plan not found");
    const canEdit = plan.userId === userId || (Boolean(plan.memberId) && event.circle.ownerId === userId);
    if (!canEdit) throw new ForbiddenException("You can only edit your own outfit plan");

    const data: Record<string, unknown> = { updatedById: userId };
    if (input.lookId !== undefined) {
      if (input.lookId) {
        const look = await this.prisma.look.findFirst({ where: { id: input.lookId, userId } });
        if (!look) throw new BadRequestException("Pick one of your saved looks");
      }
      data.lookId = input.lookId || null;
    }
    if (input.color !== undefined) data.color = text(input.color, 30);
    if (input.note !== undefined) data.note = text(input.note, 300);
    if (input.status) data.status = input.status === "LOCKED" ? PlanStatus.LOCKED : PlanStatus.PLANNING;
    if (data.status === PlanStatus.LOCKED && !(data.lookId ?? plan.lookId)) throw new BadRequestException("Pick a look before locking it in");

    await this.prisma.eventOutfitPlan.update({ where: { id: planId }, data });
    const full = await this.get(userId, eventId);

    // Live update for everyone in the GRWM session (socket only, not stored).
    const holders = await this.circles.accountHolderIds(event.circleId);
    for (const id of holders) {
      if (id !== userId) await this.notifications.sendNotification(id, "event:planUpdated", { eventId, planId });
    }
    if (input.status === "LOCKED") {
      const me = full.plans.find((p) => p.id === planId);
      await this.notifications.createMany(
        holders.filter((id) => id !== userId),
        { type: "EVENT_PLAN_LOCKED", title: `${me?.person.name ?? "Someone"} locked in their look for ${event.title}`, link: `/events/${eventId}` },
      );
    }
    return full;
  }

  async setGrwm(userId: string, eventId: string, live: boolean) {
    const event = await this.access(userId, eventId);
    const groupId = await this.syncGroup(eventId);
    await this.prisma.event.update({ where: { id: eventId }, data: { grwmLiveAt: live ? new Date() : null } });

    const holders = await this.circles.accountHolderIds(event.circleId);
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SUMMARY });
    const name = me?.username || me?.email.split("@")[0] || "Someone";
    for (const id of holders) {
      await this.notifications.sendNotification(id, "event:grwm", { eventId, live, by: userId });
    }
    if (live) {
      await this.notifications.createMany(
        holders.filter((id) => id !== userId),
        { type: "GRWM_STARTED", title: `${name} started Get Ready With Me`, body: event.title, link: `/events/${eventId}` },
      );
    }
    return { groupId, live };
  }

  /** Runs the Occasion Planner agent over the plan owner's wardrobe for this event. */
  async suggest(userId: string, eventId: string, planId: string) {
    const event = await this.access(userId, eventId);
    const plan = await this.prisma.eventOutfitPlan.findFirst({ where: { id: planId, eventId } });
    if (!plan) throw new NotFoundException("Plan not found");
    if (plan.userId !== userId) throw new ForbiddenException("Suggestions use your own wardrobe, so they're only for your plan");
    return this.sdk.runOccasionPlanner(userId, {
      eventType: event.eventType || "Event",
      dressCode: event.dressCode ?? undefined,
      location: event.location ?? undefined,
      budget: event.budget ?? undefined,
      notes: [event.title, event.notes].filter(Boolean).join(". "),
    });
  }
}
