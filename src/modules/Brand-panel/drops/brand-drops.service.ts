import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertPlanRoom } from '../billing/plans';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateDropDto, UpdateDropDto } from '../dto/brand-common.dto';

export interface LaunchDropEntity {
  id: string;
  title: string;
  collectionName: string;
  description?: string;
  launchDate: string;
  waitlistCount: number;
  status: 'scheduled' | 'live' | 'completed';
  bannerUrl: string;
  productsCount: number;
  skuCount?: number;
  countdownDays?: number;
  teaserUrl?: string;
  /** Live pieces in the drop's collection right now (filled in the brand's own list). */
  livePieces?: number;
}

type Row = Prisma.BrandDropGetPayload<{ include: { _count: { select: { waitlist: true } } } }>;
const WITH_COUNT = { _count: { select: { waitlist: true } } } as const;

/** A drop is "live" from its launch time and "completed" a week after. */
const LIVE_WINDOW_MS = 7 * 86_400_000;

const toEntity = (r: Row): LaunchDropEntity => {
  const msLeft = r.launchDate.getTime() - Date.now();
  return {
    id: r.id,
    title: r.title,
    collectionName: r.collectionName,
    description: r.description ?? undefined,
    launchDate: r.launchDate.toISOString(),
    waitlistCount: r._count.waitlist,
    status: msLeft > 0 ? 'scheduled' : -msLeft > LIVE_WINDOW_MS ? 'completed' : 'live',
    bannerUrl: r.bannerUrl,
    productsCount: r.productsCount,
    countdownDays: Math.max(0, Math.ceil(msLeft / 86_400_000)),
    teaserUrl: r.teaserUrl ?? undefined,
  };
};

@Injectable()
export class BrandDropsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Today is fine (the date picker sends midnight); earlier days are not. */
  private assertNotPast(launchDate: string) {
    if (new Date(launchDate).getTime() < Date.now() - 86_400_000) {
      throw new BadRequestException('Launch date cannot be in the past.');
    }
  }

  async findAll(brandId: string): Promise<LaunchDropEntity[]> {
    const rows = await this.prisma.brandDrop.findMany({ where: { brandId }, orderBy: { launchDate: 'desc' }, include: WITH_COUNT });
    // How many live pieces each drop's collection has, so the brand sees an empty launch before it happens.
    const counts = await this.prisma.brandProduct.groupBy({ by: ['collection'], where: { brandId, status: 'PUBLISHED', collection: { not: null } }, _count: { _all: true } });
    const byName = new Map(counts.map((c) => [(c.collection as string).toLowerCase(), c._count._all]));
    return rows.map((r) => ({ ...toEntity(r), livePieces: byName.get(r.collectionName.toLowerCase()) ?? 0 }));
  }

  count(brandId: string) {
    return this.prisma.brandDrop.count({ where: { brandId } });
  }

  async create(brandId: string, dto: CreateDropDto): Promise<LaunchDropEntity> {
    this.assertNotPast(dto.launchDate);
    await assertPlanRoom(this.prisma, brandId, 'drops');
    const row = await this.prisma.brandDrop.create({
      data: {
        brandId,
        title: dto.title,
        collectionName: dto.collectionName,
        description: dto.description,
        launchDate: new Date(dto.launchDate),
        bannerUrl: dto.bannerUrl ?? '',
        productsCount: dto.productsCount || 1,
        teaserUrl: dto.teaserUrl?.trim() || null,
      },
      include: WITH_COUNT,
    });
    return toEntity(row);
  }

  async update(brandId: string, id: string, dto: UpdateDropDto): Promise<LaunchDropEntity> {
    const existing = await this.prisma.brandDrop.findFirst({ where: { id, brandId } });
    if (!existing) throw new NotFoundException('Drop not found.');
    if (dto.launchDate !== undefined) this.assertNotPast(dto.launchDate);
    const { launchDate, teaserUrl, ...rest } = dto;
    const row = await this.prisma.brandDrop.update({
      where: { id },
      data: {
        ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        ...(launchDate ? { launchDate: new Date(launchDate) } : {}),
        ...(teaserUrl !== undefined ? { teaserUrl: teaserUrl.trim() || null } : {}),
      },
      include: WITH_COUNT,
    });
    return toEntity(row);
  }

  async remove(brandId: string, id: string) {
    const { count } = await this.prisma.brandDrop.deleteMany({ where: { id, brandId } });
    if (count === 0) throw new NotFoundException('Drop not found.');
    return { success: true, id };
  }

  // ── Shopper-facing ──────────────────────────────────────────────────────

  /** Upcoming and live drops only; finished ones drop off the brand page. */
  async listPublic(brandId: string, userId?: string) {
    const rows = await this.prisma.brandDrop.findMany({
      where: { brandId, launchDate: { gt: new Date(Date.now() - LIVE_WINDOW_MS) } },
      orderBy: { launchDate: 'asc' },
      include: WITH_COUNT,
      take: 20,
    });
    const joined = userId
      ? new Set((await this.prisma.dropWaitlistEntry.findMany({ where: { userId, dropId: { in: rows.map((r) => r.id) } }, select: { dropId: true } })).map((w) => w.dropId))
      : new Set<string>();
    return rows.map((r) => {
      const { skuCount: _s, ...drop } = toEntity(r);
      return { ...drop, joined: joined.has(r.id) };
    });
  }

  private async publicDrop(dropId: string) {
    const drop = await this.prisma.brandDrop.findFirst({ where: { id: dropId, brand: { isDeleted: false, status: 'ACTIVE' } } });
    if (!drop) throw new NotFoundException('Drop not found.');
    return drop;
  }

  /** Idempotent: joining twice leaves one entry. Past drops can't be joined. */
  async joinWaitlist(dropId: string, userId: string) {
    const drop = await this.publicDrop(dropId);
    if (drop.launchDate.getTime() <= Date.now()) throw new BadRequestException('This drop has already launched.');
    await this.prisma.dropWaitlistEntry.upsert({ where: { dropId_userId: { dropId, userId } }, create: { dropId, userId }, update: {} });
    return { joined: true, waitlistCount: await this.prisma.dropWaitlistEntry.count({ where: { dropId } }) };
  }

  async leaveWaitlist(dropId: string, userId: string) {
    await this.publicDrop(dropId);
    await this.prisma.dropWaitlistEntry.deleteMany({ where: { dropId, userId } });
    return { joined: false, waitlistCount: await this.prisma.dropWaitlistEntry.count({ where: { dropId } }) };
  }
}
