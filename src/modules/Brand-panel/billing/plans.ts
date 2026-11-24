import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export type PlanId = 'FREE' | 'GROWTH' | 'PRO';
export type LimitKey = 'garments' | 'drops' | 'team' | 'collabs';

export interface Plan {
  id: PlanId;
  name: string;
  /** Rupees per 30 days, GST included. 0 for the free plan. */
  price: number;
  /** AI credits added each time the plan is bought or renewed. */
  credits: number;
  limits: Record<LimitKey, number>;
  blurb: string;
}

/** What each plan allows. Change numbers here and nowhere else. */
export const PLANS: Plan[] = [
  { id: 'FREE', name: 'Free', price: 0, credits: 0, limits: { garments: 15, drops: 1, team: 1, collabs: 0 }, blurb: 'Try ThreadFlank with a small catalog' },
  { id: 'GROWTH', name: 'Growth', price: 999, credits: 100, limits: { garments: 150, drops: 5, team: 3, collabs: 0 }, blurb: 'For a growing brand' },
  { id: 'PRO', name: 'Pro', price: 2999, credits: 400, limits: { garments: 1000, drops: 25, team: 10, collabs: 25 }, blurb: 'For a full catalog and a team' },
];

export const PLAN_DAYS = 30;
const PLAN_PREFIX = 'plan_';

export const findPlan = (id: string) => PLANS.find((p) => p.id === id.toUpperCase());
/** BrandPayment.packId for a plan purchase, e.g. "plan_growth". */
export const planPackId = (id: PlanId) => PLAN_PREFIX + id.toLowerCase();
export const planFromPackId = (packId: string) => (packId.startsWith(PLAN_PREFIX) ? findPlan(packId.slice(PLAN_PREFIX.length)) : undefined);

const LABEL: Record<LimitKey, string> = { garments: 'pieces in your catalog', drops: 'launches at a time', team: 'team members', collabs: 'open creator collabs' };

/** 402 with the plan and limit, so the panel can point the owner at Billing. */
export class PlanLimitException extends HttpException {
  constructor(plan: Plan, resource: LimitKey, adding: number, used: number) {
    const limit = plan.limits[resource];
    const room = Math.max(0, limit - used);
    const what = adding > 1 ? `This adds ${adding}, and you have room for ${room}. ` : '';
    super(
      { message: `The ${plan.name} plan allows ${limit} ${LABEL[resource]} and you have ${used}. ${what}Upgrade in Billing.`, error: 'PLAN_LIMIT', resource, limit, used, plan: plan.id },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/** The plan a brand is on right now: a paid plan that has run out counts as Free. */
export function activePlan(brand: { plan: string; planUntil: Date | null }): Plan {
  const paid = findPlan(brand.plan);
  if (paid && paid.id !== 'FREE' && brand.planUntil && brand.planUntil.getTime() > Date.now()) return paid;
  return PLANS[0];
}

/** How much of each limit a brand is using. Launches count while upcoming or within a week of going live; collabs while pending or accepted. */
export async function planUsage(prisma: PrismaService, brandId: string): Promise<Record<LimitKey, number>> {
  const [garments, drops, team, collabs] = await Promise.all([
    prisma.brandProduct.count({ where: { brandId } }),
    prisma.brandDrop.count({ where: { brandId, launchDate: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    prisma.brandAccount.count({ where: { brandId } }),
    prisma.creatorCollab.count({ where: { brandId, status: { in: ['PENDING', 'ACCEPTED'] } } }),
  ]);
  return { garments, drops, team, collabs };
}

export async function brandPlan(prisma: PrismaService, brandId: string) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { plan: true, planUntil: true } });
  return { plan: brand ? activePlan(brand) : PLANS[0], planUntil: brand?.planUntil ?? null };
}

/** Throws PlanLimitException when `adding` more of `resource` would go over the brand's plan. */
export async function assertPlanRoom(prisma: PrismaService, brandId: string, resource: LimitKey, adding = 1) {
  if (adding <= 0) return;
  const { plan } = await brandPlan(prisma, brandId);
  const used = (await planUsage(prisma, brandId))[resource];
  if (used + adding > plan.limits[resource]) throw new PlanLimitException(plan, resource, adding, used);
}
