import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { WITH_COUNTS, toPublicProduct } from '../catalog/brand-catalog.service';
import { toSlug } from '../store/store-layout';
import { upcomingFestivals } from './festival-calendar';

export const MAX_ENTRY_PIECES = 24;
const DAY = 86_400_000;

export interface CampaignInput {
  name?: string;
  description?: string;
  occasion?: string;
  bannerUrl?: string;
  startsAt?: string;
  endsAt?: string;
  joinBy?: string | null;
  isActive?: boolean;
}

type CampaignRow = Prisma.CampaignGetPayload<{ include: { _count: { select: { entries: true } } } }>;

const statusOf = (c: { startsAt: Date; endsAt: Date }, now = Date.now()) => (now < c.startsAt.getTime() ? 'upcoming' : now < c.endsAt.getTime() ? 'live' : 'ended');
const canJoin = (c: { endsAt: Date; joinBy: Date | null; isActive: boolean }, now = Date.now()) => c.isActive && now < (c.joinBy ?? c.endsAt).getTime();

const view = (c: CampaignRow) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  description: c.description ?? '',
  occasion: c.occasion ?? '',
  bannerUrl: c.bannerUrl,
  startsAt: c.startsAt.toISOString(),
  endsAt: c.endsAt.toISOString(),
  joinBy: c.joinBy?.toISOString() ?? null,
  isActive: c.isActive,
  status: statusOf(c),
  brands: c._count.entries,
});

/**
 * Platform campaigns ("Diwali Edit"): admins create them, brands opt in with their own live pieces,
 * shoppers browse them while they run, and brands see how their pieces did.
 */
@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Admin ──────────────────────────────────────────────────────────────

  async adminList() {
    const rows = await this.prisma.campaign.findMany({ orderBy: { startsAt: 'desc' }, include: { _count: { select: { entries: true } } }, take: 200 });
    return rows.map(view);
  }

  private dates(input: CampaignInput, current?: { startsAt: Date; endsAt: Date }) {
    const startsAt = input.startsAt ? new Date(input.startsAt) : current?.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : current?.endsAt;
    if (!startsAt || !endsAt) throw new BadRequestException('A campaign needs a start and an end.');
    if (endsAt <= startsAt) throw new BadRequestException('The campaign has to end after it starts.');
    const joinBy = input.joinBy === undefined ? undefined : input.joinBy ? new Date(input.joinBy) : null;
    if (joinBy && joinBy > endsAt) throw new BadRequestException('Brands have to be able to join before the campaign ends.');
    return { startsAt, endsAt, joinBy };
  }

  async create(input: CampaignInput, adminId?: string) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Give the campaign a name.');
    const { startsAt, endsAt, joinBy } = this.dates(input);
    const base = toSlug(name) || 'campaign';
    let slug = base;
    for (let i = 2; await this.prisma.campaign.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
    const row = await this.prisma.campaign.create({
      data: { slug, name, description: input.description?.trim() || null, occasion: input.occasion?.trim() || null, bannerUrl: input.bannerUrl?.trim() ?? '', startsAt, endsAt, joinBy: joinBy ?? null, isActive: input.isActive ?? true, createdByAdminId: adminId ?? null },
      include: { _count: { select: { entries: true } } },
    });
    return view(row);
  }

  async update(id: string, input: CampaignInput) {
    const current = await this.prisma.campaign.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Campaign not found.');
    const { startsAt, endsAt, joinBy } = this.dates(input, current);
    const row = await this.prisma.campaign.update({
      where: { id },
      data: {
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
        ...(input.occasion !== undefined ? { occasion: input.occasion.trim() || null } : {}),
        ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl.trim() } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        startsAt,
        endsAt,
        ...(joinBy !== undefined ? { joinBy } : {}),
      },
      include: { _count: { select: { entries: true } } },
    });
    return view(row);
  }

  // ── Brand ──────────────────────────────────────────────────────────────

  /** Campaigns a brand can see: running or coming up, and those that ended in the last 30 days (for reports). */
  async forBrand(brandId: string) {
    const rows = await this.prisma.campaign.findMany({
      where: { isActive: true, endsAt: { gt: new Date(Date.now() - 30 * DAY) } },
      orderBy: { startsAt: 'asc' },
      include: { _count: { select: { entries: true } }, entries: { where: { brandId }, select: { productIds: true, joinedAt: true } } },
    });
    return rows.map((c) => ({ ...view(c), canJoin: canJoin(c), entry: c.entries[0] ? { productIds: c.entries[0].productIds, joinedAt: c.entries[0].joinedAt.toISOString() } : null }));
  }

  /** Joins (or changes the pieces in) a campaign. Only the brand's own live pieces count. */
  async join(brandId: string, campaignId: string, productIds: string[]) {
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!c || !c.isActive) throw new NotFoundException('Campaign not found.');
    if (!canJoin(c)) throw new BadRequestException('This campaign is closed to new pieces.');
    const wanted = [...new Set(productIds)].slice(0, MAX_ENTRY_PIECES);
    if (wanted.length === 0) throw new BadRequestException('Pick at least one piece.');
    const own = await this.prisma.brandProduct.findMany({ where: { brandId, status: 'PUBLISHED', id: { in: wanted } }, select: { id: true } });
    const ok = new Set(own.map((o) => o.id));
    const picked = wanted.filter((id) => ok.has(id));
    if (picked.length === 0) throw new BadRequestException('None of those pieces are live in your catalog.');
    const entry = await this.prisma.campaignEntry.upsert({
      where: { campaignId_brandId: { campaignId, brandId } },
      create: { campaignId, brandId, productIds: picked },
      update: { productIds: picked },
    });
    return { productIds: entry.productIds, skipped: wanted.length - picked.length };
  }

  async leave(brandId: string, campaignId: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { startsAt: true, endsAt: true } });
    if (!c) throw new NotFoundException('Campaign not found.');
    if (statusOf(c) === 'ended') throw new ConflictException('This campaign has ended; its report stays available.');
    await this.prisma.campaignEntry.deleteMany({ where: { campaignId, brandId } });
    return { left: true };
  }

  /** What shoppers did with the brand's campaign pieces while the campaign ran (so far, if it still is). */
  async report(brandId: string, campaignId: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!c) throw new NotFoundException('Campaign not found.');
    const entry = await this.prisma.campaignEntry.findUnique({ where: { campaignId_brandId: { campaignId, brandId } } });
    if (!entry) throw new NotFoundException("You haven't joined this campaign.");
    const base = { campaign: c.name, status: statusOf(c), startsAt: c.startsAt.toISOString(), endsAt: c.endsAt.toISOString(), pieces: entry.productIds.length };
    if (statusOf(c) === 'upcoming' || entry.productIds.length === 0) return { ...base, totals: { views: 0, drapes: 0, saves: 0, shares: 0, clicks: 0 }, byPiece: [] };

    const until = new Date(Math.min(c.endsAt.getTime(), Date.now()));
    const rows = await this.prisma.brandEvent.groupBy({
      by: ['productId', 'type'],
      where: { brandId, productId: { in: entry.productIds }, createdAt: { gte: c.startsAt, lt: until } },
      _count: { _all: true },
    });
    const totals = { views: 0, drapes: 0, saves: 0, shares: 0, clicks: 0 };
    const per = new Map<string, typeof totals>();
    for (const r of rows) {
      const key = r.type === 'PRODUCT_VIEW' ? 'views' : r.type === 'DRAPE' ? 'drapes' : r.type === 'SAVE' ? 'saves' : r.type === 'SHARE' ? 'shares' : r.type === 'CLICK' ? 'clicks' : null;
      if (!key || !r.productId) continue;
      totals[key] += r._count._all;
      const p = per.get(r.productId) ?? { views: 0, drapes: 0, saves: 0, shares: 0, clicks: 0 };
      p[key] += r._count._all;
      per.set(r.productId, p);
    }
    const names = await this.prisma.brandProduct.findMany({ where: { id: { in: entry.productIds } }, select: { id: true, title: true, images: true } });
    const byPiece = names
      .map((n) => ({ id: n.id, title: n.title, image: n.images[0] ?? '', ...(per.get(n.id) ?? { views: 0, drapes: 0, saves: 0, shares: 0, clicks: 0 }) }))
      .sort((a, b) => b.drapes - a.drapes || b.views - a.views);
    return { ...base, totals, byPiece };
  }

  /** Festivals and platform campaigns over the next year, merged, soonest first. */
  async calendar() {
    const campaigns = await this.prisma.campaign.findMany({ where: { isActive: true, endsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' }, take: 50 });
    return [
      ...upcomingFestivals().map((f) => ({ kind: f.kind, id: f.id, name: f.name, start: f.start, end: f.end ?? null, approximate: f.approximate, occasion: f.occasion ?? null })),
      ...campaigns.map((c) => ({ kind: 'campaign' as const, id: c.id, name: c.name, start: c.startsAt.toISOString().slice(0, 10), end: c.endsAt.toISOString().slice(0, 10), approximate: false, occasion: c.occasion })),
    ].sort((a, b) => a.start.localeCompare(b.start));
  }

  // ── Shoppers ───────────────────────────────────────────────────────────

  /** Campaigns running now, with a cover from their pieces when there's no banner. */
  async live() {
    const now = new Date();
    const rows = await this.prisma.campaign.findMany({ where: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } }, include: { _count: { select: { entries: true } } }, orderBy: { endsAt: 'asc' } });
    return rows.filter((c) => c._count.entries > 0).map(view);
  }

  async page(slug: string, userId?: string) {
    const c = await this.prisma.campaign.findFirst({ where: { slug, isActive: true }, include: { _count: { select: { entries: true } }, entries: { select: { productIds: true } } } });
    if (!c || statusOf(c) === 'upcoming') throw new NotFoundException('Campaign not found.');
    const ids = c.entries.flatMap((e) => e.productIds);
    const rows = ids.length
      ? await this.prisma.brandProduct.findMany({
          where: { id: { in: ids }, status: 'PUBLISHED', brand: { isDeleted: false, status: 'ACTIVE' } },
          include: { ...WITH_COUNTS, brand: { select: { id: true, name: true, slug: true, logoUrl: true } } },
          orderBy: [{ drapesCount: 'desc' }, { createdAt: 'desc' }],
          take: 200,
        })
      : [];
    const liked = userId && rows.length ? new Set((await this.prisma.brandProductLike.findMany({ where: { userId, productId: { in: rows.map((r) => r.id) } }, select: { productId: true } })).map((l) => l.productId)) : new Set<string>();
    return {
      campaign: view(c),
      pieces: rows.map((r) => ({ ...toPublicProduct(r), likedByMe: liked.has(r.id), brand: { id: r.brand.id, name: r.brand.name, slug: r.brand.slug, logo: r.brand.logoUrl ?? '' } })),
    };
  }
}
