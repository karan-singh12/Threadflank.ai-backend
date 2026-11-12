import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Fills the Discover categories and occasions lists the first time, from what already exists, so nothing
 * disappears when admins start managing them. Safe to run again: it only adds entries that are missing and
 * never changes or reorders existing ones.
 *
 *   npm run seed:taxonomy
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const slugOf = (v: string) => v.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The Indian occasions from the product blueprint. */
const OCCASIONS = ['Haldi', 'Mehendi', 'Sangeet', 'Shaadi', 'Reception', 'Engagement', 'Diwali', 'Navratri / Garba', 'Karva Chauth', 'Eid', 'Teej', 'Gangaur', 'Birthday', 'Office party', 'Date night'];

async function main() {
  // Categories already in use, most used first (that becomes the starting order).
  const counts = new Map<string, { name: string; n: number }>();
  const add = (name: string | null | undefined, n: number) => {
    const clean = (name ?? '').replace(/\s+/g, ' ').trim();
    const slug = slugOf(clean);
    if (!slug) return;
    const cur = counts.get(slug);
    counts.set(slug, { name: cur?.name ?? clean, n: (cur?.n ?? 0) + n });
  };
  for (const g of await prisma.brandProduct.groupBy({ by: ['category'], _count: { _all: true } })) add(g.category, g._count._all);
  for (const g of await prisma.brandPost.groupBy({ by: ['category'], where: { isDeleted: false }, _count: { _all: true } })) add(g.category, g._count._all);
  const categories = [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  const occasionsInUse = new Map<string, string>();
  for (const p of await prisma.brandProduct.findMany({ select: { occasions: true } })) for (const o of p.occasions) occasionsInUse.set(slugOf(o), o.trim());
  const occasions = [...OCCASIONS, ...[...occasionsInUse.values()]];

  let made = 0;
  for (const [kind, names] of [['CATEGORY', categories.map((c) => c.name)], ['OCCASION', occasions]] as const) {
    const have = await prisma.discoverCategory.findMany({ where: { kind }, select: { slug: true, sortOrder: true } });
    const seen = new Set(have.map((h) => h.slug));
    let order = have.reduce((m, h) => Math.max(m, h.sortOrder), -1) + 1;
    for (const name of names) {
      const slug = slugOf(name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      await prisma.discoverCategory.create({ data: { kind, name, slug, sortOrder: order++ } });
      made++;
    }
  }
  console.log(`Added ${made} entries. Categories: ${await prisma.discoverCategory.count({ where: { kind: 'CATEGORY' } })}, occasions: ${await prisma.discoverCategory.count({ where: { kind: 'OCCASION' } })}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
