import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { checkoutSignatureValid, createRazorpayOrder, razorpayConfig } from '../../User-panel/payments/razorpay';
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
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { socialLinks: true, gstin: true, plan: true, planUntil: true } });
    if (!brand) throw new NotFoundException('Brand not found.');
    const credits = ((brand.socialLinks as Record<string, unknown> | null)?.aiCredits as number | undefined) ?? 0;
    const current = activePlan(brand);
    return {
      paymentsEnabled: razorpayConfig().enabled,
      credits,
      gstin: brand.gstin ?? '',
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

  async createOrder(brandId: string, packId: string, code?: string) {
    const config = razorpayConfig();
    if (!config.enabled) throw new ServiceUnavailableException('Payments are not available yet. Please check back soon.');
    const pack = this.item(packId);
    if (!pack) throw new NotFoundException('That pack is not available.');
    const c = await this.coupon(code);
    const { amount, credits } = this.price(pack, c);

    let order;
    try {
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
    return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: config.keyId, pack: { id: pack.id, name: pack.label, credits }, credits };
  }

  /** Checkout's success callback. Credits the order (once) and returns the new balance. */
  async verify(brandId: string, dto: { orderId: string; paymentId: string; signature: string }) {
    if (!checkoutSignatureValid(dto.orderId, dto.paymentId, dto.signature)) throw new BadRequestException('The payment couldn’t be verified.');
    const payment = await this.prisma.brandPayment.findUnique({ where: { providerOrderId: dto.orderId } });
    if (!payment || payment.brandId !== brandId) throw new NotFoundException('Payment not found.');
    await markBrandPaymentPaid(this.prisma, dto.orderId, dto.paymentId);
    const after = await this.overview(brandId);
    return { credits: payment.credits, balance: after.credits, plan: after.plan };
  }

  async history(brandId: string) {
    const rows = await this.prisma.brandPayment.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((p) => ({
      id: p.id,
      pack: planFromPackId(p.packId) ? planFromPackId(p.packId)!.name + ' plan' : findPack(p.packId)?.name ?? p.packId,
      credits: p.credits,
      amount: p.amount / 100,
      coupon: p.couponCode,
      status: p.status,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    }));
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

/** Only the owner spends the brand's money. */
export function assertOwner(role: string) {
  if (role !== 'OWNER') throw new ForbiddenException('Only the brand owner can buy credits.');
}
