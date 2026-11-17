import { BrandEventsService } from './brand-events.service';

function setup(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    brandEvent: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    brandProduct: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
  return { prisma, service: new BrandEventsService(prisma) };
}
const written = (prisma: any) => prisma.brandEvent.createMany.mock.calls.flatMap((c: any[]) => c[0].data);

describe('BrandEventsService', () => {
  it('writes recorded events in one batch', async () => {
    const { prisma, service } = setup();
    service.record({ brandId: 'b1', type: 'SAVE', productId: 'p1', userId: 'u1' });
    service.record({ brandId: 'b1', type: 'SHARE', productId: 'p1' });
    await service.flush();
    expect(prisma.brandEvent.createMany).toHaveBeenCalledTimes(1);
    expect(written(prisma)).toEqual([
      { brandId: 'b1', type: 'SAVE', productId: 'p1', userId: 'u1' },
      { brandId: 'b1', type: 'SHARE', productId: 'p1', userId: null },
    ]);
  });

  it('counts the same visitor viewing the same thing once, but different visitors and things separately', async () => {
    const { prisma, service } = setup();
    service.record({ brandId: 'b1', type: 'STORE_VIEW', actor: 'ip-1' });
    service.record({ brandId: 'b1', type: 'STORE_VIEW', actor: 'ip-1' });
    service.record({ brandId: 'b1', type: 'STORE_VIEW', actor: 'ip-2' });
    service.record({ brandId: 'b1', type: 'PRODUCT_VIEW', productId: 'p1', actor: 'ip-1' });
    service.record({ brandId: 'b1', type: 'PRODUCT_VIEW', productId: 'p2', actor: 'ip-1' });
    await service.flush();
    expect(written(prisma)).toHaveLength(4);
  });

  it('never de-duplicates saves, shares or clicks', async () => {
    const { prisma, service } = setup();
    for (let i = 0; i < 3; i++) service.record({ brandId: 'b1', type: 'SHARE', productId: 'p1', actor: 'ip-1' });
    await service.flush();
    expect(written(prisma)).toHaveLength(3);
  });

  it('does nothing when there is nothing to write', async () => {
    const { prisma, service } = setup();
    await service.flush();
    expect(prisma.brandEvent.createMany).not.toHaveBeenCalled();
  });

  it('drops a batch instead of throwing when the database is down', async () => {
    const { prisma, service } = setup();
    prisma.brandEvent.createMany.mockRejectedValue(new Error('db down'));
    service.record({ brandId: 'b1', type: 'CLICK', productId: 'p1' });
    await expect(service.flush()).resolves.toBeUndefined();
    // The failed batch is gone, so a later flush does not resend it forever.
    prisma.brandEvent.createMany.mockClear();
    await service.flush();
    expect(prisma.brandEvent.createMany).not.toHaveBeenCalled();
  });

  describe('recordDrape', () => {
    it('counts a try-on of a live piece on the piece and in the brand events', async () => {
      const { prisma, service } = setup();
      prisma.brandProduct.findFirst.mockResolvedValue({ id: 'p1', brandId: 'b1' });
      await service.recordDrape('p1', 'u1');
      expect(prisma.brandProduct.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { drapesCount: { increment: 1 } } });
      await service.flush();
      expect(written(prisma)).toEqual([{ brandId: 'b1', type: 'DRAPE', productId: 'p1', userId: 'u1' }]);
    });

    it('ignores a piece that is not live or does not exist', async () => {
      const { prisma, service } = setup();
      prisma.brandProduct.findFirst.mockResolvedValue(null);
      await service.recordDrape('gone', 'u1');
      expect(prisma.brandProduct.update).not.toHaveBeenCalled();
      await service.flush();
      expect(prisma.brandEvent.createMany).not.toHaveBeenCalled();
    });

    it('swallows errors so a try-on is never failed by analytics', async () => {
      const { prisma, service } = setup();
      prisma.brandProduct.findFirst.mockRejectedValue(new Error('boom'));
      await expect(service.recordDrape('p1', 'u1')).resolves.toBeUndefined();
    });
  });
});
