import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { BrandAuthGuard } from '../auth/brand-auth.guard';
import { BrandBillingService, assertOwner } from './brand-billing.service';

function billing(coupon: any) {
  const prisma: any = { brandCoupon: { findUnique: jest.fn().mockResolvedValue(coupon) } };
  return new BrandBillingService(prisma);
}
const live = { code: 'X', isActive: true, percentOff: 20, bonusCredits: 10, maxUses: null, usedCount: 0, expiresAt: null };

describe('BrandBillingService.quote', () => {
  it('prices a pack without a code', async () => {
    expect(await billing(null).quote('starter')).toMatchObject({ price: 499, credits: 50, percentOff: 0 });
  });
  it('applies percentage off and bonus credits', async () => {
    expect(await billing(live).quote('growth', 'x')).toMatchObject({ price: 1199.2, originalPrice: 1499, credits: 210, code: 'X' });
  });
  it('explains why a code cannot be used', async () => {
    await expect(billing({ ...live, isActive: false }).quote('starter', 'x')).rejects.toThrow('not valid');
    await expect(billing({ ...live, expiresAt: new Date(Date.now() - 1000) }).quote('starter', 'x')).rejects.toThrow('expired');
    await expect(billing({ ...live, maxUses: 3, usedCount: 3 }).quote('starter', 'x')).rejects.toThrow('fully used');
    await expect(billing(null).quote('starter', 'nope')).rejects.toThrow('not valid');
  });
  it('rejects an unknown pack', async () => {
    await expect(billing(null).quote('gold')).rejects.toThrow('not available');
  });
});

describe('roles', () => {
  it('only the owner can spend money', () => {
    expect(() => assertOwner('OWNER')).not.toThrow();
    expect(() => assertOwner('MANAGER')).toThrow(ForbiddenException);
    expect(() => assertOwner('VIEWER')).toThrow(ForbiddenException);
  });

  const guard = (role: string) => new BrandAuthGuard({ verifyAccessToken: async () => ({ role, brandId: 'b', brandAccountId: 'a' }) } as any);
  const ctx = (method: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method, headers: { authorization: 'Bearer t' } }) }) }) as unknown as ExecutionContext;

  it('a viewer can read but every write is refused', async () => {
    await expect(guard('VIEWER').canActivate(ctx('GET'))).resolves.toBe(true);
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) await expect(guard('VIEWER').canActivate(ctx(m))).rejects.toThrow(ForbiddenException);
  });
  it('managers and owners can write', async () => {
    await expect(guard('MANAGER').canActivate(ctx('POST'))).resolves.toBe(true);
    await expect(guard('OWNER').canActivate(ctx('DELETE'))).resolves.toBe(true);
  });
});
