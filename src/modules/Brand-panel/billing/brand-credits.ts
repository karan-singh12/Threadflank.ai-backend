import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PLAN_DAYS, planFromPackId } from './plans';

/** The AI credit packs a brand can buy. Prices are in paise and include GST. */
export const BRAND_PACKS = [
  { id: 'starter', name: 'Starter', credits: 50, pricePaise: 49_900, blurb: 'About 25 pieces of copy' },
  { id: 'growth', name: 'Growth', credits: 200, pricePaise: 149_900, blurb: 'About 100 pieces of copy', featured: true },
  { id: 'scale', name: 'Scale', credits: 600, pricePaise: 399_900, blurb: 'For brands that write every week' },
] as const;

export const findPack = (id: string) => BRAND_PACKS.find((p) => p.id === id);

/**
 * Adds credits to a brand in one SQL statement, so a purchase landing while the brand is spending
 * credits cannot overwrite either. Credits live in `socialLinks.aiCredits`; `updatedAt` is bumped
 * because the spending code uses it to detect a concurrent change.
 */
export async function grantBrandCredits(db: Prisma.TransactionClient | PrismaService, brandId: string, credits: number) {
  await db.$executeRaw`
    UPDATE "Brand"
    SET "socialLinks" = jsonb_set(
          CASE WHEN jsonb_typeof("socialLinks") = 'object' THEN "socialLinks" ELSE '{}'::jsonb END,
          '{aiCredits}',
          to_jsonb(COALESCE(("socialLinks"->>'aiCredits')::int, 0) + ${credits}::int),
          true),
        "updatedAt" = now()
    WHERE "id" = ${brandId}`;
}

/**
 * Takes `cost` credits in one SQL statement, only if the brand has that many. Returns the new
 * balance, or null when the brand doesn't have enough (nothing is changed then).
 */
export async function spendBrandCredits(db: Prisma.TransactionClient | PrismaService, brandId: string, cost: number): Promise<number | null> {
  const rows = await db.$queryRaw<{ credits: number }[]>`
    UPDATE "Brand"
    SET "socialLinks" = jsonb_set(
          CASE WHEN jsonb_typeof("socialLinks") = 'object' THEN "socialLinks" ELSE '{}'::jsonb END,
          '{aiCredits}',
          to_jsonb(COALESCE(("socialLinks"->>'aiCredits')::int, 0) - ${cost}::int),
          true),
        "updatedAt" = now()
    WHERE "id" = ${brandId} AND COALESCE(("socialLinks"->>'aiCredits')::int, 0) >= ${cost}
    RETURNING COALESCE(("socialLinks"->>'aiCredits')::int, 0) AS credits`;
  return rows.length ? Number(rows[0].credits) : null;
}

/**
 * Marks a brand order paid and grants its credits. Safe to call twice (Checkout callback and webhook
 * both do): only the call that flips the order to PAID credits it. Returns the payment, or null when
 * the order is not a brand order.
 */
export function markBrandPaymentPaid(prisma: PrismaService, orderId: string, paymentId: string | null) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.brandPayment.updateMany({
      where: { providerOrderId: orderId, status: { not: PaymentStatus.PAID } },
      data: { status: PaymentStatus.PAID, paidAt: new Date(), failureReason: null, ...(paymentId ? { providerPaymentId: paymentId } : {}) },
    });
    const payment = await tx.brandPayment.findUnique({ where: { providerOrderId: orderId } });
    if (payment && updated.count) {
      await grantBrandCredits(tx, payment.brandId, payment.credits);
      const plan = planFromPackId(payment.packId);
      if (plan) {
        // Renewing early adds on to the days left; a new or lapsed plan starts now.
        const brand = await tx.brand.findUniqueOrThrow({ where: { id: payment.brandId }, select: { plan: true, planUntil: true } });
        const left = brand.plan === plan.id && brand.planUntil && brand.planUntil.getTime() > Date.now() ? brand.planUntil.getTime() : Date.now();
        await tx.brand.update({ where: { id: payment.brandId }, data: { plan: plan.id, planUntil: new Date(left + PLAN_DAYS * 86_400_000) } });
      }
      if (payment.couponCode) await tx.brandCoupon.updateMany({ where: { code: payment.couponCode }, data: { usedCount: { increment: 1 } } });
    }
    return payment;
  });
}
