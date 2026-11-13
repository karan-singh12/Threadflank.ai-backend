import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

/**
 * Scale-test data: many brands, each with a few hundred pieces grouped into collections.
 * It exists to check the brand panel, the brands directory and Discover at realistic size.
 *
 *   npm run seed:scale                         1000 brands, 200-500 pieces each
 *   npm run seed:scale -- --brands=50          a smaller run
 *   npm run seed:scale -- --min=200 --max=500  pieces per brand
 *   npm run seed:scale -- --reset              remove every scale-* brand (and its pieces) first
 *
 * Everything it creates has a slug starting "scale-" and a login scale-<n>@threadflank.test, so it can be
 * removed with --reset and never mixes with real brands. It refuses to run against a remote database
 * unless SEED_SCALE_ALLOW_REMOTE=true, so it cannot flood the live data by accident.
 */

const arg = (name: string, fallback: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? Number(hit.split('=')[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
const BRANDS = arg('brands', 1000);
const MIN = arg('min', 200);
const MAX = Math.max(MIN, arg('max', 500));
const RESET = process.argv.includes('--reset');
const PASSWORD = process.env.SEED_SCALE_PASSWORD || 'Scale@1234';

const url = process.env.DATABASE_URL ?? '';
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
if (!isLocal && process.env.SEED_SCALE_ALLOW_REMOTE !== 'true') {
  console.error('[seed:scale] DATABASE_URL is not a local database. Refusing to create thousands of test rows there.');
  console.error('[seed:scale] Point DATABASE_URL at a local Postgres (npm run db:up), or set SEED_SCALE_ALLOW_REMOTE=true if you really mean it.');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// A tiny seeded generator so two runs produce the same catalogue.
let state = 20260213;
const rnd = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const PREFIX = ['Rang', 'Kora', 'Meher', 'Saaj', 'Noor', 'Tarang', 'Ishaa', 'Veda', 'Mrinal', 'Zari', 'Aarya', 'Banjara', 'Kesar', 'Dhaga', 'Ambar', 'Sutra', 'Nakshi', 'Gulab', 'Heer', 'Indigo'];
const SUFFIX = ['House', 'Atelier', 'Loom', 'Studio', 'Label', 'Weaves', 'Co.', 'Collective', 'Threads', 'Couture'];
const CATEGORIES = ['Ethnic Wear', 'Suits & Sets', 'Sarees', 'Menswear', 'Contemporary'];
const KINDS: Record<string, string[]> = {
  'Ethnic Wear': ['Lehenga', 'Anarkali', 'Gharara', 'Sharara Set', 'Kurta Set', 'Angrakha'],
  'Suits & Sets': ['Co-ord Set', 'Straight Suit', 'Palazzo Suit', 'Kaftan Set', 'Pant Suit'],
  Sarees: ['Banarasi Saree', 'Chanderi Saree', 'Organza Saree', 'Kanjivaram Saree', 'Linen Saree'],
  Menswear: ['Sherwani', 'Bandhgala', 'Nehru Jacket', 'Kurta Pyjama', 'Indo-Western Set'],
  Contemporary: ['Wrap Dress', 'Shirt Dress', 'Blazer Set', 'Midi Skirt Set', 'Jumpsuit'],
};
const FABRICS = ['Zari Brocade', 'Raw Silk', 'Chanderi', 'Georgette', 'Organza', 'Velvet', 'Linen', 'Cotton Mul', 'Tissue', 'Crepe'];
const COLOURS = ['Ivory', 'Blush', 'Emerald', 'Midnight', 'Saffron', 'Ruby', 'Sage', 'Mustard', 'Indigo', 'Rose Gold', 'Wine', 'Teal'];
const OCCASIONS = ['Wedding', 'Reception', 'Sangeet', 'Mehendi', 'Festive', 'Cocktail', 'Office', 'Brunch'];
const COLLECTIONS = ['Wedding Edit', 'Festive Capsule', 'Summer Linen', 'Monsoon Weaves', 'Heritage Archive', 'Reception Evenings', 'Everyday Essentials', 'Bridal Atelier', 'Resort Break', 'Winter Velvet'];

const chunk = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

async function main() {
  if (RESET) {
    const { count } = await prisma.brand.deleteMany({ where: { slug: { startsWith: 'scale-' } } });
    console.log(`[seed:scale] Removed ${count} scale-* brands (their pieces and logins go with them).`);
  }

  const hashed = await bcrypt.hash(PASSWORD, 8);
  const started = Date.now();
  let pieces = 0;

  for (const group of chunk(Array.from({ length: BRANDS }, (_, i) => i + 1), 25)) {
    const brands = group.map((n) => {
      const name = `${pick(PREFIX)} ${pick(SUFFIX)} ${n}`;
      return {
        n,
        data: {
          name,
          slug: `scale-${n}`,
          category: pick(CATEGORIES),
          description: `Test brand ${n} for scale checks.`,
          websiteUrl: `https://scale-${n}.example.com`,
          status: 'ACTIVE' as const,
          isVerified: n % 3 === 0,
          widgetEnabled: true,
          socialLinks: { workEmail: `scale-${n}@threadflank.test`, themeAccent: '#7c5cff', aiCredits: 100, rankScore: between(0, 1000) },
        },
      };
    });
    await prisma.brand.createMany({ data: brands.map((b) => b.data), skipDuplicates: true });
    const saved = await prisma.brand.findMany({ where: { slug: { in: brands.map((b) => b.data.slug) } }, select: { id: true, slug: true, name: true } });

    await prisma.brandAccount.createMany({
      data: saved.map((b) => ({ brandId: b.id, email: `${b.slug}@threadflank.test`, password: hashed, name: b.name, role: 'OWNER' as const, emailVerified: true })),
      skipDuplicates: true,
    });

    for (const brand of saved) {
      const count = between(MIN, MAX);
      const mine = COLLECTIONS.slice(0, between(3, COLLECTIONS.length)).map((c) => `${c} ${2026 - (brand.slug.length % 2)}`);
      const rows = Array.from({ length: count }, (_, i) => {
        const category = pick(CATEGORIES);
        const price = between(18, 950) * 100;
        const stock = rnd() < 0.08 ? 0 : rnd() < 0.15 ? between(1, 3) : between(4, 60);
        const hasImage = rnd() > 0.04;
        const sku = `${brand.slug.toUpperCase().replace('SCALE-', 'S')}-${String(i + 1).padStart(4, '0')}`;
        const created = new Date(Date.now() - i * 3_600_000 - between(0, 3_000_000));
        return {
          brandId: brand.id,
          title: `${pick(COLOURS)} ${pick(FABRICS)} ${pick(KINDS[category])}`,
          sku,
          price,
          originalPrice: rnd() < 0.25 ? Math.round(price * 1.2) : null,
          images: hasImage ? [`https://picsum.photos/seed/${sku}/600/800`] : [],
          category,
          occasions: Array.from(new Set([pick(OCCASIONS), pick(OCCASIONS)])),
          colors: [pick(COLOURS)],
          sizes: ['S', 'M', 'L'],
          stock,
          isDrapeReady: hasImage,
          drapeScore: between(40, 99),
          drapesCount: between(0, 400),
          clicksCount: between(0, 120),
          buyUrl: `https://scale-${brand.slug.slice(6)}.example.com/p/${sku.toLowerCase()}`,
          featured: i < 3,
          newDrop: i < 12,
          collection: rnd() < 0.85 ? pick(mine) : null,
          description: 'Scale-test piece. Not a real product.',
          status: rnd() < 0.12 ? ('DRAFT' as const) : ('PUBLISHED' as const),
          publishedAt: created,
          createdAt: created,
        };
      });
      for (const part of chunk(rows, 1000)) await prisma.brandProduct.createMany({ data: part, skipDuplicates: true });
      pieces += rows.length;
    }
    const done = group[group.length - 1];
    console.log(`[seed:scale] ${done}/${BRANDS} brands, ${pieces.toLocaleString()} pieces, ${Math.round((Date.now() - started) / 1000)}s`);
  }

  console.log(`[seed:scale] Done. Sign in to the brand panel as scale-1@threadflank.test / ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('[seed:scale] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
