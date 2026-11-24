import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

const DAY = 86_400_000;
export const MAX_LIVE_OFFERS = 10;

export interface OfferInput {
  kind?: 'COUPON' | 'FLASH_SALE';
  title?: string;
  code?: string;
  percentOff?: number | null;
  amountOff?: number | null;
  productIds?: string[];
  startsAt?: string;
  endsAt?: string;
  isActive?: boolean;
}

type OfferRow = { id: string; kind: string; title: string; code: string | null; percentOff: number | null; amountOff: number | null; productIds: string[]; startsAt: Date; endsAt: Date; isActive: boolean; copies: number };

const statusOf = (o: Pick<OfferRow, 'startsAt' | 'endsAt' | 'isActive'>, now = Date.now()) => (!o.isActive ? 'off' : now < o.startsAt.getTime() ? 'scheduled' : now < o.endsAt.getTime() ? 'live' : 'ended');

/** "20% off" / "₹500 off" / "Flash sale". */
export function offerLabel(o: Pick<OfferRow, 'kind' | 'percentOff' | 'amountOff'>) {
  if (o.percentOff) return `${o.percentOff}% off`;
  if (o.amountOff) return `₹${o.amountOff.toLocaleString('en-IN')} off`;
  return o.kind === 'FLASH_SALE' ? 'Flash sale' : 'Offer';
}

const view = (o: OfferRow) => ({
  id: o.id,
  kind: o.kind as 'COUPON' | 'FLASH_SALE',
  title: o.title,
  code: o.code,
  percentOff: o.percentOff,
  amountOff: o.amountOff,
  label: offerLabel(o),
  productIds: o.productIds,
  startsAt: o.startsAt.toISOString(),
  endsAt: o.endsAt.toISOString(),
  isActive: o.isActive,
  status: statusOf(o),
  copies: o.copies,
});

/**
 * Promotions (blueprint 3.10): discount codes and flash sales shown on the brand's store and pieces,
 * and a report of what sponsored slots and offers brought in. Sponsored slots themselves are the
 * runway auction (Bidding); they are labelled Sponsored and never touch the monthly ranking.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async check(brandId: string, input: OfferInput, current?: OfferRow) {
    const kind = input.kind ?? (current?.kind as OfferInput['kind']);
    if (kind !== 'COUPON' && kind !== 'FLASH_SALE') throw new BadRequestException('Pick a discount code or a flash sale.');
    const title = (input.title ?? current?.title ?? '').trim().slice(0, 80);
    if (!title) throw new BadRequestException('Give the offer a short title, e.g. "Diwali sale".');
    const code = input.code !== undefined ? input.code.trim().toUpperCase().replace(/\s+/g, '') : current?.code ?? '';
    if (kind === 'COUPON' && !/^[A-Z0-9_-]{3,20}$/.test(code)) throw new BadRequestException('Codes are 3 to 20 letters, numbers, - or _ (e.g. DIWALI20).');
    const percentOff = input.percentOff !== undefined ? input.percentOff : current?.percentOff ?? null;
    const amountOff = input.amountOff !== undefined ? input.amountOff : current?.amountOff ?? null;
    if (percentOff != null && (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 90)) throw new BadRequestException('A percentage off is between 1 and 90.');
    if (amountOff != null && (!Number.isInteger(amountOff) || amountOff < 1)) throw new BadRequestException('Rupees off must be a whole number above 0.');
    if (percentOff != null && amountOff != null) throw new BadRequestException('Use either a percentage or rupees off, not both.');
    if (kind === 'COUPON' && percentOff == null && amountOff == null) throw new BadRequestException('Say how much the code takes off.');
    const startsAt = input.startsAt ? new Date(input.startsAt) : current?.startsAt ?? new Date();
    const endsAt = input.endsAt ? new Date(input.endsAt) : current?.endsAt;
    if (!endsAt || endsAt <= startsAt) throw new BadRequestException('The offer has to end after it starts.');
    if (endsAt.getTime() - startsAt.getTime() > 90 * DAY) throw new BadRequestException('Offers can run for up to 90 days.');
    let productIds = input.productIds !== undefined ? [...new Set(input.productIds)].slice(0, 200) : current?.productIds ?? [];
    if (productIds.length) {
      const own = await this.prisma.brandProduct.findMany({ where: { brandId, id: { in: productIds } }, select: { id: true } });
      const ok = new Set(own.map((o) => o.id));
      productIds = productIds.filter((id) => ok.has(id));
    }
    return { kind, title, code: kind === 'COUPON' ? code : null, percentOff, amountOff, productIds, startsAt, endsAt };
  }

  async list(brandId: string) {
    const rows = await this.prisma.brandOffer.findMany({ where: { brandId }, orderBy: [{ endsAt: 'desc' }], take: 100 });
    return rows.map(view);
  }

  async create(brandId: string, input: OfferInput) {
    const data = await this.check(brandId, input);
    const live = await this.prisma.brandOffer.count({ where: { brandId, isActive: true, endsAt: { gt: new Date() } } });
    if (live >= MAX_LIVE_OFFERS) throw new BadRequestException(`You can run up to ${MAX_LIVE_OFFERS} offers at a time. End one first.`);
    return view(await this.prisma.brandOffer.create({ data: { brandId, ...data } }));
  }

  async update(brandId: string, id: string, input: OfferInput) {
    const current = await this.prisma.brandOffer.findFirst({ where: { id, brandId } });
    if (!current) throw new NotFoundException('Offer not found.');
    const data = await this.check(brandId, input, current);
    return view(await this.prisma.brandOffer.update({ where: { id }, data: { ...data, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) } }));
  }

  // ── Shoppers ───────────────────────────────────────────────────────────

  /** Offers running now for a brand's store, soonest-ending first. */
  async liveFor(brandId: string) {
    const now = new Date();
    const rows = await this.prisma.brandOffer.findMany({ where: { brandId, isActive: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { endsAt: 'asc' }, take: MAX_LIVE_OFFERS });
    return rows.map((o) => ({ id: o.id, kind: o.kind, title: o.title, code: o.code, label: offerLabel(o), productIds: o.productIds, endsAt: o.endsAt.toISOString() }));
  }

  async liveForSlug(slug: string) {
    const b = await this.prisma.brand.findFirst({ where: { slug, isDeleted: false, status: 'ACTIVE' }, select: { id: true } });
    if (!b) throw new NotFoundException('Brand not found.');
    return this.liveFor(b.id);
  }

  /** A shopper copied a code: counted for the brand's report. */
  async copied(offerId: string) {
    await this.prisma.brandOffer.updateMany({ where: { id: offerId, isActive: true }, data: { copies: { increment: 1 } } });
    return { counted: true };
  }

  // ── Report ─────────────────────────────────────────────────────────────

  /**
   * What promotions brought in: each won sponsored slot (what it cost, and the brand's views, try-ons
   * and click-outs in the 30 days after the auction closed, when it was shown) and each offer (code
   * copies, and try-ons and click-outs on its pieces while it ran).
   */
  async report(brandId: string) {
    const [slots, offers] = await Promise.all([
      this.prisma.bidSlot.findMany({ where: { winnerBrandId: brandId }, include: { cycle: { select: { label: true, endsAt: true, closedAt: true } } }, orderBy: { cycle: { endsAt: 'desc' } }, take: 12 }),
      this.prisma.brandOffer.findMany({ where: { brandId, startsAt: { lte: new Date() } }, orderBy: { startsAt: 'desc' }, take: 20 }),
    ]);
    const counts = async (from: Date, to: Date, productIds?: string[]) => {
      const rows = await this.prisma.brandEvent.groupBy({
        by: ['type'],
        where: { brandId, createdAt: { gte: from, lt: to }, ...(productIds?.length ? { productId: { in: productIds } } : {}) },
        _count: { _all: true },
      });
      const n = (t: string) => rows.filter((r) => r.type === t).reduce((a, r) => a + r._count._all, 0);
      return { views: n('STORE_VIEW') + n('PRODUCT_VIEW'), drapes: n('DRAPE'), clicks: n('CLICK') };
    };
    const now = Date.now();
    const sponsored = await Promise.all(
      slots.map(async (s) => {
        const from = s.cycle.closedAt ?? s.cycle.endsAt;
        const to = new Date(Math.min(from.getTime() + 30 * DAY, now));
        return { id: s.id, slot: s.title, cycle: s.cycle.label, spend: s.winningAmount ?? 0, paid: s.paid, from: from.toISOString(), ...(to > from ? await counts(from, to) : { views: 0, drapes: 0, clicks: 0 }) };
      }),
    );
    const offerRows = await Promise.all(
      offers.map(async (o) => ({ id: o.id, title: o.title, label: offerLabel(o), code: o.code, status: statusOf(o), copies: o.copies, ...(await counts(o.startsAt, new Date(Math.min(o.endsAt.getTime(), now)), o.productIds)) })),
    );
    return { sponsored, offers: offerRows, totalSpend: sponsored.reduce((a, s) => a + s.spend, 0) };
  }
}
