import 'dotenv/config';
import { PrismaClient, BrandStatus, ContentStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Mirrors seed.ts — Prisma 7 with @prisma/adapter-pg requires the driver
// adapter to be passed explicitly.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Dummy content for the Discover/Trending feed (GET /api/brands +
 * GET /api/brand-posts). Idempotent: brands are upserted by slug, and a
 * post is only created if no post with the same brand + title exists yet,
 * so re-running this script is safe.
 */

interface SeedPost {
  title: string;
  caption: string;
  images: string[];
  category: string;
  taggedProducts: { name: string; brand: string; price: string; thumbnail: string }[];
  daysAgo: number;
}

interface SeedBrand {
  name: string;
  slug: string;
  category: string;
  description: string;
  isVerified: boolean;
  logoInitials: string;
  logoColor: string;
  customLogoUrl?: string;
  posts: SeedPost[];
}

/** Builds a simple circular monogram logo (initials on a flat color) as a
 * base64 SVG data URI, so every seeded brand has a real logoUrl to render
 * without depending on external image hosting. */
function makeLogoDataUri(initials: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${color}"/><text x="64" y="66" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="700" fill="#ffffff">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const HM_LOGO = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23E50010"/><text x="50" y="63" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-style="italic" font-size="34" fill="%23ffffff" text-anchor="middle" letter-spacing="-1">H%26M</text></svg>`;
const ZARA_LOGO = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23000000"/><text x="50" y="62" font-family="Georgia, Times New Roman, serif" font-weight="900" font-size="24" fill="%23ffffff" text-anchor="middle" letter-spacing="1">ZARA</text></svg>`;
const GUCCI_LOGO = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%230d1b13"/><circle cx="50" cy="50" r="44" fill="none" stroke="%23d4af37" stroke-width="2"/><text x="50" y="58" font-family="Cinzel, Times New Roman, serif" font-weight="700" font-size="18" fill="%23d4af37" text-anchor="middle" letter-spacing="3">GUCCI</text></svg>`;
const PRADA_LOGO = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23111111"/><polygon points="50,20 84,74 16,74" fill="none" stroke="%23ffffff" stroke-width="1.8"/><text x="50" y="58" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="14" fill="%23ffffff" text-anchor="middle" letter-spacing="2">PRADA</text><text x="50" y="68" font-family="Arial, sans-serif" font-weight="600" font-size="7" fill="%23ffffff" text-anchor="middle" letter-spacing="1">MILANO</text></svg>`;
const NIKE_LOGO = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%230f172a"/><path d="M22 55 C34 61 45 66 54 65 C68 63 82 46 84 32 C81 40 73 47 61 49 C48 51 36 44 22 55 Z" fill="%23ffffff"/></svg>`;

const BRANDS: SeedBrand[] = [
  {
    name: 'H&M',
    slug: 'hm',
    logoInitials: 'HM',
    logoColor: '#E50010',
    customLogoUrl: HM_LOGO,
    category: 'Streetwear',
    description: 'Fashion and quality at the best price in a sustainable way.',
    isVerified: true,
    posts: [
      {
        title: 'The Autumn Capsule 2026',
        caption: 'Relaxed silhouettes, earth tones, and effortless layering for every day.',
        images: ['/images/look_errands.png', '/images/look_brunch.png'],
        category: 'Streetwear',
        taggedProducts: [{ name: 'Oversized Trench', brand: 'H&M', price: '89.00', thumbnail: '/images/look_errands.png' }],
        daysAgo: 1,
      },
    ],
  },
  {
    name: 'ZARA',
    slug: 'zara',
    logoInitials: 'ZA',
    logoColor: '#000000',
    customLogoUrl: ZARA_LOGO,
    category: 'Minimalist',
    description: 'Contemporary runway fashion and modern silhouettes.',
    isVerified: true,
    posts: [
      {
        title: 'Studio Tailoring No. 12',
        caption: 'Double-breasted structured tailoring cut from premium wool.',
        images: ['/images/blazer.png', '/images/look_office.png'],
        category: 'Minimalist',
        taggedProducts: [{ name: 'Structured Tailored Blazer', brand: 'ZARA', price: '169.00', thumbnail: '/images/blazer.png' }],
        daysAgo: 2,
      },
    ],
  },
  {
    name: 'Gucci',
    slug: 'gucci',
    logoInitials: 'GG',
    logoColor: '#0d1b13',
    customLogoUrl: GUCCI_LOGO,
    category: 'Luxury Tailoring',
    description: 'Italian luxury fashion house redefining modern style.',
    isVerified: true,
    posts: [
      {
        title: 'Ancora Milano Runway',
        caption: 'Fluid evening elegance, tailored silhouettes, and high-shine gold accents.',
        images: ['/images/look_formal.png', '/images/satin_dress.png'],
        category: 'Luxury Tailoring',
        taggedProducts: [{ name: 'Ancora Wool Tuxedo Jacket', brand: 'Gucci', price: '2850.00', thumbnail: '/images/look_formal.png' }],
        daysAgo: 3,
      },
    ],
  },
  {
    name: 'Prada',
    slug: 'prada',
    logoInitials: 'PR',
    logoColor: '#111111',
    customLogoUrl: PRADA_LOGO,
    category: 'Minimalist',
    description: 'Modernist luxury, avant-garde design and exquisite craftsmanship.',
    isVerified: true,
    posts: [
      {
        title: 'Re-Nylon Architectural Trench',
        caption: 'Architectural lines meet utilitarian luxury in sustainable nylon.',
        images: ['/images/trench_coat.png'],
        category: 'Minimalist',
        taggedProducts: [{ name: 'Re-Nylon Technical Trench', brand: 'Prada', price: '2600.00', thumbnail: '/images/trench_coat.png' }],
        daysAgo: 4,
      },
    ],
  },
  {
    name: 'Nike',
    slug: 'nike',
    logoInitials: 'NK',
    logoColor: '#0f172a',
    customLogoUrl: NIKE_LOGO,
    category: 'Streetwear',
    description: 'Just do it. Innovation and inspiration for every athlete in the world.',
    isVerified: true,
    posts: [
      {
        title: 'Tech Street Series 05',
        caption: 'Aerodynamic cutlines, bonded seams, and futuristic streetwear.',
        images: ['/images/look_party.png', '/images/white_sneakers.png'],
        category: 'Streetwear',
        taggedProducts: [{ name: 'Tech Pack Shell', brand: 'Nike', price: '180.00', thumbnail: '/images/look_party.png' }],
        daysAgo: 5,
      },
    ],
  },
  {
    name: 'Aureate Atelier',
    slug: 'aureate-atelier',
    logoInitials: 'AA',
    logoColor: '#0ea5e9',
    category: 'Luxury Tailoring',
    description: 'Hand-finished tailoring for the modern wardrobe.',
    isVerified: true,
    posts: [
      {
        title: 'The Midnight Blazer',
        caption: 'Structured shoulders, silk lining, zero compromise. Our tailoring line just dropped.',
        images: ['/images/blazer.png', '/images/look_formal.png'],
        category: 'Luxury Tailoring',
        taggedProducts: [{ name: 'Midnight Wool Blazer', brand: 'Aureate Atelier', price: '289.00', thumbnail: '/images/blazer.png' }],
        daysAgo: 1,
      },
      {
        title: 'Trench Season',
        caption: 'A trench that moves with you. Cut from water-resistant cotton twill.',
        images: ['/images/trench_coat.png'],
        category: 'Luxury Tailoring',
        taggedProducts: [{ name: 'Classic Trench Coat', brand: 'Aureate Atelier', price: '340.00', thumbnail: '/images/trench_coat.png' }],
        daysAgo: 6,
      },
    ],
  },
  {
    name: 'Urban Forge',
    slug: 'urban-forge',
    logoInitials: 'UF',
    logoColor: '#0369a1',
    category: 'Streetwear',
    description: 'Streetwear built for the daily grind.',
    isVerified: true,
    posts: [
      {
        title: 'Graphic Drop 04',
        caption: 'Heavyweight cotton, oversized fit. Limited run — restock not guaranteed.',
        images: ['/images/graphic_tee.png', '/images/look_errands.png'],
        category: 'Streetwear',
        taggedProducts: [{ name: 'Oversized Graphic Tee', brand: 'Urban Forge', price: '48.00', thumbnail: '/images/graphic_tee.png' }],
        daysAgo: 2,
      },
      {
        title: 'Denim on Denim',
        caption: 'Stacked jeans, fresh sneakers. This is our uniform.',
        images: ['/images/black_jeans.png', '/images/white_sneakers.png'],
        category: 'Streetwear',
        taggedProducts: [
          { name: 'Straight Fit Jeans', brand: 'Urban Forge', price: '76.00', thumbnail: '/images/black_jeans.png' },
          { name: 'Court Sneakers', brand: 'Urban Forge', price: '92.00', thumbnail: '/images/white_sneakers.png' },
        ],
        daysAgo: 8,
      },
    ],
  },
  {
    name: 'Linen & Lore',
    slug: 'linen-and-lore',
    logoInitials: 'LL',
    logoColor: '#64748b',
    category: 'Minimalist',
    description: 'Quiet luxury in natural fibers.',
    isVerified: false,
    posts: [
      {
        title: 'Off-Duty Oxford',
        caption: 'One shirt, every outfit. Our best-selling oxford restocked in three colorways.',
        images: ['/images/white_oxford.png'],
        category: 'Minimalist',
        taggedProducts: [{ name: 'Relaxed Oxford Shirt', brand: 'Linen & Lore', price: '64.00', thumbnail: '/images/white_oxford.png' }],
        daysAgo: 3,
      },
      {
        title: 'The Capsule Edit',
        caption: 'Five pieces, endless combinations. Building a wardrobe that lasts.',
        images: ['/images/look_office.png'],
        category: 'Minimalist',
        taggedProducts: [{ name: 'Silk Blend Blouse', brand: 'Linen & Lore', price: '88.00', thumbnail: '/images/silk_blouse.png' }],
        daysAgo: 9,
      },
    ],
  },
  {
    name: 'Velvet Row',
    slug: 'velvet-row',
    logoInitials: 'VR',
    logoColor: '#1e3a8a',
    category: 'Partywear',
    description: 'After-dark dressing, done right.',
    isVerified: true,
    posts: [
      {
        title: 'Satin Nights',
        caption: 'Slip into something that catches the light. New satin collection is live.',
        images: ['/images/satin_dress.png', '/images/look_party.png'],
        category: 'Partywear',
        taggedProducts: [{ name: 'Bias-Cut Satin Dress', brand: 'Velvet Row', price: '156.00', thumbnail: '/images/satin_dress.png' }],
        daysAgo: 1,
      },
      {
        title: 'Velvet Skirt, Gold Details',
        caption: 'Paired with pearls for a look that never misses.',
        images: ['/images/velvet_skirt.png', '/images/pearl_necklace.png'],
        category: 'Partywear',
        taggedProducts: [
          { name: 'Emerald Velvet Skirt', brand: 'Velvet Row', price: '118.00', thumbnail: '/images/velvet_skirt.png' },
          { name: 'Freshwater Pearl Necklace', brand: 'Velvet Row', price: '54.00', thumbnail: '/images/pearl_necklace.png' },
        ],
        daysAgo: 5,
      },
    ],
  },
  {
    name: 'Sundial Studio',
    slug: 'sundial-studio',
    logoInitials: 'SS',
    logoColor: '#0891b2',
    category: 'Summer Casual',
    description: 'Warm-weather dressing for long, easy days.',
    isVerified: false,
    posts: [
      {
        title: 'Golden Hour Florals',
        caption: 'Our floral midi is back in stock — the one everyone asked about.',
        images: ['/images/floral_dress.png', '/images/look_brunch.png'],
        category: 'Summer Casual',
        taggedProducts: [{ name: 'Floral Midi Dress', brand: 'Sundial Studio', price: '72.00', thumbnail: '/images/floral_dress.png' }],
        daysAgo: 2,
      },
      {
        title: 'Sunglasses Season',
        caption: 'Polarized, lightweight, and the last accessory you need this summer.',
        images: ['/images/sunglasses.png', '/images/look_date.png'],
        category: 'Summer Casual',
        taggedProducts: [{ name: 'Round Polarized Sunglasses', brand: 'Sundial Studio', price: '38.00', thumbnail: '/images/sunglasses.png' }],
        daysAgo: 11,
      },
    ],
  },
  {
    name: 'Nordic Thread',
    slug: 'nordic-thread',
    logoInitials: 'NT',
    logoColor: '#0f766e',
    category: 'Minimalist',
    description: 'Scandinavian minimalism meets everyday wear.',
    isVerified: true,
    posts: [
      {
        title: 'Monochrome Layers',
        caption: 'Neutral tones, clean lines. Our take on quiet minimalism.',
        images: ['/images/silk_blouse.png', '/images/black_jeans.png'],
        category: 'Minimalist',
        taggedProducts: [{ name: 'Silk Blend Blouse', brand: 'Nordic Thread', price: '94.00', thumbnail: '/images/silk_blouse.png' }],
        daysAgo: 4,
      },
      {
        title: 'The Little Black Dress',
        caption: 'A wardrobe staple, reworked with a modern silhouette.',
        images: ['/images/little_black_dress.png'],
        category: 'Minimalist',
        taggedProducts: [{ name: 'Tailored LBD', brand: 'Nordic Thread', price: '128.00', thumbnail: '/images/little_black_dress.png' }],
        daysAgo: 10,
      },
    ],
  },
  {
    name: 'Blackbird Denim',
    slug: 'blackbird-denim',
    logoInitials: 'BD',
    logoColor: '#334155',
    category: 'Streetwear',
    description: 'Raw denim, made to be lived in.',
    isVerified: false,
    posts: [
      {
        title: 'Raw Selvedge Drop',
        caption: 'Small batch, hand-finished. Our raw denim run just landed.',
        images: ['/images/black_jeans.png', '/images/look_errands.png'],
        category: 'Streetwear',
        taggedProducts: [{ name: 'Raw Selvedge Jeans', brand: 'Blackbird Denim', price: '138.00', thumbnail: '/images/black_jeans.png' }],
        daysAgo: 3,
      },
      {
        title: 'Sneaker Rotation',
        caption: 'What we’re wearing on repeat this month.',
        images: ['/images/white_sneakers.png'],
        category: 'Streetwear',
        taggedProducts: [{ name: 'Low-Top Sneakers', brand: 'Blackbird Denim', price: '84.00', thumbnail: '/images/white_sneakers.png' }],
        daysAgo: 7,
      },
    ],
  },
  {
    name: 'Office Muse',
    slug: 'office-muse',
    logoInitials: 'OM',
    logoColor: '#1d4ed8',
    category: 'Office Chic',
    description: 'Workwear that still feels like you.',
    isVerified: true,
    posts: [
      {
        title: 'Boardroom Ready',
        caption: 'Sharp blazer, tailored trouser. Nine-to-five, elevated.',
        images: ['/images/blazer.png', '/images/look_office.png'],
        category: 'Office Chic',
        taggedProducts: [{ name: 'Structured Blazer', brand: 'Office Muse', price: '165.00', thumbnail: '/images/blazer.png' }],
        daysAgo: 1,
      },
      {
        title: 'Heels for Long Days',
        caption: 'Comfort-engineered heels that survive back-to-back meetings.',
        images: ['/images/heel_pumps.png'],
        category: 'Office Chic',
        taggedProducts: [{ name: 'Comfort Pumps', brand: 'Office Muse', price: '98.00', thumbnail: '/images/heel_pumps.png' }],
        daysAgo: 6,
      },
    ],
  },
  {
    name: 'Coastal Edit',
    slug: 'coastal-edit',
    logoInitials: 'CE',
    logoColor: '#0e7490',
    category: 'Summer Casual',
    description: 'Effortless dressing inspired by the coast.',
    isVerified: false,
    posts: [
      {
        title: 'Brunch by the Water',
        caption: 'Linen shirt, bare feet, good light. Our summer campaign is live.',
        images: ['/images/look_brunch.png', '/images/white_oxford.png'],
        category: 'Summer Casual',
        taggedProducts: [{ name: 'Linen Popover Shirt', brand: 'Coastal Edit', price: '58.00', thumbnail: '/images/white_oxford.png' }],
        daysAgo: 4,
      },
      {
        title: 'Date Night, Coastal Style',
        caption: 'Easy dressing for warm evenings out.',
        images: ['/images/look_date.png', '/images/floral_dress.png'],
        category: 'Summer Casual',
        taggedProducts: [{ name: 'Floral Wrap Dress', brand: 'Coastal Edit', price: '69.00', thumbnail: '/images/floral_dress.png' }],
        daysAgo: 12,
      },
    ],
  },
  {
    name: 'Noir & Gold',
    slug: 'noir-and-gold',
    logoInitials: 'NG',
    logoColor: '#075985',
    category: 'Partywear',
    description: 'Statement pieces for nights that matter.',
    isVerified: true,
    posts: [
      {
        title: 'Party Season Opener',
        caption: 'The look that started three group chats. New drop, limited sizes.',
        images: ['/images/look_party.png', '/images/satin_dress.png'],
        category: 'Partywear',
        taggedProducts: [{ name: 'Statement Satin Dress', brand: 'Noir & Gold', price: '175.00', thumbnail: '/images/satin_dress.png' }],
        daysAgo: 2,
      },
      {
        title: 'Gold Hour Accessories',
        caption: 'The finishing touches — pearls, gold tones, done.',
        images: ['/images/pearl_necklace.png'],
        category: 'Partywear',
        taggedProducts: [{ name: 'Layered Pearl Necklace', brand: 'Noir & Gold', price: '46.00', thumbnail: '/images/pearl_necklace.png' }],
        daysAgo: 9,
      },
    ],
  },
];

async function main() {
  let createdBrands = 0;
  let createdPosts = 0;

  for (const b of BRANDS) {
    const logoUrl = b.customLogoUrl || makeLogoDataUri(b.logoInitials, b.logoColor);
    const brand = await prisma.brand.upsert({
      where: { slug: b.slug },
      update: { logoUrl },
      create: {
        name: b.name,
        slug: b.slug,
        category: b.category,
        description: b.description,
        isVerified: b.isVerified,
        logoUrl,
        status: BrandStatus.ACTIVE,
      },
    });
    createdBrands++;

    for (const p of b.posts) {
      const existing = await prisma.brandPost.findFirst({ where: { brandId: brand.id, title: p.title } });
      if (existing) continue;

      const publishedAt = new Date(Date.now() - p.daysAgo * 24 * 60 * 60 * 1000);
      await prisma.brandPost.create({
        data: {
          brandId: brand.id,
          title: p.title,
          caption: p.caption,
          images: p.images,
          category: p.category,
          taggedProducts: p.taggedProducts,
          status: ContentStatus.PUBLISHED,
          publishedAt,
        },
      });
      createdPosts++;
    }
  }

  console.log(`[seed-discover] Upserted ${createdBrands} brands, created ${createdPosts} new posts.`);
}

main()
  .catch((error) => {
    console.error('[seed-discover] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
