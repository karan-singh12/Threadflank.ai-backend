import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunityService, milestones, pollResults } from './community.service';

const brand = { id: 'b1', name: 'Raw Mango', slug: 'raw-mango' };

describe('community helpers', () => {
  it('tracks the last and next follower milestone', () => {
    expect(milestones(0)).toEqual({ last: null, next: 10 });
    expect(milestones(120)).toEqual({ last: 100, next: 250 });
  });

  it('turns votes into shares and remembers the viewer pick', () => {
    const r = pollResults(['Teal', 'Rust'], [{ option: 0, userId: 'a' }, { option: 0, userId: 'b' }, { option: 1, userId: 'c' }], 'c');
    expect(r).toEqual({ total: 3, myVote: 1, options: [{ label: 'Teal', votes: 2, share: 67 }, { label: 'Rust', votes: 1, share: 33 }] });
  });
});

describe('updates and polls', () => {
  it('rejects a one-option poll and repeated options', async () => {
    const svc = new CommunityService({} as any);
    await expect(svc.createUpdate('b1', { body: 'Next colour?', pollOptions: ['Teal'] })).rejects.toThrow('2 to 4 options');
    await expect(svc.createUpdate('b1', { body: 'Next colour?', pollOptions: ['Teal', 'teal'] })).rejects.toThrow('different');
  });

  it('refuses votes on a closed poll', async () => {
    const prisma: any = { brandUpdate: { findFirst: jest.fn().mockResolvedValue({ id: 'u1', kind: 'POLL', pollOptions: ['A', 'B'], pollEndsAt: new Date(Date.now() - 1000) }) } };
    await expect(new CommunityService(prisma).vote('s1', 'u1', 0)).rejects.toThrow('closed');
  });
});

describe('inbox', () => {
  it('adds a question to the open conversation instead of starting another', async () => {
    const prisma: any = {
      brand: { findFirst: jest.fn().mockResolvedValue(brand) },
      brandProduct: { findFirst: jest.fn() },
      brandThread: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: 't1' }).mockResolvedValue({ id: 't1', status: 'OPEN', userUnread: 0, brand: { ...brand, logoUrl: null }, messages: [] }),
        update: jest.fn().mockResolvedValue({ id: 't1' }),
        create: jest.fn(),
      },
      brandThreadMessage: { create: jest.fn() },
    };
    await new CommunityService(prisma).ask('s1', 'raw-mango', { body: 'Is the blouse stitched?' });
    expect(prisma.brandThread.create).not.toHaveBeenCalled();
    expect(prisma.brandThread.update.mock.calls[0][0].data.brandUnread).toEqual({ increment: 1 });
    expect(prisma.brandThreadMessage.create.mock.calls[0][0].data).toMatchObject({ threadId: 't1', fromBrand: false });
  });

  it("tells the shopper when the brand replies, and only answers the brand's own threads", async () => {
    const notifications: any = { createMany: jest.fn().mockResolvedValue(undefined) };
    const prisma: any = {
      brandThread: { findFirst: jest.fn().mockResolvedValueOnce(null) },
    };
    await expect(new CommunityService(prisma, notifications).replyAsBrand('b2', 'acc', 't1', 'Hi')).rejects.toThrow(NotFoundException);
    expect(prisma.brandThread.findFirst.mock.calls[0][0].where).toEqual({ id: 't1', brandId: 'b2' });

    const ok: any = {
      brandThread: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: 't1', userId: 's1', brand }).mockResolvedValue({ id: 't1', status: 'OPEN', brandUnread: 0, user: { username: 'asha' }, productId: null, messages: [] }),
        update: jest.fn(),
      },
      brandThreadMessage: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    await new CommunityService(ok, notifications).replyAsBrand('b1', 'acc', 't1', 'Yes, fully stitched.');
    expect(notifications.createMany).toHaveBeenCalledWith(['s1'], expect.objectContaining({ type: 'BRAND_REPLY', title: 'Raw Mango replied' }));
  });
});

describe('reviews', () => {
  const piece = { id: 'p1', brandId: 'b1' };
  it('lets only shoppers who tried the piece on (or saved it) review it', async () => {
    const prisma: any = { brandProduct: { findFirst: jest.fn().mockResolvedValue(piece) }, brandEvent: { count: jest.fn().mockResolvedValue(0) } };
    await expect(new CommunityService(prisma).review('s1', 'p1', { rating: 5 })).rejects.toThrow(ForbiddenException);
  });

  it('checks the star rating', async () => {
    const prisma: any = { brandProduct: { findFirst: jest.fn().mockResolvedValue(piece) } };
    await expect(new CommunityService(prisma).review('s1', 'p1', { rating: 6 })).rejects.toThrow(BadRequestException);
  });
});

describe("shoppers' looks", () => {
  it("accepts only the shopper's own saved look", async () => {
    const prisma: any = { brand: { findFirst: jest.fn().mockResolvedValue(brand) }, look: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(new CommunityService(prisma).submitLook('s1', 'raw-mango', { lookId: 'someone-elses' })).rejects.toThrow(NotFoundException);
    expect(prisma.look.findFirst.mock.calls[0][0].where).toEqual({ id: 'someone-elses', userId: 's1' });
  });

  it('shows "A shopper" for people who chose not to be named', async () => {
    const prisma: any = {
      brand: { findFirst: jest.fn().mockResolvedValue(brand) },
      brandUgc: { findMany: jest.fn().mockResolvedValue([{ id: 'g1', imageUrl: 'x', caption: null, showName: false, user: { username: 'asha' } }]) },
    };
    const out = await new CommunityService(prisma).publicLooks('raw-mango');
    expect(out).toEqual([{ id: 'g1', imageUrl: 'x', caption: null, by: 'A shopper' }]);
    expect(prisma.brandUgc.findMany.mock.calls[0][0].where).toEqual({ brandId: 'b1', status: 'APPROVED' });
  });
});
