import 'dotenv/config';
import { PrismaClient, AdminRole, FriendshipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

// Mirrors seed.ts — Prisma 7 with @prisma/adapter-pg requires the driver
// adapter to be passed explicitly.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Local-development demo data: a brand manager, a few end users with
 * friendships, a twin profile, wardrobe items, saved looks, studio
 * backgrounds and email templates. Run after seed.ts and seed-discover.ts
 * (brand manager assignments need the seeded brands). Idempotent — rows are
 * matched by email / slug / key / name, so re-running is safe.
 */

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || 'Demo@1234';
const DAY = 24 * 60 * 60 * 1000;

const USERS = [
  { email: 'demo@threadflank.com', username: 'demo', bio: 'Minimal wardrobe, maximum outfits.', location: 'Mumbai, IN', avatar: '/public/seed/female_avatar.png' },
  { email: 'priya@threadflank.com', username: 'priya', bio: 'Ethnic fusion and weekend brunches.', location: 'Bengaluru, IN', avatar: '/public/seed/female_avatar.png' },
  { email: 'arjun@threadflank.com', username: 'arjun', bio: 'Streetwear, sneakers, repeat.', location: 'Delhi, IN', avatar: '/public/seed/male_avatar.png' },
];

const WARDROBE = [
  { name: 'White Oxford Shirt', brand: 'Zara', category: 'Tops', image: '/public/seed/white_oxford.png', color: 'White', tags: ['Work', 'Classic'], wornCount: 14, costPaid: 2490, lastWornDaysAgo: 3 },
  { name: 'Silk Blouse', brand: 'H&M', category: 'Tops', image: '/public/seed/silk_blouse.png', color: 'Ivory', tags: ['Work', 'Date'], wornCount: 6, costPaid: 1999, lastWornDaysAgo: 12 },
  { name: 'Graphic Tee', brand: 'Nike', category: 'Tops', image: '/public/seed/graphic_tee.png', color: 'Black', tags: ['Casual'], wornCount: 22, costPaid: 1295, lastWornDaysAgo: 1 },
  { name: 'Black Slim Jeans', brand: 'Zara', category: 'Bottoms', image: '/public/seed/black_jeans.png', color: 'Black', tags: ['Casual', 'Work'], wornCount: 31, costPaid: 2990, lastWornDaysAgo: 2 },
  { name: 'Velvet Midi Skirt', brand: 'H&M', category: 'Bottoms', image: '/public/seed/velvet_skirt.png', color: 'Burgundy', tags: ['Party'], wornCount: 1, costPaid: 2299, lastWornDaysAgo: 120 },
  { name: 'Floral Wrap Dress', brand: 'H&M', category: 'Dresses', image: '/public/seed/floral_dress.png', color: 'Multi', tags: ['Brunch', 'Summer'], wornCount: 4, costPaid: 2799, lastWornDaysAgo: 30 },
  { name: 'Little Black Dress', brand: 'Prada', category: 'Dresses', image: '/public/seed/little_black_dress.png', color: 'Black', tags: ['Party', 'Date'], wornCount: 3, costPaid: 18500, lastWornDaysAgo: 45 },
  { name: 'Tailored Blazer', brand: 'Zara', category: 'Outerwear', image: '/public/seed/blazer.png', color: 'Camel', tags: ['Work', 'Formal'], wornCount: 9, costPaid: 5990, lastWornDaysAgo: 7 },
  { name: 'Classic Trench Coat', brand: 'Gucci', category: 'Outerwear', image: '/public/seed/trench_coat.png', color: 'Beige', tags: ['Classic'], wornCount: 0, costPaid: 42000, lastWornDaysAgo: null },
  { name: 'White Sneakers', brand: 'Nike', category: 'Footwear', image: '/public/seed/white_sneakers.png', color: 'White', tags: ['Casual'], wornCount: 40, costPaid: 7495, lastWornDaysAgo: 1 },
  { name: 'Heel Pumps', brand: 'Zara', category: 'Footwear', image: '/public/seed/heel_pumps.png', color: 'Nude', tags: ['Formal', 'Party'], wornCount: 5, costPaid: 3590, lastWornDaysAgo: 21 },
  { name: 'Leather Tote', brand: 'Prada', category: 'Bags', image: '/public/seed/leather_tote.png', color: 'Tan', tags: ['Work'], wornCount: 18, costPaid: 9800, lastWornDaysAgo: 4 },
  { name: 'Layered Pearl Necklace', brand: null, category: 'Jewellery', image: '/public/seed/pearl_necklace.png', color: 'Pearl', tags: ['Party'], wornCount: 2, costPaid: 1450, lastWornDaysAgo: 60 },
  { name: 'Aviator Sunglasses', brand: null, category: 'Eyewear', image: '/public/seed/sunglasses.png', color: 'Gold', tags: ['Summer'], wornCount: 11, costPaid: 1800, lastWornDaysAgo: 9 },
];

const LOOKS = [
  { name: 'Monday Office', occasion: 'work', image: '/public/seed/look_office.png', pieces: ['Tops', 'Bottoms', 'Outerwear'], liked: true },
  { name: 'Sunday Brunch', occasion: 'casual', image: '/public/seed/look_brunch.png', pieces: ['Dresses', 'Footwear'], liked: true },
  { name: 'Date Night', occasion: 'date', image: '/public/seed/look_date.png', pieces: ['Dresses', 'Jewellery'], liked: false },
  { name: 'Friday Party', occasion: 'party', image: '/public/seed/look_party.png', pieces: ['Dresses', 'Footwear', 'Jewellery'], liked: false },
];

// Matches frontend/src/data/studio-content.ts BACKGROUNDS.
const BACKGROUNDS = [
  { name: 'Studio', category: 'Studio', cssGradient: 'radial-gradient(circle at 50% 30%, #2a2548 0%, #0d0c1f 70%)', isDefault: true },
  { name: 'Daylight', category: 'Studio', cssGradient: 'linear-gradient(180deg, #f3efe8 0%, #d9d2c6 100%)', isDefault: false },
  { name: 'Sunset terrace', category: 'Outdoor', cssGradient: 'linear-gradient(180deg, #ffb88c 0%, #de6262 55%, #3a1c40 100%)', isDefault: false },
  { name: 'Garden', category: 'Outdoor', cssGradient: 'linear-gradient(180deg, #cfe8c0 0%, #6fa66b 55%, #28452a 100%)', isDefault: false },
  { name: 'City street', category: 'Outdoor', cssGradient: 'linear-gradient(180deg, #a3b1c6 0%, #52607a 55%, #1c2230 100%)', isDefault: false },
  { name: 'Festive', category: 'Occasion', cssGradient: 'radial-gradient(circle at 50% 20%, #ffd87a 0%, #d2553a 45%, #4a1030 100%)', isDefault: false },
];

const EMAIL_TEMPLATES = [
  {
    key: 'welcome',
    name: 'Welcome email',
    subject: 'Welcome to Threadflank, {{name}}!',
    htmlBody: '<h1>Hi {{name}},</h1><p>Your wardrobe just got smarter. Add a few pieces and try your first outfit on your digital twin.</p><p><a href="{{appUrl}}">Open Threadflank</a></p>',
    variables: ['name', 'appUrl'],
  },
  {
    key: 'password-reset',
    name: 'Password reset',
    subject: 'Reset your Threadflank password',
    htmlBody: '<p>Hi {{name}},</p><p>Use the link below to reset your password. It expires in {{expiresInMinutes}} minutes.</p><p><a href="{{resetUrl}}">Reset password</a></p><p>If you didn\'t ask for this, you can ignore this email.</p>',
    variables: ['name', 'resetUrl', 'expiresInMinutes'],
  },
];

async function seedBrandManager() {
  const email = 'manager@threadflank.com';
  let manager = await prisma.adminUser.findUnique({ where: { email } });
  if (!manager) {
    manager = await prisma.adminUser.create({
      data: { email, name: 'Brand Manager', password: await bcrypt.hash(DEMO_PASSWORD, 10), role: AdminRole.BRAND_MANAGER, isActive: true },
    });
    console.log(`[seed-demo] Created BRAND_MANAGER ${email}.`);
  }

  const brands = await prisma.brand.findMany({ where: { slug: { in: ['hm', 'zara'] } } });
  if (!brands.length) console.warn('[seed-demo] No brands found — run seed-discover.ts first to assign the brand manager.');
  for (const brand of brands) {
    await prisma.brandManagerAssignment.upsert({
      where: { adminUserId_brandId: { adminUserId: manager.id, brandId: brand.id } },
      update: {},
      create: { adminUserId: manager.id, brandId: brand.id },
    });
  }
}

async function seedUsers() {
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = [];
  for (const u of USERS) {
    users.push(await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, password } }));
  }
  const [demo, priya, arjun] = users;

  const friendships = [
    { senderId: demo.id, receiverId: priya.id, status: FriendshipStatus.ACCEPTED },
    { senderId: arjun.id, receiverId: demo.id, status: FriendshipStatus.PENDING },
  ];
  for (const f of friendships) {
    await prisma.friendship.upsert({
      where: { senderId_receiverId: { senderId: f.senderId, receiverId: f.receiverId } },
      update: {},
      create: f,
    });
  }

  await prisma.twinProfile.upsert({
    where: { userId: demo.id },
    update: {},
    create: { userId: demo.id, gender: 'female', age: 27, heightCm: 165, weightKg: 58, skinTone: 'medium', hairColor: 'black' },
  });

  console.log(`[seed-demo] Upserted ${users.length} users (password: ${DEMO_PASSWORD}).`);
  return demo;
}

async function seedWardrobe(userId: string) {
  if (await prisma.wardrobeItem.count({ where: { userId } })) return;
  await prisma.wardrobeItem.createMany({
    data: WARDROBE.map(({ lastWornDaysAgo, ...item }) => ({
      ...item,
      userId,
      lastWornAt: lastWornDaysAgo === null ? null : new Date(Date.now() - lastWornDaysAgo * DAY),
    })),
  });
  await prisma.look.createMany({ data: LOOKS.map((look) => ({ ...look, userId })) });
  console.log(`[seed-demo] Created ${WARDROBE.length} wardrobe items and ${LOOKS.length} looks.`);
}

async function seedStudioBackgrounds() {
  for (const [order, bg] of BACKGROUNDS.entries()) {
    const existing = await prisma.studioBackground.findFirst({ where: { name: bg.name } });
    if (!existing) await prisma.studioBackground.create({ data: { ...bg, order } });
  }
}

async function seedEmailTemplates() {
  for (const t of EMAIL_TEMPLATES) {
    await prisma.emailTemplate.upsert({ where: { key: t.key }, update: {}, create: t });
  }
}

async function main() {
  await seedBrandManager();
  const demo = await seedUsers();
  await seedWardrobe(demo.id);
  await seedStudioBackgrounds();
  await seedEmailTemplates();
  console.log('[seed-demo] Done.');
}

main()
  .catch((error) => {
    console.error('[seed-demo] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
