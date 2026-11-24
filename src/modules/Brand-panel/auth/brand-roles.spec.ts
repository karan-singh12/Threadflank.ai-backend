import { brandArea, roleRefusal } from './brand-roles';

const allowed = (role: Parameters<typeof roleRefusal>[0], method: string, url: string) => roleRefusal(role, method, url) === null;

describe('brandArea', () => {
  it('takes the path after /brand/ without the query or a trailing slash', () => {
    expect(brandArea('/api/brand/catalog/abc?x=1')).toBe('catalog/abc');
    expect(brandArea('/api/brand/billing/')).toBe('billing');
    expect(brandArea('/api/brands/x')).toBe('');
  });
});

describe('brand roles', () => {
  it('owners and managers are not limited by the guard', () => {
    for (const role of ['OWNER', 'MANAGER'] as const) {
      expect(allowed(role, 'DELETE', '/api/brand/catalog/1')).toBe(true);
      expect(allowed(role, 'POST', '/api/brand/bidding/bid')).toBe(true);
    }
  });

  it('content can change content areas only, and never sees billing', () => {
    for (const url of ['/api/brand/catalog', '/api/brand/ai-studio/copy', '/api/brand/drops/1', '/api/brand/store/publish', '/api/brand/community/updates', '/api/brand/upload', '/api/brand/campaigns/x/join']) {
      expect(allowed('CONTENT', 'POST', url)).toBe(true);
    }
    for (const url of ['/api/brand/bidding/bid', '/api/brand/promotions/offers', '/api/brand/team/invite', '/api/brand/profile', '/api/brand/creators/collabs', '/api/brand/widget/domains']) {
      expect(allowed('CONTENT', 'POST', url)).toBe(false);
    }
    expect(allowed('CONTENT', 'GET', '/api/brand/analytics/overview')).toBe(true);
    expect(allowed('CONTENT', 'GET', '/api/brand/billing')).toBe(false);
  });

  it('analysts read everything, including insights and invoices, and change nothing', () => {
    expect(allowed('ANALYST', 'GET', '/api/brand/analytics/insights')).toBe(true);
    expect(allowed('ANALYST', 'GET', '/api/brand/billing/payments/p1/invoice')).toBe(true);
    expect(allowed('ANALYST', 'POST', '/api/brand/catalog')).toBe(false);
    expect(allowed('ANALYST', 'POST', '/api/brand/billing/order')).toBe(false);
  });

  it('viewers read the panel but not billing or deep insights', () => {
    expect(allowed('VIEWER', 'GET', '/api/brand/catalog')).toBe(true);
    expect(allowed('VIEWER', 'GET', '/api/brand/analytics/overview')).toBe(true);
    expect(allowed('VIEWER', 'GET', '/api/brand/analytics/insights')).toBe(false);
    expect(allowed('VIEWER', 'GET', '/api/brand/billing')).toBe(false);
    expect(allowed('VIEWER', 'PATCH', '/api/brand/profile')).toBe(false);
  });

  it('every role can manage its own sign-in', () => {
    for (const role of ['CONTENT', 'ANALYST', 'VIEWER'] as const) expect(allowed(role, 'POST', '/api/brand/auth/change-password')).toBe(true);
  });

  it('read-only roles may still record a click from the panel', () => {
    expect(allowed('VIEWER', 'POST', '/api/brand/analytics/track-click')).toBe(true);
    expect(allowed('ANALYST', 'POST', '/api/brand/analytics/track-click')).toBe(true);
  });
});
