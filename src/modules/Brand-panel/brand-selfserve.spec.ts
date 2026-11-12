import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { BrandAuthService } from './auth/brand-auth.service';
import { BrandWidgetService, toOrigin } from './widget/brand-widget.service';
import { BrandPortalService } from '../Admin-panel/brand-portal/brand-portal.service';

const account = (over: object = {}) => ({ id: 'a1', brandId: 'b1', email: 'o@x.com', name: 'Owner', role: 'OWNER', isActive: true, emailVerified: true, password: bcrypt.hashSync('OldPass#123', 4), ...over });

function authSvc(prismaOver: any = {}) {
  const prisma: any = {
    brandAccount: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    brandRefreshToken: { updateMany: jest.fn() },
    brandAuthToken: { create: jest.fn() },
    brand: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'b1', name: 'Acme' }) },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    ...prismaOver,
  };
  const mailer: any = { send: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { warn: jest.fn(), error: jest.fn() };
  return { svc: new BrandAuthService(prisma, {} as any, mailer, logger), prisma, mailer };
}

describe('change password', () => {
  it('needs the current password and signs out every device', async () => {
    const { svc, prisma } = authSvc();
    prisma.brandAccount.findUnique.mockResolvedValue(account());
    await expect(svc.changePassword('a1', 'wrong', 'NewPass#456')).rejects.toThrow(BadRequestException);
    expect(prisma.brandAccount.update).not.toHaveBeenCalled();
    await svc.changePassword('a1', 'OldPass#123', 'NewPass#456');
    expect(prisma.brandAccount.update).toHaveBeenCalledTimes(1);
    const hash = prisma.brandAccount.update.mock.calls[0][0].data.password;
    expect(await bcrypt.compare('NewPass#456', hash)).toBe(true);
    expect(prisma.brandRefreshToken.updateMany).toHaveBeenCalledWith({ where: { brandAccountId: 'a1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });
  it('rejects reusing the same password and disabled accounts', async () => {
    const { svc, prisma } = authSvc();
    prisma.brandAccount.findUnique.mockResolvedValue(account());
    await expect(svc.changePassword('a1', 'OldPass#123', 'OldPass#123')).rejects.toThrow(BadRequestException);
    prisma.brandAccount.findUnique.mockResolvedValue(account({ isActive: false }));
    await expect(svc.changePassword('a1', 'OldPass#123', 'NewPass#456')).rejects.toThrow(UnauthorizedException);
  });
});

describe('team', () => {
  it('only the owner can invite, and the email must be new', async () => {
    const { svc, prisma } = authSvc();
    prisma.brandAccount.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.id === 'mgr' ? account({ id: 'mgr', role: 'MANAGER' }) : where.id === 'a1' ? account() : where.email === 'taken@x.com' ? account({ id: 'z' }) : null));
    await expect(svc.inviteMember('mgr', 'b1', { email: 'n@x.com', name: 'New' })).rejects.toThrow(ForbiddenException);
    await expect(svc.inviteMember('a1', 'b1', { email: 'Taken@x.com', name: 'New' })).rejects.toThrow(ConflictException);
    expect(prisma.brandAccount.create).not.toHaveBeenCalled();
  });
  it('an invite creates a MANAGER with an unusable password and emails a set-password link', async () => {
    const { svc, prisma, mailer } = authSvc();
    prisma.brandAccount.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.id === 'a1' ? account() : null));
    prisma.brandAccount.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'm1', isActive: true, ...data }));
    const out = await svc.inviteMember('a1', 'b1', { email: ' New@X.com ', name: ' Asha ' });
    const data = prisma.brandAccount.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ brandId: 'b1', email: 'new@x.com', role: 'MANAGER', name: 'Asha' });
    expect(data.password).toMatch(/^\$2[aby]\$/); // hashed random value, not a guessable one
    expect(out.pending).toBe(true);
    expect(prisma.brandAuthToken.create.mock.calls[0][0].data.purpose).toBe('PASSWORD_RESET');
    expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@x.com' }));
  });
  it('cannot disable yourself or the owner; disabling revokes sessions', async () => {
    const { svc, prisma } = authSvc();
    prisma.brandAccount.findUnique.mockResolvedValue(account());
    await expect(svc.setMemberActive('a1', 'b1', 'a1', false)).rejects.toThrow(BadRequestException);
    prisma.brandAccount.findFirst.mockResolvedValue(account({ id: 'o2', role: 'OWNER' }));
    await expect(svc.setMemberActive('a1', 'b1', 'o2', false)).rejects.toThrow(ForbiddenException);
    prisma.brandAccount.findFirst.mockResolvedValue(account({ id: 'm1', role: 'MANAGER' }));
    await svc.setMemberActive('a1', 'b1', 'm1', false);
    expect(prisma.brandAccount.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { isActive: false } });
    expect(prisma.brandRefreshToken.updateMany).toHaveBeenCalled();
  });
  it('team actions only work on your own brand', async () => {
    const { svc, prisma } = authSvc();
    prisma.brandAccount.findUnique.mockResolvedValue(account({ brandId: 'other-brand' }));
    await expect(svc.inviteMember('a1', 'b1', { email: 'n@x.com', name: 'New' })).rejects.toThrow(UnauthorizedException);
  });
});

describe('widget', () => {
  it('toOrigin accepts https sites and local http only, drops paths', () => {
    expect(toOrigin('https://shop.acme.com/products/1')).toBe('https://shop.acme.com');
    expect(toOrigin('http://localhost:3000/x')).toBe('http://localhost:3000');
    expect(toOrigin('http://shop.acme.com')).toBeNull();
    expect(toOrigin('*.acme.com')).toBeNull();
    expect(toOrigin('javascript:alert(1)')).toBeNull();
    expect(toOrigin('')).toBeNull();
  });
  it('creates a key on first open and rejects bad domains before saving', async () => {
    const brand = { id: 'b1', isDeleted: false, widgetKey: null, widgetEnabled: true, status: 'ACTIVE', widgetDomains: null };
    const prisma: any = {
      brand: { findFirst: jest.fn().mockResolvedValue(brand), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...brand, ...data })) },
      brandWidgetSession: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
    };
    const svc = new BrandWidgetService(prisma);
    const out = await svc.get('b1');
    expect(out.key).toMatch(/^tfw_/);
    expect(out.live).toBe(true);
    prisma.brand.update.mockClear();
    await expect(svc.setDomains('b1', ['https://ok.com', 'http://nope.com'])).rejects.toThrow(BadRequestException);
    expect(prisma.brand.update).not.toHaveBeenCalled();
  });
  it('a pending brand is not live yet', async () => {
    const prisma: any = {
      brand: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', widgetKey: 'tfw_x', widgetEnabled: true, status: 'PENDING', widgetDomains: [] }) },
      brandWidgetSession: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
    };
    expect((await new BrandWidgetService(prisma).get('b1')).live).toBe(false);
  });
});

describe('admin credit adjustments', () => {
  const admin = { adminUserId: 'adm', role: 'SUPER_ADMIN' } as any;
  const build = (credits = 50) => {
    const brand = { id: 'b1', isDeleted: false, name: 'Acme', socialLinks: { aiCredits: credits, workEmail: 'x@y.com' }, accounts: [], updatedAt: new Date() };
    const prisma: any = {
      brand: { findFirst: jest.fn().mockResolvedValue(brand), findUniqueOrThrow: jest.fn().mockResolvedValue(brand), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const audit: any = { log: jest.fn() };
    const svc = new BrandPortalService(prisma, { assertAccess: jest.fn() } as any, audit, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma, audit };
  };
  it('adds, sets, and logs before/after with the reason', async () => {
    const { svc, prisma, audit } = build(50);
    expect(await svc.adjustCredits('b1', { delta: 25, reason: 'Goodwill top-up' }, admin)).toEqual({ credits: 75, before: 50 });
    expect(prisma.brand.updateMany.mock.calls[0][0].data.socialLinks).toEqual({ aiCredits: 75, workEmail: 'x@y.com' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BRAND_CREDITS_ADJUSTED', metadata: { before: 50, after: 75, reason: 'Goodwill top-up' } }));
    expect((await build(50).svc.adjustCredits('b1', { set: 10, reason: 'Correction' }, admin)).credits).toBe(10);
  });
  it('needs exactly one of delta/set and never goes below zero', async () => {
    const { svc, prisma } = build(50);
    await expect(svc.adjustCredits('b1', { reason: 'nothing' }, admin)).rejects.toThrow(BadRequestException);
    await expect(svc.adjustCredits('b1', { delta: 5, set: 5, reason: 'both' }, admin)).rejects.toThrow(BadRequestException);
    await expect(svc.adjustCredits('b1', { delta: -60, reason: 'too much' }, admin)).rejects.toThrow(BadRequestException);
    expect(prisma.brand.updateMany).not.toHaveBeenCalled();
  });
  it('refuses when the balance changed underneath', async () => {
    const { svc, prisma } = build(50);
    prisma.brand.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.adjustCredits('b1', { delta: 5, reason: 'race' }, admin)).rejects.toThrow(ConflictException);
  });
});
