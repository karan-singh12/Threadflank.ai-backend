import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

// Mirrors prisma/seed.ts — Prisma 7 needs the driver adapter passed explicitly.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/**
 * Idempotent: creates (or resets) one email-verified test brand account for the brand panel.
 * The brand stays PENDING, so it is not shown to shoppers; set BRAND_SEED_LIVE=true to make
 * it ACTIVE + verified (what an admin approval does).
 */
async function main() {
  const email = (process.env.BRAND_SEED_EMAIL || 'brand@threadflank.com').toLowerCase();
  const password = process.env.BRAND_SEED_PASSWORD || 'Brand@1234';
  const live = process.env.BRAND_SEED_LIVE === 'true';
  const slug = 'demo-atelier';

  const brand = await prisma.brand.upsert({
    where: { slug },
    update: live ? { status: 'ACTIVE', isVerified: true } : {},
    create: {
      name: 'Demo Atelier',
      slug,
      category: 'Ethnic Wear',
      description: 'Test brand for the Threadflank brand panel.',
      websiteUrl: 'https://example.com',
      status: live ? 'ACTIVE' : 'PENDING',
      isVerified: live,
      widgetEnabled: true,
      socialLinks: { workEmail: email, flagshipAddress: '', themeAccent: '#7c5cff', aiCredits: 100, rankScore: 0 },
    },
  });

  const hashed = await bcrypt.hash(password, 10);
  await prisma.brandAccount.upsert({
    where: { email },
    // Re-running the seed resets the password and makes sure the account is usable.
    update: { password: hashed, emailVerified: true, isActive: true },
    create: { brandId: brand.id, email, password: hashed, name: 'Demo Atelier', role: 'OWNER', emailVerified: true },
  });

  console.log(`[seed] Brand account ready: ${email} (brand "${brand.name}", status ${brand.status}, email verified).`);
  if (!process.env.BRAND_SEED_PASSWORD) console.log(`[seed] Password: ${password}`);
}

main()
  .catch((error) => {
    console.error('[seed] Brand seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
