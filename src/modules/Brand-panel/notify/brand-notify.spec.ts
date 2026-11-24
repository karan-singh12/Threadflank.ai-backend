import { BrandNotifyService, cleanNotifyPrefs, notifyPrefsOf } from './brand-notify';

describe('brand notification preferences', () => {
  it('treats anything not stored as on', () => {
    expect(notifyPrefsOf(null)).toEqual({ inbox: true, reviews: true, looks: true, collabs: true, ranking: true });
    expect(notifyPrefsOf({ reviews: false })).toMatchObject({ reviews: false, inbox: true });
  });

  it('keeps only known kinds with real booleans', () => {
    expect(cleanNotifyPrefs({ inbox: false, junk: true, ranking: 'no' }, { reviews: false })).toEqual({ inbox: false, reviews: false, looks: true, collabs: true, ranking: true });
  });
});

describe('BrandNotifyService', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const setup = (brand: unknown) => {
    const send = jest.fn().mockResolvedValue(undefined);
    const prisma = { brand: { findUnique: jest.fn().mockResolvedValue(brand) } };
    return { send, svc: new BrandNotifyService(prisma as any, { send } as any) };
  };

  it('emails each confirmed owner and manager when the kind is on', async () => {
    const { send, svc } = setup({ name: 'Raw Mango', notifyPrefs: null, accounts: [{ email: 'a@x.in' }, { email: 'b@x.in' }] });
    svc.send('b1', 'reviews', { subject: 'New review', lines: ['5 stars <b>'], path: '/community' });
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].html).toContain('5 stars &lt;b&gt;');
  });

  it('sends nothing when the brand switched that kind off', async () => {
    const { send, svc } = setup({ name: 'Raw Mango', notifyPrefs: { reviews: false }, accounts: [{ email: 'a@x.in' }] });
    svc.send('b1', 'reviews', { subject: 'New review', lines: [] });
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('never throws to the caller when mail fails', async () => {
    const send = jest.fn().mockRejectedValue(new Error('smtp down'));
    const prisma = { brand: { findUnique: jest.fn().mockResolvedValue({ name: 'X', notifyPrefs: null, accounts: [{ email: 'a@x.in' }] }) } };
    const warn = jest.fn();
    const svc = new BrandNotifyService(prisma as any, { send } as any, { warn } as any);
    expect(() => svc.send('b1', 'inbox', { subject: 's', lines: [] })).not.toThrow();
    await flush();
    await flush();
    expect(warn).toHaveBeenCalled();
  });
});
