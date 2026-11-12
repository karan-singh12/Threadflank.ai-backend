import { BadRequestException } from '@nestjs/common';
import { BrandPortalService } from './brand-portal.service';
import { VerificationAction } from './brand-portal.dto';

const admin = { adminUserId: 'a1', role: 'SUPER_ADMIN' } as any;

function build(brand: { status: string; isVerified: boolean }) {
  const prisma: any = {
    brand: {
      findFirst: jest.fn().mockResolvedValue({ id: 'b1', name: 'Acme', socialLinks: { workEmail: 'x@y.com' }, accounts: [{ email: 'x@y.com' }], ...brand }),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'b1', ...data })),
    },
    brandRefreshToken: { updateMany: jest.fn().mockResolvedValue({}) },
  };
  const audit: any = { log: jest.fn() };
  const mailer: any = { send: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { warn: jest.fn() };
  const access: any = { assertAccess: jest.fn().mockResolvedValue(undefined) };
  const svc = new BrandPortalService(prisma, access, audit, mailer, logger, {} as any, {} as any, {} as any, {} as any);
  return { svc, prisma, audit, mailer };
}

describe('BrandPortalService.decide', () => {
  it('approves a pending brand: ACTIVE + verified, emails the brand, keeps sessions', async () => {
    const { svc, prisma, audit, mailer } = build({ status: 'PENDING', isVerified: false });
    const out: any = await svc.decide('b1', { action: VerificationAction.APPROVE }, admin);
    expect(out.status).toBe('ACTIVE');
    expect(out.isVerified).toBe(true);
    expect(out.socialLinks.workEmail).toBe('x@y.com'); // existing fields preserved
    expect(out.socialLinks.verification.decision).toBe('approve');
    expect(prisma.brandRefreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BRAND_APPROVE' }));
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('requires a reason to reject or suspend', async () => {
    const { svc } = build({ status: 'PENDING', isVerified: false });
    await expect(svc.decide('b1', { action: VerificationAction.REJECT }, admin)).rejects.toThrow(BadRequestException);
    await expect(svc.decide('b1', { action: VerificationAction.REJECT, reason: '  ' }, admin)).rejects.toThrow(BadRequestException);
  });

  it('rejects a pending brand: INACTIVE, unverified, sessions revoked', async () => {
    const { svc, prisma } = build({ status: 'PENDING', isVerified: false });
    const out: any = await svc.decide('b1', { action: VerificationAction.REJECT, reason: 'Fake site' }, admin);
    expect(out.status).toBe('INACTIVE');
    expect(out.isVerified).toBe(false);
    expect(prisma.brandRefreshToken.updateMany).toHaveBeenCalled();
  });

  it('only suspends active brands and only rejects pending ones', async () => {
    await expect(build({ status: 'PENDING', isVerified: false }).svc.decide('b1', { action: VerificationAction.SUSPEND, reason: 'x y z' }, admin)).rejects.toThrow(BadRequestException);
    await expect(build({ status: 'ACTIVE', isVerified: true }).svc.decide('b1', { action: VerificationAction.REJECT, reason: 'x y z' }, admin)).rejects.toThrow(BadRequestException);
  });

  it('refuses to approve an already approved brand', async () => {
    await expect(build({ status: 'ACTIVE', isVerified: true }).svc.decide('b1', { action: VerificationAction.APPROVE }, admin)).rejects.toThrow(BadRequestException);
  });

  it('a mail failure does not undo the decision', async () => {
    const { svc, mailer } = build({ status: 'PENDING', isVerified: false });
    mailer.send.mockRejectedValue(new Error('smtp down'));
    await expect(svc.decide('b1', { action: VerificationAction.APPROVE }, admin)).resolves.toBeTruthy();
  });
});
