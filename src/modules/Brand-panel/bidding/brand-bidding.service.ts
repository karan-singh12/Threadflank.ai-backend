import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BidCycleStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlaceBidDto } from '../dto/brand-common.dto';

export interface Top10BidSlotEntity {
  rankPosition: number;
  category: string;
  period: string;
  title?: string;
  /** Highest bid so far; 0 when nobody has bid. */
  currentHighestBid: number;
  /** The least a new bid must be: the starting price, or one rupee above the top bid. */
  minimumBid: number;
  yourCurrentBid?: number;
  status: 'winning' | 'outbid' | 'open';
  impressionsEstimate: string;
  endsInHours: number;
  endsAt: string;
  projectedAudience?: { views: number; drapes: number };
}

type SlotWithBids = Prisma.BidSlotGetPayload<{ include: { bids: { select: { brandId: true; amount: true; createdAt: true } } } }>;

/** Highest amount wins; on a tie the earlier bid keeps the lead. */
export function leaderOf(bids: { brandId: string; amount: number; createdAt: Date }[]) {
  return bids.reduce<(typeof bids)[number] | undefined>(
    (best, b) => (!best || b.amount > best.amount || (b.amount === best.amount && b.createdAt < best.createdAt) ? b : best),
    undefined,
  );
}

export interface CreateCycleInput {
  label: string;
  endsAt: string;
  slots: { title: string; category: string; minBid?: number; impressionsEstimate?: string; projectedViews?: number; projectedDrapes?: number }[];
}

/**
 * Runway auctions. Admins open a cycle with its slots; approved brands bid until it ends; the highest
 * bid on each slot wins when the cycle closes. Bids are append-only, so the standing is always derived
 * from the bids themselves and two brands bidding at once can never corrupt each other.
 */
@Injectable()
export class BrandBiddingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Brand side ──────────────────────────────────────────────────────────

  private async openCycle() {
    await this.closeExpired();
    return this.prisma.bidCycle.findFirst({
      where: { status: BidCycleStatus.OPEN },
      orderBy: { endsAt: 'asc' },
      include: { slots: { orderBy: { rank: 'asc' }, include: { bids: { select: { brandId: true, amount: true, createdAt: true } } } } },
    });
  }

  private view(slot: SlotWithBids, cycle: { label: string; endsAt: Date }, brandId: string): Top10BidSlotEntity {
    const leader = leaderOf(slot.bids);
    const mine = slot.bids.filter((b) => b.brandId === brandId).reduce((m, b) => Math.max(m, b.amount), 0);
    const top = leader?.amount ?? 0;
    return {
      rankPosition: slot.rank,
      category: slot.category,
      period: cycle.label,
      title: slot.title,
      currentHighestBid: top,
      minimumBid: top > 0 ? top + 1 : slot.minBid,
      yourCurrentBid: mine || undefined,
      status: !mine ? 'open' : leader?.brandId === brandId ? 'winning' : 'outbid',
      impressionsEstimate: slot.impressionsEstimate,
      endsInHours: Math.max(0, Math.ceil((cycle.endsAt.getTime() - Date.now()) / 3_600_000)),
      endsAt: cycle.endsAt.toISOString(),
      projectedAudience: { views: slot.projectedViews, drapes: slot.projectedDrapes },
    };
  }

  /** Slots of the open auction with this brand's standing; empty when no auction is running. */
  async findAll(brandId: string): Promise<Top10BidSlotEntity[]> {
    const cycle = await this.openCycle();
    return cycle ? cycle.slots.map((s) => this.view(s, cycle, brandId)) : [];
  }

  async placeBid(brandId: string, rank: number, dto: PlaceBidDto) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { status: true, isDeleted: true } });
    if (!brand || brand.isDeleted) throw new NotFoundException('Brand not found.');
    if (brand.status !== 'ACTIVE') {
      throw new ForbiddenException('Your brand must be approved before you can bid. We will email you once the review is done.');
    }

    const cycle = await this.openCycle();
    if (!cycle) throw new BadRequestException('There is no auction open right now.');
    const slot = cycle.slots.find((s) => s.rank === rank);
    if (!slot) throw new NotFoundException(`Runway spotlight slot at rank #${rank} does not exist.`);

    const view = this.view(slot, cycle, brandId);
    if (dto.bidAmount < slot.minBid) {
      throw new BadRequestException(`The starting bid for this slot is ₹${slot.minBid.toLocaleString('en-IN')}.`);
    }
    if (dto.bidAmount < view.minimumBid) {
      throw new BadRequestException(`Bid amount must be strictly greater than the current leading bid of ₹${view.currentHighestBid.toLocaleString('en-IN')}`);
    }

    await this.prisma.bid.create({ data: { slotId: slot.id, brandId, amount: Math.round(dto.bidAmount) } });
    const fresh = await this.prisma.bidSlot.findUniqueOrThrow({ where: { id: slot.id }, include: { bids: { select: { brandId: true, amount: true, createdAt: true } } } });
    const updated = this.view(fresh, cycle, brandId);
    return {
      slot: updated,
      message:
        updated.status === 'winning'
          ? `You are now the leading bidder for Rank #${rank} (${slot.category}) at ₹${dto.bidAmount.toLocaleString('en-IN')}.`
          : `Your bid was recorded, but another brand bid higher at the same moment. The top bid is ₹${updated.currentHighestBid.toLocaleString('en-IN')}.`,
    };
  }

  /** Slots this brand has won in closed auctions, newest first. */
  async wins(brandId: string) {
    const slots = await this.prisma.bidSlot.findMany({ where: { winnerBrandId: brandId }, orderBy: { cycle: { closedAt: 'desc' } }, include: { cycle: { select: { label: true, endsAt: true } } }, take: 20 });
    return slots.map((s) => ({ id: s.id, rank: s.rank, title: s.title, category: s.category, amount: s.winningAmount, period: s.cycle.label, endedAt: s.cycle.endsAt.toISOString(), paid: s.paid }));
  }

  // ── Closing ─────────────────────────────────────────────────────────────

  /** Closes every cycle past its end time and records each slot's winner. Safe to run repeatedly. */
  @Cron('* * * * *')
  async closeExpired() {
    const due = await this.prisma.bidCycle.findMany({ where: { status: BidCycleStatus.OPEN, endsAt: { lte: new Date() } }, select: { id: true } });
    for (const { id } of due) await this.closeCycle(id);
  }

  async closeCycle(cycleId: string) {
    return this.prisma.$transaction(async (tx) => {
      // The status guard makes concurrent closers harmless: only one of them flips OPEN to CLOSED.
      const { count } = await tx.bidCycle.updateMany({ where: { id: cycleId, status: BidCycleStatus.OPEN }, data: { status: BidCycleStatus.CLOSED, closedAt: new Date() } });
      if (count === 0) return false;
      const slots = await tx.bidSlot.findMany({ where: { cycleId }, include: { bids: { select: { brandId: true, amount: true, createdAt: true } } } });
      for (const slot of slots) {
        const leader = leaderOf(slot.bids);
        if (leader) await tx.bidSlot.update({ where: { id: slot.id }, data: { winnerBrandId: leader.brandId, winningAmount: leader.amount } });
      }
      return true;
    });
  }

  // ── Admin side ──────────────────────────────────────────────────────────

  async createCycle(input: CreateCycleInput, adminUserId: string) {
    const endsAt = new Date(input.endsAt);
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) throw new BadRequestException('The auction must end in the future.');
    if (!input.slots.length || input.slots.length > 20) throw new BadRequestException('Add between 1 and 20 slots.');
    if (await this.prisma.bidCycle.findFirst({ where: { status: BidCycleStatus.OPEN, endsAt: { gt: new Date() } } })) {
      throw new BadRequestException('An auction is already open. Close it before opening another.');
    }
    return this.prisma.bidCycle.create({
      data: {
        label: input.label,
        endsAt,
        createdByAdminId: adminUserId,
        slots: {
          create: input.slots.map((s, i) => ({
            rank: i + 1,
            title: s.title,
            category: s.category,
            minBid: s.minBid ?? 1000,
            impressionsEstimate: s.impressionsEstimate ?? '',
            projectedViews: s.projectedViews ?? 0,
            projectedDrapes: s.projectedDrapes ?? 0,
          })),
        },
      },
      include: { slots: true },
    });
  }

  async listCycles() {
    await this.closeExpired();
    const cycles = await this.prisma.bidCycle.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { slots: { orderBy: { rank: 'asc' }, include: { bids: { select: { brandId: true, amount: true, createdAt: true } } } } },
    });
    const winnerIds = [...new Set(cycles.flatMap((c) => c.slots.map((s) => s.winnerBrandId).filter((x): x is string => !!x)))];
    const brands = await this.prisma.brand.findMany({ where: { id: { in: winnerIds } }, select: { id: true, name: true } });
    const names = new Map(brands.map((b) => [b.id, b.name]));
    return cycles.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      endsAt: c.endsAt.toISOString(),
      closedAt: c.closedAt?.toISOString() ?? null,
      slots: c.slots.map((s) => {
        const leader = leaderOf(s.bids);
        return {
          id: s.id,
          rank: s.rank,
          title: s.title,
          category: s.category,
          minBid: s.minBid,
          bidCount: s.bids.length,
          topBid: leader?.amount ?? 0,
          winnerBrandId: s.winnerBrandId,
          winnerName: s.winnerBrandId ? names.get(s.winnerBrandId) ?? null : null,
          winningAmount: s.winningAmount,
          paid: s.paid,
        };
      }),
    }));
  }

  /** Every bid on a slot with the brand that made it, highest first. */
  async slotBids(slotId: string) {
    const bids = await this.prisma.bid.findMany({ where: { slotId }, orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }], include: { brand: { select: { id: true, name: true } } }, take: 200 });
    return bids.map((b) => ({ id: b.id, brandId: b.brand.id, brandName: b.brand.name, amount: b.amount, createdAt: b.createdAt.toISOString() }));
  }

  async markPaid(slotId: string, paid: boolean) {
    const slot = await this.prisma.bidSlot.findUnique({ where: { id: slotId }, include: { cycle: { select: { status: true } } } });
    if (!slot) throw new NotFoundException('Slot not found.');
    if (slot.cycle.status !== BidCycleStatus.CLOSED || !slot.winnerBrandId) throw new BadRequestException('Only a won slot in a closed auction can be marked paid.');
    await this.prisma.bidSlot.update({ where: { id: slotId }, data: { paid } });
    return { id: slotId, paid };
  }

  // ── Shopper side ────────────────────────────────────────────────────────

  /** Brands that won a slot in the most recent closed auction, in rank order. */
  async spotlight() {
    const cycle = await this.prisma.bidCycle.findFirst({
      where: { status: BidCycleStatus.CLOSED, slots: { some: { winnerBrandId: { not: null } } } },
      orderBy: { closedAt: 'desc' },
      include: { slots: { where: { winnerBrandId: { not: null } }, orderBy: { rank: 'asc' } } },
    });
    if (!cycle) return { period: null, brands: [] };
    const brands = await this.prisma.brand.findMany({
      where: { id: { in: cycle.slots.map((s) => s.winnerBrandId!) }, isDeleted: false, status: 'ACTIVE' },
      select: { id: true, name: true, slug: true, logoUrl: true, category: true, isVerified: true },
    });
    const byId = new Map(brands.map((b) => [b.id, b]));
    return {
      period: cycle.label,
      brands: cycle.slots.flatMap((s) => {
        const b = byId.get(s.winnerBrandId!);
        return b ? [{ rank: s.rank, slot: s.title, category: s.category, brand: b }] : [];
      }),
    };
  }
}
