import { BrandFollowService } from './brand-follow.service';

function setup() {
  const prisma: any = {
    brandDrop: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn() },
    dropWaitlistEntry: { findMany: jest.fn().mockResolvedValue([]) },
    brandFollow: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const notifications: any = { createMany: jest.fn().mockResolvedValue(undefined) };
  return { prisma, notifications, service: new BrandFollowService(prisma, notifications) };
}
const drop = { id: 'd1', title: 'Monsoon drop', collectionName: 'Monsoon Edit', brand: { id: 'b1', name: 'Atelier', slug: 'atelier' } };

describe('BrandFollowService.announceLaunches', () => {
  it('tells the waitlist and the followers, and a person in both gets only the waitlist message', async () => {
    const { prisma, notifications, service } = setup();
    prisma.brandDrop.findMany.mockResolvedValue([drop]);
    prisma.dropWaitlistEntry.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    prisma.brandFollow.findMany.mockResolvedValue([{ userId: 'u2' }, { userId: 'u3' }]);
    expect(await service.announceLaunches()).toBe(1);
    const calls = notifications.createMany.mock.calls;
    expect(calls[0][0].sort()).toEqual(['u1', 'u2']);
    expect(calls[1][0]).toEqual(['u3']);
    expect(calls[0][1]).toMatchObject({ type: 'DROP_LIVE', link: '/brands/atelier' });
  });

  it('skips a drop another instance already claimed', async () => {
    const { prisma, notifications, service } = setup();
    prisma.brandDrop.findMany.mockResolvedValue([drop]);
    prisma.brandDrop.updateMany.mockImplementation(({ where }: any) => Promise.resolve({ count: where.id ? 0 : 1 }));
    expect(await service.announceLaunches()).toBe(0);
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('marks old launches done without messaging anyone', async () => {
    const { prisma, service } = setup();
    prisma.brandDrop.findMany.mockResolvedValue([]);
    const now = new Date('2026-11-15T10:00:00Z');
    await service.announceLaunches(now);
    const where = prisma.brandDrop.updateMany.mock.calls[0][0].where;
    expect(where.launchDate.lt.toISOString()).toBe('2026-11-14T10:00:00.000Z');
  });
});
