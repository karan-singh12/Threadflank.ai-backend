import { activePlan, assertPlanRoom, findPlan, planFromPackId, PlanLimitException, PLANS } from './plans';

const day = 86_400_000;

function db(brand: { plan: string; planUntil: Date | null }, used: { garments?: number; drops?: number; team?: number; collabs?: number } = {}) {
  return {
    brand: { findUnique: jest.fn().mockResolvedValue(brand) },
    brandProduct: { count: jest.fn().mockResolvedValue(used.garments ?? 0) },
    brandDrop: { count: jest.fn().mockResolvedValue(used.drops ?? 0) },
    brandAccount: { count: jest.fn().mockResolvedValue(used.team ?? 1) },
    creatorCollab: { count: jest.fn().mockResolvedValue(used.collabs ?? 0) },
  } as any;
}

describe('activePlan', () => {
  it('a paid plan counts while it has days left', () => {
    expect(activePlan({ plan: 'GROWTH', planUntil: new Date(Date.now() + day) }).id).toBe('GROWTH');
  });
  it('a paid plan that has ended, or has no end date, counts as Free', () => {
    expect(activePlan({ plan: 'PRO', planUntil: new Date(Date.now() - 1000) }).id).toBe('FREE');
    expect(activePlan({ plan: 'PRO', planUntil: null }).id).toBe('FREE');
  });
  it('an unknown plan name counts as Free', () => {
    expect(activePlan({ plan: 'GOLD', planUntil: new Date(Date.now() + day) }).id).toBe('FREE');
  });
});

describe('creator collabs', () => {
  it('are a Pro feature', async () => {
    await expect(assertPlanRoom(db({ plan: 'FREE', planUntil: null }), 'b', 'collabs')).rejects.toThrow(/Free plan allows 0 open creator collabs/);
    const pro = { plan: 'PRO', planUntil: new Date(Date.now() + 86_400_000) };
    await expect(assertPlanRoom(db(pro, { collabs: 24 }), 'b', 'collabs')).resolves.toBeUndefined();
    await expect(assertPlanRoom(db(pro, { collabs: 25 }), 'b', 'collabs')).rejects.toThrow(PlanLimitException);
  });
});

describe('assertPlanRoom', () => {
  const free = { plan: 'FREE', planUntil: null };

  it('allows up to the limit and refuses one more', async () => {
    await expect(assertPlanRoom(db(free, { garments: 14 }), 'b', 'garments')).resolves.toBeUndefined();
    await expect(assertPlanRoom(db(free, { garments: 15 }), 'b', 'garments')).rejects.toThrow(PlanLimitException);
  });

  it('checks a whole import at once and says how much room is left', async () => {
    await expect(assertPlanRoom(db(free, { garments: 10 }), 'b', 'garments', 5)).resolves.toBeUndefined();
    await expect(assertPlanRoom(db(free, { garments: 10 }), 'b', 'garments', 6)).rejects.toThrow('This adds 6, and you have room for 5.');
  });

  it('the message names the plan and points at Billing', async () => {
    await expect(assertPlanRoom(db(free, { team: 1 }), 'b', 'team')).rejects.toThrow(/Free plan allows 1 team members and you have 1\. Upgrade in Billing\.$/);
  });

  it('a paid plan raises the limit', async () => {
    const growth = { plan: 'GROWTH', planUntil: new Date(Date.now() + day) };
    await expect(assertPlanRoom(db(growth, { garments: 100 }), 'b', 'garments')).resolves.toBeUndefined();
    await expect(assertPlanRoom(db(growth, { garments: 150 }), 'b', 'garments')).rejects.toThrow(/Growth plan allows 150/);
  });

  it('an ended plan falls back to the Free limit', async () => {
    const ended = { plan: 'PRO', planUntil: new Date(Date.now() - day) };
    await expect(assertPlanRoom(db(ended, { garments: 15 }), 'b', 'garments')).rejects.toThrow(/Free plan/);
  });

  it('the refusal is an HTTP 402 with a PLAN_LIMIT code', async () => {
    const err = await assertPlanRoom(db(free, { drops: 1 }), 'b', 'drops').catch((e) => e);
    expect(err.getStatus()).toBe(402);
    expect(err.getResponse()).toMatchObject({ error: 'PLAN_LIMIT', resource: 'drops', limit: 1, plan: 'FREE' });
  });
});

describe('plan table', () => {
  it('each paid plan is bigger than the one before and the free plan costs nothing', () => {
    expect(PLANS[0].price).toBe(0);
    for (let i = 1; i < PLANS.length; i++) {
      expect(PLANS[i].price).toBeGreaterThan(PLANS[i - 1].price);
      expect(PLANS[i].limits.garments).toBeGreaterThan(PLANS[i - 1].limits.garments);
    }
  });
  it('plan ids and credit-pack ids do not clash', () => {
    expect(planFromPackId('plan_growth')?.id).toBe('GROWTH');
    expect(planFromPackId('growth')).toBeUndefined();
    expect(findPlan('pro')?.id).toBe('PRO');
  });
});
