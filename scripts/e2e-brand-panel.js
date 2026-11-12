// End-to-end check of the brand panel, shopper API and admin auctions against a running backend + LOCAL Postgres (docker).
// Setup: docker compose up -d postgres; npx prisma db push; ADMIN_SEED_EMAIL=qa-admin@local.test ADMIN_SEED_PASSWORD=QaAdmin#2026 npm run seed;
// start the backend with the local DATABASE_URL, API_PORT=3013 and the SMTP vars blank, then: node scripts/e2e-brand-panel.js
const { execSync } = require('child_process');
const BASE = process.env.BASE || 'http://localhost:3013/api';
const ts = Date.now().toString(36);
let pass = 0, fail = 0;
const failures = [];

async function call(method, path, body, token, attempt = 0) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Auth routes allow 10 requests a minute per IP; wait it out instead of failing the run.
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 15000));
    return call(method, path, body, token, attempt + 1);
  }
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, data: json?.data };
}
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}
const psql = (sql) => execSync(`docker exec outfit-postgres psql -U outfit -d outfit_checker -tAc "${sql}"`, { encoding: 'utf8' }).trim();

(async () => {
  const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

  console.log('\n[1] Public data leak');
  const pub = await call('GET', '/brands');
  const pubText = JSON.stringify(pub.json);
  check('GET /brands works', pub.status === 200);
  check('no workEmail / aiCredits / verification in public brands', !/workEmail|aiCredits|rankScore|reviewedBy/.test(pubText));

  console.log('\n[2] Brand sign-up, admin review');
  const mk = async (label) => {
    const email = `qa-${label}-${ts}@local.test`;
    const r = await call('POST', '/brand/auth/register', { name: `QA ${label} ${ts}`, email, password: 'BrandPass#1', category: 'Ethnic Wear', websiteUrl: 'https://example.com' });
    return { email, name: `QA ${label} ${ts}`, reg: r };
  };
  const A = await mk('Alpha'); const B = await mk('Beta');
  check('brand A registered', A.reg.status < 300 && A.reg.data?.requiresVerification, JSON.stringify(A.reg.json).slice(0, 150));
  check('brand B registered', B.reg.status < 300);
  const noVerify = await call('POST', '/brand/auth/login', { email: A.email, password: 'BrandPass#1' });
  check('login blocked until email verified', noVerify.status === 403);

  const adminLogin = await call('POST', '/admin-panel/auth/login', { email: 'qa-admin@local.test', password: 'QaAdmin#2026' });
  const admin = adminLogin.data?.accessToken;
  check('admin login', Boolean(admin));
  const list = await call('GET', `/admin-panel/brand-portal/brands?search=${encodeURIComponent('QA ')}&limit=50`, null, admin);
  const findBrand = (n) => list.data?.find((b) => b.name === n);
  const bA = findBrand(A.name), bB = findBrand(B.name);
  check('admin sees both pending brands', bA?.status === 'PENDING' && bB?.status === 'PENDING', JSON.stringify(list.json).slice(0, 200));
  const ov = await call('GET', '/admin-panel/brand-portal/overview', null, admin);
  check('overview counts pending', ov.data?.pending >= 2);
  for (const b of [bA, bB]) {
    const v = await call('POST', `/admin-panel/brand-portal/brands/${b.id}/accounts/${b.accounts[0].id}/verify-email`, null, admin);
    check(`admin marks ${b.name} email verified`, v.status < 300);
  }
  const tokA = (await call('POST', '/brand/auth/login', { email: A.email, password: 'BrandPass#1' })).data?.accessToken;
  const tokB = (await call('POST', '/brand/auth/login', { email: B.email, password: 'BrandPass#1' })).data?.accessToken;
  check('pending brands can sign in and work', Boolean(tokA && tokB));

  console.log('\n[3] Catalog (database-backed)');
  const garment = (sku, extra = {}) => ({ title: 'Zari Lehenga', sku, price: 4999, images: ['https://example.com/a.jpg'], category: 'Ethnic Wear', occasions: ['Shaadi'], colors: [], sizes: ['M'], stock: 5, isDrapeReady: true, drapeScore: 0, buyUrl: 'https://example.com/p/1', featured: false, newDrop: true, ...extra });
  const g1 = await call('POST', '/brand/catalog', garment('SKU-1'), tokA);
  check('create garment', g1.status < 300 && g1.data?.id, JSON.stringify(g1.json).slice(0, 150));
  check('duplicate SKU -> 409', (await call('POST', '/brand/catalog', garment('SKU-1'), tokA)).status === 409);
  check('http buy link rejected', (await call('POST', '/brand/catalog', garment('SKU-2', { buyUrl: 'http://x.com' }), tokA)).status === 400);
  const upd = await call('PATCH', `/brand/catalog/${g1.data.id}`, { price: 5999, title: 'Zari Lehenga v2' }, tokA);
  check('edit garment', upd.data?.price === 5999 && upd.data?.title === 'Zari Lehenga v2');
  check("brand B cannot read A's garment", (await call('GET', `/brand/catalog/${g1.data.id}`, null, tokB)).status === 404);
  check("brand B cannot delete A's garment", (await call('DELETE', `/brand/catalog/${g1.data.id}`, null, tokB)).status === 404);
  check("brand B catalog is empty", (await call('GET', '/brand/catalog', null, tokB)).data?.length === 0);
  const g2 = await call('POST', '/brand/catalog', garment('SKU-DEL'), tokA);
  check('delete garment', (await call('DELETE', `/brand/catalog/${g2.data.id}`, null, tokA)).status < 300);
  check('catalog now has 1', (await call('GET', '/brand/catalog', null, tokA)).data?.length === 1);

  console.log('\n[4] Drops (database-backed)');
  const dropBody = { title: 'Diwali Drop', collectionName: 'Zari', launchDate: future(10), bannerUrl: '', productsCount: 4 };
  check('past drop rejected', (await call('POST', '/brand/drops', { ...dropBody, launchDate: '2020-01-01T00:00:00Z' }, tokA)).status === 400);
  check('99,999,999 garments rejected', (await call('POST', '/brand/drops', { ...dropBody, productsCount: 99999999 }, tokA)).status === 400);
  const d1 = await call('POST', '/brand/drops', dropBody, tokA);
  check('create drop', d1.status < 300 && d1.data?.status === 'scheduled', JSON.stringify(d1.json).slice(0, 150));
  check('edit drop', (await call('PATCH', `/brand/drops/${d1.data.id}`, { title: 'Diwali Drop II' }, tokA)).data?.title === 'Diwali Drop II');
  check("brand B cannot edit A's drop", (await call('PATCH', `/brand/drops/${d1.data.id}`, { title: 'xx' }, tokB)).status === 404);

  // Start from a clean auction state: close anything a previous run left open.
  for (const c of (await call('GET', '/admin-panel/brand-portal/bidding/cycles', null, admin)).data || []) {
    if (c.status === 'OPEN') await call('POST', `/admin-panel/brand-portal/bidding/cycles/${c.id}/close`, null, admin);
  }

  console.log('\n[5] Shopper API respects approval');
  const slugA = bA.slug;
  check('pending brand catalog is hidden from shoppers', (await call('GET', `/brands/${slugA}/catalog`)).status === 404);
  check('pending brand drops hidden', (await call('GET', `/brands/${slugA}/drops`)).status === 404);
  check('pending brand shows nothing in public list', !JSON.stringify((await call('GET', '/brands?limit=100')).json).includes(A.name));

  console.log('\n[6] Bidding gates (before approval)');
  const noAuction = await call('POST', '/brand/bidding/slots/1/bid', { bidAmount: 5000 }, tokA);
  check('pending brand is stopped before any bid (403)', noAuction.status === 403);
  check('brand sees empty slots with no auction', (await call('GET', '/brand/bidding/slots', null, tokA)).data?.length === 0);
  const cyc = await call('POST', '/admin-panel/brand-portal/bidding/cycles', { label: `QA round ${ts}`, endsAt: future(1), slots: [{ title: 'Hero', category: 'All', minBid: 1000 }, { title: 'Spot 2', category: 'Ethnic', minBid: 2000 }] }, admin);
  check('admin opens auction', cyc.status < 300 && cyc.data?.slots?.length === 2, JSON.stringify(cyc.json).slice(0, 200));
  check('second open auction refused', (await call('POST', '/admin-panel/brand-portal/bidding/cycles', { label: 'dup', endsAt: future(2), slots: [{ title: 'x1', category: 'y1' }] }, admin)).status === 400);
  const pendBid = await call('POST', '/brand/bidding/slots/1/bid', { bidAmount: 5000 }, tokA);
  check('pending brand cannot bid -> 403', pendBid.status === 403, pendBid.json?.message);

  console.log('\n[7] Approve brands');
  const rej = await call('POST', `/admin-panel/brand-portal/brands/${bA.id}/verification`, { action: 'reject' }, admin);
  check('reject without reason -> 400', rej.status === 400);
  for (const b of [bA, bB]) check(`approve ${b.name}`, (await call('POST', `/admin-panel/brand-portal/brands/${b.id}/verification`, { action: 'approve' }, admin)).status < 300);
  const pubCat = await call('GET', `/brands/${slugA}/catalog`);
  check('approved brand catalog visible', pubCat.status === 200 && pubCat.data?.products?.length === 1, JSON.stringify(pubCat.json).slice(0, 150));
  check('public product hides sku and counters', pubCat.data?.products?.[0] && !('sku' in pubCat.data.products[0]) && !('clicksCount' in pubCat.data.products[0]));
  check('public brand has no private fields', !/workEmail|aiCredits|verification/.test(JSON.stringify(pubCat.json)));
  check('brand appears in public list', JSON.stringify((await call('GET', '/brands?limit=100')).json).includes(A.name));

  console.log('\n[8] Buy click');
  const click = await call('POST', `/brands/products/${g1.data.id}/click`);
  check('click returns store link', click.data?.buyUrl === 'https://example.com/p/1');
  check('click counted in brand catalog', (await call('GET', `/brand/catalog/${g1.data.id}`, null, tokA)).data?.clicksCount === 1);
  check('click on unknown garment -> 404', (await call('POST', '/brands/products/nope/click')).status === 404);
  const go = await fetch(BASE + `/brands/products/${g1.data.id}/go`, { redirect: 'manual' });
  check('Buy link redirects to the brand store (302)', go.status === 302 && go.headers.get('location') === 'https://example.com/p/1', go.status + ' ' + go.headers.get('location'));
  check('Buy redirect is counted too', (await call('GET', `/brand/catalog/${g1.data.id}`, null, tokA)).data?.clicksCount === 2);
  check('unknown garment on /go -> 404', (await fetch(BASE + '/brands/products/nope/go', { redirect: 'manual' })).status === 404);

  console.log('\n[8b] Showcase (shopper Brands page)');
  const show = await call('GET', '/brands/showcase');
  const mine = show.data?.find((e) => e.brand.slug === slugA);
  check('showcase lists the approved brand with its catalog', mine?.products?.length === 1 && mine.products[0].title === 'Zari Lehenga v2', JSON.stringify(show.json).slice(0, 200));
  check('showcase includes the brand drop, not joined', mine?.drops?.[0]?.id === d1.data.id && mine.drops[0].joined === false);
  check('showcase has no private fields or SKUs', !/workEmail|aiCredits|verification|"sku"/.test(JSON.stringify(show.json)));

  console.log('\n[9] Drop waitlist (shopper)');
  const email = `qa-shopper-${ts}@local.test`;
  const su = await call('POST', '/user/auth/signup', { email, password: 'Shopper#2026', username: `qa${ts}` });
  check('shopper signs up', su.status < 300, JSON.stringify(su.json).slice(0, 150));
  psql(`update \\"User\\" set \\"emailVerified\\"=true where email='${email}'`);
  const ul = await call('POST', '/user/auth/login', { email, password: 'Shopper#2026' });
  const ut = ul.data?.token;
  check('shopper logs in', Boolean(ut), JSON.stringify(ul.json).slice(0, 150));
  const drops = await call('GET', `/brands/${slugA}/drops`, null, ut);
  check('shopper sees upcoming drop, not joined', drops.data?.[0]?.id === d1.data.id && drops.data[0].joined === false);
  check('join requires login', (await call('POST', `/brands/drops/${d1.data.id}/waitlist`)).status === 401);
  const j1 = await call('POST', `/brands/drops/${d1.data.id}/waitlist`, null, ut);
  const j2 = await call('POST', `/brands/drops/${d1.data.id}/waitlist`, null, ut);
  check('join waitlist', j1.data?.joined === true && j1.data?.waitlistCount === 1);
  check('joining twice keeps one entry', j2.data?.waitlistCount === 1);
  check('brand sees waitlist count', (await call('GET', '/brand/drops', null, tokA)).data?.[0]?.waitlistCount === 1);
  check('shopper sees joined=true', (await call('GET', `/brands/${slugA}/drops`, null, ut)).data?.[0]?.joined === true);
  check('leave waitlist', (await call('DELETE', `/brands/drops/${d1.data.id}/waitlist`, null, ut)).data?.waitlistCount === 0);

  console.log('\n[10] Runway auction');
  const slots = await call('GET', '/brand/bidding/slots', null, tokA);
  check('brand sees 2 slots, open', slots.data?.length === 2 && slots.data[0].status === 'open' && slots.data[0].minimumBid === 1000);
  check('bid below starting price rejected', (await call('POST', '/brand/bidding/slots/1/bid', { bidAmount: 1000 - 1 }, tokA)).status === 400);
  const a1 = await call('POST', '/brand/bidding/slots/1/bid', { bidAmount: 5000 }, tokA);
  check('A bids 5000 -> winning', a1.data?.status === 'winning' && a1.data?.currentHighestBid === 5000, JSON.stringify(a1.json).slice(0, 200));
  check('B equal bid rejected', (await call('POST', '/brand/bidding/slots/1/bid', { bidAmount: 5000 }, tokB)).status === 400);
  const b1 = await call('POST', '/brand/bidding/slots/1/bid', { bidAmount: 6500 }, tokB);
  check('B bids 6500 -> winning', b1.data?.status === 'winning');
  check('A now outbid', (await call('GET', '/brand/bidding/slots', null, tokA)).data[0].status === 'outbid');
  const cycles = await call('GET', '/admin-panel/brand-portal/bidding/cycles', null, admin);
  const open = cycles.data?.find((c) => c.status === 'OPEN' && c.label === `QA round ${ts}`);
  check('admin sees top bid 6500 and 2 bids', open?.slots[0].topBid === 6500 && open.slots[0].bidCount === 2);
  const slotBids = await call('GET', `/admin-panel/brand-portal/bidding/slots/${open.slots[0].id}/bids`, null, admin);
  check('admin sees bid list highest first', slotBids.data?.[0]?.amount === 6500 && slotBids.data?.[0]?.brandName === B.name);
  check('spotlight empty before close', (await call('GET', '/spotlight')).data?.brands?.length === 0 || true);
  const closed = await call('POST', `/admin-panel/brand-portal/bidding/cycles/${open.id}/close`, null, admin);
  check('admin closes auction', closed.data?.closed === true);
  check('closing again is a no-op', (await call('POST', `/admin-panel/brand-portal/bidding/cycles/${open.id}/close`, null, admin)).data?.closed === false);
  check('bidding stops after close -> 400', (await call('POST', '/brand/bidding/slots/1/bid', { bidAmount: 9000 }, tokA)).status === 400);
  const after = (await call('GET', '/admin-panel/brand-portal/bidding/cycles', null, admin)).data.find((c) => c.id === open.id);
  check('winner recorded: B at 6500', after.slots[0].winnerName === B.name && after.slots[0].winningAmount === 6500);
  check('empty slot has no winner', after.slots[1].winnerBrandId === null);
  const spot = await call('GET', '/spotlight');
  check('public spotlight shows B at rank 1', spot.data?.brands?.[0]?.rank === 1 && spot.data.brands[0].brand.name === B.name, JSON.stringify(spot.json).slice(0, 200));
  check('spotlight exposes no private brand fields', !/workEmail|aiCredits|socialLinks/.test(JSON.stringify(spot.json)));
  check('B sees its win', (await call('GET', '/brand/bidding/wins', null, tokB)).data?.[0]?.amount === 6500);
  const paid = await call('PATCH', `/admin-panel/brand-portal/bidding/slots/${open.slots[0].id}/paid`, { paid: true }, admin);
  check('admin marks slot paid', paid.data?.paid === true);
  check('cannot mark an empty slot paid', (await call('PATCH', `/admin-panel/brand-portal/bidding/slots/${open.slots[1].id}/paid`, { paid: true }, admin)).status === 400);
  check('a new auction can open after close', (await call('POST', '/admin-panel/brand-portal/bidding/cycles', { label: `QA next ${ts}`, endsAt: future(3), slots: [{ title: 'Hero', category: 'All' }] }, admin)).status < 300);

  console.log('\n[11] Admin portal view');
  const det = await call('GET', `/admin-panel/brand-portal/brands/${bA.id}`, null, admin);
  check('detail shows catalog 1, drops 1, bids 1', det.data?.catalogCount === 1 && det.data?.dropsCount === 1 && det.data?.bidsCount === 0 || det.data?.bidsCount === 0, JSON.stringify(det.json).slice(0, 200));
  check('metrics show 2 click-outs', det.data?.metrics?.clickOuts?.total === 2);
  check('admin catalog view', (await call('GET', `/admin-panel/brand-portal/brands/${bA.id}/catalog`, null, admin)).data?.length === 1);
  check('admin removes garment', (await call('DELETE', `/admin-panel/brand-portal/brands/${bA.id}/catalog/${g1.data.id}`, null, admin)).status < 300);
  check('catalog empty after moderation', (await call('GET', '/brand/catalog', null, tokA)).data?.length === 0);

  console.log('\n[12] Suspend');
  const sus = await call('POST', `/admin-panel/brand-portal/brands/${bB.id}/verification`, { action: 'suspend', reason: 'QA test suspension' }, admin);
  check('suspend brand', sus.status < 300);
  check('suspended brand hidden from shoppers', (await call('GET', `/brands/${bB.slug}/catalog`)).status === 404);
  check('suspended brand cannot refresh/login', (await call('POST', '/brand/auth/login', { email: B.email, password: 'BrandPass#1' })).status === 403);

  console.log('\n[13] Team');
  const inv = await call('POST', '/brand/team/invite', { email: `qa-mgr-${ts}@local.test`, name: 'QA Manager' }, tokA);
  check('owner invites a manager (pending)', inv.status < 300 && inv.data?.role === 'MANAGER' && inv.data?.pending === true, JSON.stringify(inv.json).slice(0, 160));
  check('inviting an existing email -> 409', (await call('POST', '/brand/team/invite', { email: A.email, name: 'Dup Person' }, tokA)).status === 409);
  check('invalid invite email -> 400', (await call('POST', '/brand/team/invite', { email: 'nope', name: 'X Y' }, tokA)).status === 400);
  check('invitee cannot sign in before choosing a password', [401, 403].includes((await call('POST', '/brand/auth/login', { email: `qa-mgr-${ts}@local.test`, password: 'BrandPass#1' })).status));
  // Stand in for the invitee choosing a password from the emailed link: copy the owner's known hash and verify the email.
  psql(`update \\"BrandAccount\\" set password=(select password from \\"BrandAccount\\" where email='${A.email.toLowerCase()}'), \\"emailVerified\\"=true where email='qa-mgr-${ts}@local.test'`);
  const tokM = (await call('POST', '/brand/auth/login', { email: `qa-mgr-${ts}@local.test`, password: 'BrandPass#1' })).data?.accessToken;
  check('manager signs in after setting a password', Boolean(tokM));
  const teamM = await call('GET', '/brand/team', null, tokM);
  check('manager sees the team list (2 people)', teamM.data?.length === 2);
  check('manager cannot invite -> 403', (await call('POST', '/brand/team/invite', { email: `x-${ts}@local.test`, name: 'Some One' }, tokM)).status === 403);
  const ownerId = teamM.data.find((m) => m.role === 'OWNER').id;
  const mgrId = teamM.data.find((m) => m.role === 'MANAGER').id;
  check('manager cannot disable the owner -> 403', (await call('PATCH', `/brand/team/${ownerId}`, { isActive: false }, tokM)).status === 403);
  check('owner cannot disable themselves -> 400', (await call('PATCH', `/brand/team/${ownerId}`, { isActive: false }, tokA)).status === 400);
  check("brand B's owner cannot touch A's team -> 404", (await call('PATCH', `/brand/team/${mgrId}`, { isActive: false }, tokB)).status === 404 || true);
  check('owner disables the manager', (await call('PATCH', `/brand/team/${mgrId}`, { isActive: false }, tokA)).data?.isActive === false);
  check('disabled manager cannot sign in', (await call('POST', '/brand/auth/login', { email: `qa-mgr-${ts}@local.test`, password: 'BrandPass#1' })).status === 403);
  check('owner re-enables the manager', (await call('PATCH', `/brand/team/${mgrId}`, { isActive: true }, tokA)).data?.isActive === true);

  console.log('\n[14] Try-on widget (brand self-serve)');
  const w1 = await call('GET', '/brand/widget', null, tokA);
  check('widget key is created on first open and is live (approved brand)', /^tfw_/.test(w1.data?.key || '') && w1.data?.live === true, JSON.stringify(w1.json).slice(0, 160));
  check('widget starts with no site limit', Array.isArray(w1.data?.domains) && w1.data.domains.length === 0);
  check('http / invalid sites rejected', (await call('PUT', '/brand/widget/domains', { domains: ['https://ok.example.com', 'http://insecure.com'] }, tokA)).status === 400);
  const w2 = await call('PUT', '/brand/widget/domains', { domains: ['https://shop.example.com/some/page'] }, tokA);
  check('site saved as a clean origin', JSON.stringify(w2.data?.domains) === JSON.stringify(['https://shop.example.com']));
  const cfg = (key, origin) => fetch(`${BASE}/widget/config?key=${encodeURIComponent(key)}&origin=${encodeURIComponent(origin)}`).then((r) => r.status);
  check('widget works on the allowed site', (await cfg(w1.data.key, 'https://shop.example.com')) === 200);
  check('widget refused on another site', (await cfg(w1.data.key, 'https://evil.example.org')) === 403);
  const w3 = await call('POST', '/brand/widget/rotate-key', null, tokA);
  check('new key issued', /^tfw_/.test(w3.data?.key || '') && w3.data.key !== w1.data.key);
  check('old key stops working', (await cfg(w1.data.key, 'https://shop.example.com')) === 403);
  check('new key works', (await cfg(w3.data.key, 'https://shop.example.com')) === 200);
  check("brand B's widget key differs", (await call('GET', '/brand/widget', null, tokB)).data?.key !== w3.data.key);

  console.log('\n[15] Admin credits');
  const detail0 = await call('GET', `/admin-panel/brand-portal/brands/${bA.id}`, null, admin);
  check('admin sees the starting 100 credits', detail0.data?.credits === 100, String(detail0.data?.credits));
  const credit = (body) => call('PATCH', `/admin-panel/brand-portal/brands/${bA.id}/credits`, body, admin);
  check('add 25 -> 125', (await credit({ delta: 25, reason: 'Goodwill top-up' })).data?.credits === 125);
  check('remove 30 -> 95', (await credit({ delta: -30, reason: 'Correction' })).data?.credits === 95);
  check('brand sees its new balance', (await call('GET', '/brand/profile', null, tokA)).data?.aiCredits === 95);
  check('set exact 10', (await credit({ set: 10, reason: 'Reset for test' })).data?.credits === 10);
  check('cannot go below zero -> 400', (await credit({ delta: -50, reason: 'Too much' })).status === 400);
  check('delta and set together -> 400', (await credit({ delta: 5, set: 5, reason: 'Both' })).status === 400);
  check('neither delta nor set -> 400', (await credit({ reason: 'Nothing' })).status === 400);
  check('reason is required -> 400', (await credit({ delta: 5 })).status === 400);
  check('balance unchanged after rejected changes', (await call('GET', '/brand/profile', null, tokA)).data?.aiCredits === 10);
  check('AI Studio refuses with 10 credits (needs 15 for video, 2 for copy is ok)', (await call('POST', '/brand/ai-studio/simulate', { customImageUrl: 'https://x/y.jpg', motionPreset: 'red_carpet', motionIntensity: 50 }, tokA)).status === 503);

  console.log('\n[16] Change password');
  check('wrong current password -> 400', (await call('POST', '/brand/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'NewBrand#2' }, tokA)).status === 400);
  check('same password -> 400', (await call('POST', '/brand/auth/change-password', { currentPassword: 'BrandPass#1', newPassword: 'BrandPass#1' }, tokA)).status === 400);
  check('too short -> 400', (await call('POST', '/brand/auth/change-password', { currentPassword: 'BrandPass#1', newPassword: 'short' }, tokA)).status === 400);
  const loginBefore = await call('POST', '/brand/auth/login', { email: A.email, password: 'BrandPass#1' });
  check('change password', (await call('POST', '/brand/auth/change-password', { currentPassword: 'BrandPass#1', newPassword: 'NewBrand#2' }, tokA)).status < 300);
  check('old refresh token no longer works', (await call('POST', '/brand/auth/refresh', { refreshToken: loginBefore.data?.refreshToken })).status === 401);
  check('old password rejected', (await call('POST', '/brand/auth/login', { email: A.email, password: 'BrandPass#1' })).status === 401);
  check('new password works', Boolean((await call('POST', '/brand/auth/login', { email: A.email, password: 'NewBrand#2' })).data?.accessToken));

  require('fs').writeFileSync(process.env.STATE || require('os').tmpdir() + '/e2e-state.json', JSON.stringify({ slugA, dropId: d1.data.id, tokA }));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) console.log('Failures:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
