import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../User-panel/notifications/notifications.service';
import { BrandNotifyService } from '../notify/brand-notify';
import { assertPlanRoom } from '../billing/plans';

const DAY = 86_400_000;
/** How long after opening a creator's link a shopper's try-ons and follows still count for the collab. */
export const ATTRIBUTION_DAYS = 7;
export const COLLAB_KINDS = ['DRAPE_LOOK', 'UNBOXING', 'LAUNCH_PROMO'] as const;
export type CollabKind = (typeof COLLAB_KINDS)[number];
const KIND_LABEL: Record<CollabKind, string> = { DRAPE_LOOK: 'a styled look', UNBOXING: 'an unboxing', LAUNCH_PROMO: 'a launch post' };
const OPEN = ['PENDING', 'ACCEPTED'];
const MAX_PIECES = 12;

/** 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function collabCode() {
  return [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
export const isCollabCode = (s: unknown): s is string => typeof s === 'string' && /^[A-Z2-9]{8}$/.test(s);

const niches = (j: unknown): string[] => (Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : []);

export interface CollabInput {
  creatorId: string;
  kind: CollabKind;
  brief: string;
  productIds?: string[];
  dropId?: string;
  fee?: number;
}

export interface DeliverInput {
  url?: string;
  lookIds?: string[];
  note?: string;
}

export interface CollabStats {
  visits: number;
  visitors: number;
  drapes: number;
  clicks: number;
  follows: number;
  lookViews: number;
}

/**
 * Creators (blueprint 3.9). Creators are stylists ThreadFlank has verified. A brand finds them by
 * niche, city and engagement, sends a collab request (a styled look, an unboxing or a launch post),
 * and tracks it through the collab's own link: visits, try-ons and follows from signed-in visitors
 * in the week after they opened it, buy clicks carrying the code, and views of the looks delivered.
 */
@Injectable()
export class CreatorsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly brandMail?: BrandNotifyService,
  ) {}

  private async creatorName(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    return u?.username ? `@${u.username}` : 'A creator';
  }

  private notify(userId: string, input: { type: string; title: string; body?: string; link?: string }) {
    void this.notifications?.createMany([userId], input).catch(() => undefined);
  }

  // ── Discovery ──────────────────────────────────────────────────────────

  async discover(brandId: string, filter: { q?: string; niche?: string; city?: string } = {}) {
    const profiles = await this.prisma.stylistProfile.findMany({ where: { status: 'VERIFIED' }, orderBy: { reviewedAt: 'desc' }, take: 300 });
    const ids = profiles.map((p) => p.userId);
    if (ids.length === 0) return { niches: [], creators: [] };
    const since = new Date(Date.now() - 90 * DAY);
    const [users, sent, received, looks, shares, done, mine] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, avatar: true } }),
      this.prisma.friendship.groupBy({ by: ['senderId'], where: { senderId: { in: ids }, status: 'ACCEPTED' }, _count: { _all: true } }),
      this.prisma.friendship.groupBy({ by: ['receiverId'], where: { receiverId: { in: ids }, status: 'ACCEPTED' }, _count: { _all: true } }),
      this.prisma.look.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
      this.prisma.shareEvent.groupBy({ by: ['sharedBy'], where: { sharedBy: { in: ids }, createdAt: { gte: since } }, _sum: { openCount: true } }),
      this.prisma.creatorCollab.groupBy({ by: ['creatorId'], where: { creatorId: { in: ids }, status: 'DONE' }, _count: { _all: true } }),
      this.prisma.creatorCollab.findMany({ where: { brandId, creatorId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { creatorId: true, status: true } }),
    ]);
    const user = new Map(users.map((u) => [u.id, u]));
    const count = <K extends string>(rows: ({ _count: { _all: number } } & Record<K, string>)[], key: K) => new Map(rows.map((r) => [r[key], r._count._all]));
    const friendsA = count(sent, 'senderId');
    const friendsB = count(received, 'receiverId');
    const lookN = count(looks, 'userId');
    const doneN = count(done, 'creatorId');
    const opens = new Map(shares.map((s) => [s.sharedBy, s._sum.openCount ?? 0]));
    const latest = new Map<string, string>();
    for (const m of mine) if (!latest.has(m.creatorId)) latest.set(m.creatorId, m.status);

    const all = profiles.map((p) => ({
      id: p.userId,
      name: p.displayName,
      username: user.get(p.userId)?.username ?? null,
      avatar: user.get(p.userId)?.avatar ?? null,
      bio: p.bio,
      city: p.city,
      niches: niches(p.specialties),
      portfolioUrl: p.portfolioUrl,
      friends: (friendsA.get(p.userId) ?? 0) + (friendsB.get(p.userId) ?? 0),
      looks: lookN.get(p.userId) ?? 0,
      /** Opens of the looks they shared in the last 90 days. */
      engagement: opens.get(p.userId) ?? 0,
      collabsDone: doneN.get(p.userId) ?? 0,
      myCollab: (latest.get(p.userId) ?? null) as string | null,
    }));

    const tally = new Map<string, { name: string; n: number }>();
    for (const c of all) for (const n of c.niches) {
      const k = n.toLowerCase();
      tally.set(k, { name: tally.get(k)?.name ?? n, n: (tally.get(k)?.n ?? 0) + 1 });
    }
    const q = filter.q?.trim().toLowerCase();
    const niche = filter.niche?.trim().toLowerCase();
    const city = filter.city?.trim().toLowerCase();
    const creators = all
      .filter((c) => (!q || c.name.toLowerCase().includes(q) || (c.username ?? '').toLowerCase().includes(q) || (c.bio ?? '').toLowerCase().includes(q)) && (!niche || c.niches.some((n) => n.toLowerCase() === niche)) && (!city || (c.city ?? '').toLowerCase().includes(city)))
      .sort((a, b) => b.engagement - a.engagement || b.friends - a.friends || b.looks - a.looks)
      .slice(0, 60);
    return { niches: [...tally.values()].sort((a, b) => b.n - a.n).map((t) => t.name).slice(0, 20), creators };
  }

  // ── Brand side ─────────────────────────────────────────────────────────

  async request(brandId: string, input: CollabInput) {
    if (!COLLAB_KINDS.includes(input.kind)) throw new BadRequestException('Pick what you want: a styled look, an unboxing or a launch post.');
    const brief = input.brief?.trim() ?? '';
    if (brief.length < 10) throw new BadRequestException('Tell the creator what you have in mind (at least a sentence).');
    if (brief.length > 1000) throw new BadRequestException('Keep the brief under 1000 characters.');
    if (input.fee != null && (!Number.isInteger(input.fee) || input.fee < 0)) throw new BadRequestException('The fee is a whole number of rupees.');
    const creator = await this.prisma.stylistProfile.findFirst({ where: { userId: input.creatorId, status: 'VERIFIED' }, select: { userId: true } });
    if (!creator) throw new NotFoundException('That creator is not available.');
    const open = await this.prisma.creatorCollab.findFirst({ where: { brandId, creatorId: input.creatorId, status: { in: OPEN } }, select: { id: true } });
    if (open) throw new ConflictException('You already have an open collab with this creator.');
    await assertPlanRoom(this.prisma, brandId, 'collabs');

    let productIds: string[] = [];
    if (input.productIds?.length) {
      const wanted = [...new Set(input.productIds)].slice(0, MAX_PIECES);
      const own = await this.prisma.brandProduct.findMany({ where: { brandId, id: { in: wanted }, status: 'PUBLISHED' }, select: { id: true } });
      const ok = new Set(own.map((o) => o.id));
      productIds = wanted.filter((id) => ok.has(id));
    }
    let dropId: string | null = null;
    if (input.dropId) {
      const drop = await this.prisma.brandDrop.findFirst({ where: { id: input.dropId, brandId }, select: { id: true } });
      if (!drop) throw new BadRequestException('That launch is not yours.');
      dropId = drop.id;
    }
    if (input.kind === 'LAUNCH_PROMO' && !dropId) throw new BadRequestException('Pick the launch the post is for.');

    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });
    for (let attempt = 0; ; attempt++) {
      try {
        const row = await this.prisma.creatorCollab.create({ data: { brandId, creatorId: input.creatorId, kind: input.kind, brief, productIds, dropId, fee: input.fee ?? null, code: collabCode() } });
        this.notify(input.creatorId, { type: 'CREATOR_COLLAB', title: `${brand?.name ?? 'A brand'} wants to collab`, body: `They'd like ${KIND_LABEL[input.kind]}. Open it to accept or decline.`, link: '/creator' });
        return row;
      } catch (e: any) {
        // A code collision is astronomically rare; try a fresh one.
        if (e?.code === 'P2002' && attempt < 3) continue;
        throw e;
      }
    }
  }

  async listForBrand(brandId: string) {
    const rows = await this.prisma.creatorCollab.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 50 });
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map((r) => r.creatorId))];
    const [profiles, users] = await Promise.all([
      this.prisma.stylistProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, displayName: true, city: true } }),
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, avatar: true } }),
    ]);
    const prof = new Map(profiles.map((p) => [p.userId, p]));
    const user = new Map(users.map((u) => [u.id, u]));
    return Promise.all(
      rows.map(async (r) => ({
        ...this.view(r),
        creator: { id: r.creatorId, name: prof.get(r.creatorId)?.displayName ?? user.get(r.creatorId)?.username ?? 'Creator', username: user.get(r.creatorId)?.username ?? null, avatar: user.get(r.creatorId)?.avatar ?? null, city: prof.get(r.creatorId)?.city ?? null },
        stats: r.status === 'ACCEPTED' || r.status === 'DONE' ? await this.stats(r) : null,
      })),
    );
  }

  async cancel(brandId: string, id: string) {
    const row = await this.prisma.creatorCollab.findFirst({ where: { id, brandId } });
    if (!row) throw new NotFoundException('Collab not found.');
    if (!OPEN.includes(row.status)) throw new BadRequestException('Only a pending or accepted collab can be called off.');
    await this.prisma.creatorCollab.update({ where: { id }, data: { status: 'CANCELLED' } });
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });
    this.notify(row.creatorId, { type: 'CREATOR_COLLAB', title: `${brand?.name ?? 'The brand'} called off the collab`, link: '/creator' });
    return { cancelled: true };
  }

  // ── Creator side ───────────────────────────────────────────────────────

  async mine(userId: string) {
    const rows = await this.prisma.creatorCollab.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { brand: { select: { name: true, slug: true, logoUrl: true } } },
    });
    const pieceIds = [...new Set(rows.flatMap((r) => r.productIds))];
    const dropIds = [...new Set(rows.map((r) => r.dropId).filter((d): d is string => Boolean(d)))];
    const [pieces, drops] = await Promise.all([
      pieceIds.length ? this.prisma.brandProduct.findMany({ where: { id: { in: pieceIds } }, select: { id: true, title: true, images: true, price: true } }) : Promise.resolve([]),
      dropIds.length ? this.prisma.brandDrop.findMany({ where: { id: { in: dropIds } }, select: { id: true, title: true, launchDate: true } }) : Promise.resolve([]),
    ]);
    const piece = new Map(pieces.map((p) => [p.id, { id: p.id, title: p.title, image: p.images[0] ?? null, price: p.price }] as const));
    const drop = new Map(drops.map((d) => [d.id, { id: d.id, name: d.title, launchDate: d.launchDate.toISOString() }]));
    return Promise.all(
      rows.map(async (r) => ({
        ...this.view(r),
        brand: r.brand,
        pieces: r.productIds.map((id) => piece.get(id)).filter(Boolean),
        drop: r.dropId ? drop.get(r.dropId) ?? null : null,
        stats: r.status === 'ACCEPTED' || r.status === 'DONE' ? await this.stats(r) : null,
      })),
    );
  }

  private async own(userId: string, id: string) {
    const row = await this.prisma.creatorCollab.findFirst({ where: { id, creatorId: userId } });
    if (!row) throw new NotFoundException('Collab not found.');
    return row;
  }

  async respond(userId: string, id: string, accept: boolean) {
    const row = await this.own(userId, id);
    if (row.status !== 'PENDING') throw new BadRequestException('You have already answered this one.');
    const updated = await this.prisma.creatorCollab.update({ where: { id }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date() } });
    const who = await this.creatorName(userId);
    this.brandMail?.send(row.brandId, 'collabs', { subject: `${who} ${accept ? 'accepted' : 'declined'} your collab`, lines: [accept ? `${who} said yes. You'll get another email when they deliver.` : `${who} can't take this one on.`], path: '/creators' });
    return this.view(updated);
  }

  async deliver(userId: string, id: string, input: DeliverInput) {
    const row = await this.own(userId, id);
    if (row.status !== 'ACCEPTED') throw new BadRequestException('Accept the collab before marking it done.');
    const url = input.url?.trim() || null;
    if (url && !/^https:\/\/\S+$/i.test(url)) throw new BadRequestException('Paste the full https:// link to your post.');
    let lookIds: string[] = [];
    if (input.lookIds?.length) {
      const own = await this.prisma.look.findMany({ where: { userId, id: { in: [...new Set(input.lookIds)].slice(0, 12) } }, select: { id: true } });
      lookIds = own.map((l) => l.id);
    }
    if (!url && lookIds.length === 0) throw new BadRequestException('Add the link to your post or pick the looks you made.');
    const updated = await this.prisma.creatorCollab.update({ where: { id }, data: { status: 'DONE', deliverableUrl: url, lookIds, creatorNote: input.note?.trim().slice(0, 500) || null, completedAt: new Date() } });
    const who = await this.creatorName(userId);
    this.brandMail?.send(row.brandId, 'collabs', { subject: `${who} delivered your collab`, lines: [`${who} marked the collab done.`, ...(url ? [`Their post: ${url}`] : [])], path: '/creators' });
    return this.view(updated);
  }

  /** Stylists who aren't verified can't be found by brands, so the creator page explains how to get there. */
  async creatorStatus(userId: string) {
    const p = await this.prisma.stylistProfile.findUnique({ where: { userId }, select: { status: true } });
    return { status: p?.status ?? null };
  }

  // ── Tracking link ──────────────────────────────────────────────────────

  /** /c/:code — counts the visit and says where to send the shopper. */
  async resolve(code: string, userId?: string) {
    const c = code.toUpperCase();
    if (!isCollabCode(c)) throw new NotFoundException('Link not found.');
    const row = await this.prisma.creatorCollab.findUnique({ where: { code: c }, include: { brand: { select: { slug: true, status: true, isDeleted: true } } } });
    if (!row || !['ACCEPTED', 'DONE'].includes(row.status) || row.brand.isDeleted || row.brand.status !== 'ACTIVE') throw new NotFoundException('Link not found.');
    await this.prisma.creatorVisit.create({ data: { collabId: row.id, userId: userId ?? null } });
    const path = row.dropId ? `/launch/${row.dropId}` : `/brands/${row.brand.slug}`;
    return { path: `${path}?ref=${c}`, brandSlug: row.brand.slug, ref: c };
  }

  // ── Stats ──────────────────────────────────────────────────────────────

  async stats(row: { id: string; brandId: string; code: string; lookIds: string[] }): Promise<CollabStats> {
    const visits = await this.prisma.creatorVisit.findMany({ where: { collabId: row.id }, select: { userId: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 5000 });
    // Each signed-in visitor's window starts at their first visit.
    const first = new Map<string, number>();
    for (const v of visits) if (v.userId && !first.has(v.userId)) first.set(v.userId, v.createdAt.getTime());
    const visitorIds = [...first.keys()];
    const earliest = visitorIds.length ? new Date(Math.min(...first.values())) : null;
    const inWindow = (userId: string | null, at: Date) => {
      const start = userId ? first.get(userId) : undefined;
      return start !== undefined && at.getTime() >= start && at.getTime() <= start + ATTRIBUTION_DAYS * DAY;
    };
    const [drapes, follows, clicks, shares] = await Promise.all([
      earliest ? this.prisma.brandEvent.findMany({ where: { brandId: row.brandId, type: 'DRAPE', userId: { in: visitorIds }, createdAt: { gte: earliest } }, select: { userId: true, createdAt: true } }) : [],
      earliest ? this.prisma.brandFollow.findMany({ where: { brandId: row.brandId, userId: { in: visitorIds }, createdAt: { gte: earliest } }, select: { userId: true, createdAt: true } }) : [],
      this.prisma.brandEvent.count({ where: { brandId: row.brandId, type: 'CLICK', ref: row.code } }),
      row.lookIds.length ? this.prisma.shareEvent.aggregate({ where: { lookId: { in: row.lookIds } }, _sum: { openCount: true } }) : null,
    ]);
    return {
      visits: visits.length,
      visitors: visitorIds.length,
      drapes: drapes.filter((d) => inWindow(d.userId, d.createdAt)).length,
      follows: follows.filter((f) => inWindow(f.userId, f.createdAt)).length,
      clicks,
      lookViews: shares?._sum.openCount ?? 0,
    };
  }

  private view(r: { id: string; kind: string; brief: string; productIds: string[]; dropId: string | null; fee: number | null; status: string; code: string; deliverableUrl: string | null; lookIds: string[]; creatorNote: string | null; respondedAt: Date | null; completedAt: Date | null; createdAt: Date }) {
    return {
      id: r.id,
      kind: r.kind as CollabKind,
      brief: r.brief,
      productIds: r.productIds,
      dropId: r.dropId,
      fee: r.fee,
      status: r.status as 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'DONE' | 'CANCELLED',
      code: r.code,
      /** Path on the shopper app; the panels prefix their own origin. */
      linkPath: `/c/${r.code}`,
      deliverableUrl: r.deliverableUrl,
      lookIds: r.lookIds,
      creatorNote: r.creatorNote,
      respondedAt: r.respondedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Guard for routes that only verified creators use. */
  async assertCreator(userId: string) {
    const p = await this.prisma.stylistProfile.findUnique({ where: { userId }, select: { status: true } });
    if (p?.status !== 'VERIFIED') throw new ForbiddenException('Only verified stylists can take collabs.');
  }
}
