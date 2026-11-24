import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { checkoutSignatureValid, createRazorpayOrder, createSandboxOrder, isSandboxId, razorpayConfig, sandboxPaymentId } from '../../User-panel/payments/razorpay';
import { BRAND_PACKS, findPack, markBrandPaymentPaid } from './brand-credits';
import { activePlan, PLAN_DAYS, PLANS, planFromPackId, planPackId, planUsage } from './plans';

const toPublicPack = (p: (typeof BRAND_PACKS)[number]) => ({
  id: p.id,
  name: p.name,
  credits: p.credits,
  price: p.pricePaise / 100,
  perCredit: Math.round((p.pricePaise / p.credits) / 100 * 100) / 100,
  blurb: p.blurb,
  featured: 'featured' in p ? p.featured : false,
});

/** Buying AI credits: packs, promo codes, a Razorpay order, and the payment history. */
@Injectable()
export class BrandBillingService {
  private readonly logger = new Logger(BrandBillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async overview(brandId: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { socialLinks: true, gstin: true, gstVerifiedAt: true, plan: true, planUntil: true } });
    if (!brand) throw new NotFoundException('Brand not found.');
    const credits = ((brand.socialLinks as Record<string, unknown> | null)?.aiCredits as number | undefined) ?? 0;
    const current = activePlan(brand);
    const config = razorpayConfig();
    return {
      paymentsEnabled: config.open,
      paymentsMode: config.mode,
      credits,
      gstin: brand.gstin ?? '',
      gstVerified: Boolean(brand.gstin && brand.gstVerifiedAt),
      gstNote: 'Prices include GST.',
      packs: BRAND_PACKS.map(toPublicPack),
      plan: { id: current.id, name: current.name, until: current.id === 'FREE' ? null : brand.planUntil?.toISOString() ?? null, limits: current.limits, usage: await planUsage(this.prisma, brandId) },
      plans: PLANS.map((p) => ({ id: p.id, orderId: planPackId(p.id), name: p.name, price: p.price, credits: p.credits, limits: p.limits, blurb: p.blurb, days: PLAN_DAYS, featured: p.id === 'GROWTH' })),
    };
  }

  /** A friendly error for a code that cannot be used, so the panel can show it as is. */
  private async coupon(code: string | undefined) {
    const clean = code?.trim().toUpperCase();
    if (!clean) return null;
    const c = await this.prisma.brandCoupon.findUnique({ where: { code: clean } });
    if (!c || !c.isActive) throw new BadRequestException('That code is not valid.');
    if (c.expiresAt && c.expiresAt.getTime() < Date.now()) throw new BadRequestException('That code has expired.');
    if (c.maxUses !== null && c.usedCount >= c.maxUses) throw new BadRequestException('That code has been fully used.');
    return c;
  }

  /** A credit pack or a monthly plan, as one thing to price and sell. */
  private item(id: string): { id: string; packId: string; pricePaise: number; credits: number; label: string; plan?: boolean } | undefined {
    const pack = findPack(id);
    if (pack) return { id: pack.id, packId: pack.id, pricePaise: pack.pricePaise, credits: pack.credits, label: pack.name };
    const plan = planFromPackId(id);
    if (plan && plan.id !== 'FREE') return { id: plan.id, packId: planPackId(plan.id), pricePaise: plan.price * 100, credits: plan.credits, label: plan.name + ' plan', plan: true };
    return undefined;
  }

  private price(pack: { pricePaise: number; credits: number }, c: { percentOff: number; bonusCredits: number } | null) {
    const amount = c?.percentOff ? Math.max(100, Math.round((pack.pricePaise * (100 - c.percentOff)) / 100)) : pack.pricePaise;
    return { amount, credits: pack.credits + (c?.bonusCredits ?? 0) };
  }

  /** What a pack would cost with a code, without creating anything. */
  async quote(packId: string, code?: string) {
    const pack = this.item(packId);
    if (!pack) throw new NotFoundException('That pack is not available.');
    const c = await this.coupon(code);
    const { amount, credits } = this.price(pack, c);
    return { packId: pack.id, code: c?.code ?? null, percentOff: c?.percentOff ?? 0, bonusCredits: c?.bonusCredits ?? 0, price: amount / 100, originalPrice: pack.pricePaise / 100, credits };
  }

  /**
   * A runway slot this brand won and hasn't paid for, priced at its winning bid. Promo codes don't
   * apply to auctions: the bid is the price the brand chose.
   */
  private async bidItem(brandId: string, packId: string) {
    const slotId = packId.slice(BID_PREFIX.length);
    const slot = await this.prisma.bidSlot.findFirst({ where: { id: slotId, winnerBrandId: brandId, paid: false, winningAmount: { not: null }, cycle: { status: 'CLOSED' } } });
    if (!slot) return undefined;
    return { id: packId, packId, pricePaise: slot.winningAmount! * 100, credits: 0, label: `Runway slot #${slot.rank}: ${slot.title}`, bid: true };
  }

  async createOrder(brandId: string, packId: string, code?: string) {
    const config = razorpayConfig();
    if (!config.open) throw new ServiceUnavailableException('Payments are not available yet. Please check back soon.');
    const isBid = packId.startsWith(BID_PREFIX);
    const pack = isBid ? await this.bidItem(brandId, packId) : this.item(packId);
    if (!pack) throw new NotFoundException(isBid ? 'That slot is already paid for, or it isn’t yours.' : 'That pack is not available.');
    const c = isBid ? null : await this.coupon(code);
    const { amount, credits } = this.price(pack, c);

    let order;
    if (config.sandbox) order = createSandboxOrder(amount);
    else try {
      order = await createRazorpayOrder({
        amount,
        currency: 'INR',
        receipt: `tfb_${Date.now().toString(36)}_${brandId.slice(-10)}`,
        notes: { brandId, packId: pack.packId, credits: String(credits), ...(c ? { coupon: c.code } : {}) },
      });
    } catch (err) {
      this.logger.error(`Razorpay order failed: ${err}`);
      throw new BadGatewayException('Couldn’t start the payment. Please try again.');
    }
    await this.prisma.brandPayment.create({
      data: { brandId, packId: pack.packId, credits, amount: order.amount, currency: order.currency, providerOrderId: order.id, couponCode: c?.code ?? null },
    });
    return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: config.keyId, sandbox: config.sandbox, pack: { id: pack.id, name: pack.label, credits }, credits };
  }

  /**
   * Checkout's success callback. Credits the order (once) and returns the new balance.
   * A sandbox order has no Razorpay signature: it is confirmed only while sandbox mode is still on,
   * and the payment id is made here rather than taken from the request.
   */
  async verify(brandId: string, dto: { orderId: string; paymentId: string; signature: string }) {
    const sandbox = isSandboxId(dto.orderId);
    if (sandbox ? !razorpayConfig().sandbox : !checkoutSignatureValid(dto.orderId, dto.paymentId, dto.signature)) {
      throw new BadRequestException('The payment couldn’t be verified.');
    }
    const payment = await this.prisma.brandPayment.findUnique({ where: { providerOrderId: dto.orderId } });
    if (!payment || payment.brandId !== brandId) throw new NotFoundException('Payment not found.');
    await markBrandPaymentPaid(this.prisma, dto.orderId, sandbox ? sandboxPaymentId() : dto.paymentId);
    const after = await this.overview(brandId);
    return { credits: payment.credits, balance: after.credits, plan: after.plan };
  }

  async history(brandId: string) {
    const rows = await this.prisma.brandPayment.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((p) => ({
      id: p.id,
      pack: p.packId.startsWith(BID_PREFIX) ? 'Runway slot' : planFromPackId(p.packId) ? planFromPackId(p.packId)!.name + ' plan' : findPack(p.packId)?.name ?? p.packId,
      credits: p.credits,
      amount: p.amount / 100,
      coupon: p.couponCode,
      status: p.status,
      sandbox: isSandboxId(p.providerOrderId),
      invoiceNo: p.status === PaymentStatus.PAID ? invoiceNumber(p) : null,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  /**
   * A tax invoice for one paid purchase. Prices include 18% GST, so the taxable value is worked back
   * from the total. A buyer GSTIN from the seller's state splits the tax into CGST and SGST; any other
   * state, or no GSTIN on file, is shown as IGST. A sandbox purchase is marked as a test document.
   */
  async invoice(brandId: string, paymentId: string) {
    const p = await this.prisma.brandPayment.findFirst({
      where: { id: paymentId, brandId },
      include: { brand: { select: { name: true, gstin: true, gstVerifiedAt: true } } },
    });
    if (!p) throw new NotFoundException('Payment not found.');
    if (p.status !== PaymentStatus.PAID || !p.paidAt) throw new BadRequestException('An invoice is made once the payment has gone through.');
    return buildInvoice(p);
  }

  /** Razorpay says an order failed: keep the record so the history is honest. */
  failOrder(orderId: string, reason: string, paymentId?: string) {
    return this.prisma.brandPayment.updateMany({
      where: { providerOrderId: orderId, status: PaymentStatus.CREATED },
      data: { status: PaymentStatus.FAILED, failureReason: reason, providerPaymentId: paymentId },
    });
  }

  // ── Admin: promo codes ───────────────────────────────────────────────────

  listCoupons() {
    return this.prisma.brandCoupon.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async createCoupon(dto: { code: string; percentOff?: number; bonusCredits?: number; maxUses?: number; expiresAt?: string }) {
    const code = dto.code.trim().toUpperCase();
    if (!dto.percentOff && !dto.bonusCredits) throw new BadRequestException('A code needs a percentage off, bonus credits, or both.');
    if (await this.prisma.brandCoupon.findUnique({ where: { code } })) throw new BadRequestException('That code already exists.');
    return this.prisma.brandCoupon.create({
      data: { code, percentOff: dto.percentOff ?? 0, bonusCredits: dto.bonusCredits ?? 0, maxUses: dto.maxUses ?? null, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null },
    });
  }

  async setCouponActive(id: string, isActive: boolean) {
    const { count } = await this.prisma.brandCoupon.updateMany({ where: { id }, data: { isActive } });
    if (!count) throw new NotFoundException('Code not found.');
    return { id, isActive };
  }
}

export const GST_RATE = 18;

/** Paying for a won runway slot: the order's packId is "bid_<slotId>". */
export const BID_PREFIX = 'bid_';

/** Who the invoice is from. Set from the environment once the company details are final. */
const seller = () => ({
  name: process.env.INVOICE_SELLER_NAME?.trim() || 'Threadflank',
  address: process.env.INVOICE_SELLER_ADDRESS?.trim() || 'India',
  gstin: process.env.INVOICE_SELLER_GSTIN?.trim() || null,
  /** First two digits of a GSTIN: the state. 08 is Rajasthan. */
  stateCode: process.env.INVOICE_SELLER_STATE_CODE?.trim() || '08',
});

/** TF-202611-1A2B3C4D: the month it was paid plus the end of the row id, so it is stable and unique. */
export function invoiceNumber(p: { id: string; paidAt: Date | null; createdAt: Date }) {
  const d = p.paidAt ?? p.createdAt;
  return `TF-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}-${p.id.slice(-8).toUpperCase()}`;
}

type InvoiceSource = {
  id: string;
  packId: string;
  credits: number;
  amount: number;
  currency: string;
  couponCode: string | null;
  providerOrderId: string;
  providerPaymentId: string | null;
  paidAt: Date | null;
  createdAt: Date;
  brand: { name: string; gstin: string | null; gstVerifiedAt: Date | null };
};

/** Pure, so the tax split can be tested without a database. Amounts in rupees. */
export function buildInvoice(p: InvoiceSource) {
  const from = seller();
  const total = p.amount;
  const taxable = Math.round((total * 100) / (100 + GST_RATE));
  const tax = total - taxable;
  const intraState = p.brand.gstin?.slice(0, 2) === from.stateCode;
  const plan = planFromPackId(p.packId);
  return {
    invoiceNo: invoiceNumber(p),
    sandbox: isSandboxId(p.providerOrderId),
    issuedAt: (p.paidAt ?? p.createdAt).toISOString(),
    seller: from,
    buyer: { name: p.brand.name, gstin: p.brand.gstin ?? null, gstVerified: Boolean(p.brand.gstin && p.brand.gstVerifiedAt) },
    line: {
      description: p.packId.startsWith(BID_PREFIX)
        ? 'Sponsored runway placement (won at auction)'
        : plan
          ? `${plan.name} plan · ${PLAN_DAYS} days · ${p.credits} AI credits`
          : `${findPack(p.packId)?.name ?? p.packId} pack · ${p.credits} AI credits`,
      /** SAC for online information and database services. */
      sac: '998431',
      quantity: 1,
    },
    coupon: p.couponCode,
    currency: p.currency,
    amounts: {
      taxable: taxable / 100,
      rate: GST_RATE,
      ...(intraState ? { cgst: Math.floor(tax / 2) / 100, sgst: (tax - Math.floor(tax / 2)) / 100 } : { igst: tax / 100 }),
      total: total / 100,
    },
    paymentRef: p.providerPaymentId,
  };
}

/** Only the owner spends the brand's money. */
export function assertOwner(role: string) {
  if (role !== 'OWNER') throw new ForbiddenException('Only the brand owner can buy credits.');
}
