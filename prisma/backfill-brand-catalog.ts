import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { candidatesFromBrand, type CatalogCandidate, type SkippedItem } from '../src/modules/Brand-panel/catalog/post-catalog';

/**
 * Moves everything the old posts held into the catalog (BrandProduct), so a catalog item IS the post:
 * its name and photos, caption (description), status and dates, shares, likes and comments.
 *
 *   npm run backfill:catalog            # dry run: prints what would change, writes nothing
 *   npm run backfill:catalog -- --apply # does it
 *
 * Safe to run again:
 *  - a piece is identified by (brand, sku); a new one is created, an existing one is only FILLED: fields that
 *    are still empty get the post's value, anything the brand already set or edited is left alone;
 *  - likes are added only if missing; comments are copied only when the piece has none yet.
 * The rules for turning a post into pieces live in src/modules/Brand-panel/catalog/post-catalog.ts.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const APPLY = process.argv.includes('--apply');

async function main() {
  const brands = await prisma.brand.findMany({
    where: { isDeleted: false },
    select: {
      id: true,
      name: true,
      category: true,
      websiteUrl: true,
      posts: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, caption: true, images: true, category: true, taggedProducts: true, variants: true, status: true, scheduledAt: true, publishedAt: true, sharesCount: true, createdAt: true },
      },
    },
  });

  const candidates: CatalogCandidate[] = [];
  const skipped: SkippedItem[] = [];
  for (const brand of brands) {
    const r = candidatesFromBrand(brand);
    candidates.push(...r.candidates);
    skipped.push(...r.skipped);
  }

  const existingRows = await prisma.brandProduct.findMany({
    select: { id: true, brandId: true, sku: true, description: true, publishedAt: true, sharesCount: true, sourcePostId: true, _count: { select: { comments: true } } },
  });
  const existing = new Map(existingRows.map((p) => [`${p.brandId}|${p.sku}`, p]));
  const fresh = candidates.filter((c) => !existing.has(`${c.brandId}|${c.sku}`));
  const known = candidates.filter((c) => existing.has(`${c.brandId}|${c.sku}`));

  // Likes and comments belong to the post's first piece.
  const firstPieces = candidates.filter((c) => c.firstOfPost);
  const postIds = firstPieces.map((c) => c.postId);
  const [likes, comments] = await Promise.all([
    prisma.brandPostLike.findMany({ where: { postId: { in: postIds } }, select: { postId: true, userId: true, createdAt: true } }),
    prisma.brandPostComment.findMany({ where: { postId: { in: postIds } }, select: { postId: true, userId: true, content: true, createdAt: true } }),
  ]);

  console.log(`\nBrands scanned: ${brands.length}`);
  console.log(`Pieces found in posts: ${candidates.length} (new: ${fresh.length}, already in catalog: ${known.length})`);
  console.log(`Skipped (missing real data): ${skipped.length}`);
  for (const s of skipped) console.log(`  - ${s.brand}: "${s.item}" -> ${s.why}`);
  console.log(`Post likes to carry over: ${likes.length}   Post comments to carry over: ${comments.length}`);
  console.log('\nNew catalog rows:');
  for (const c of fresh) console.log(`  + ${c.brandName}: ${c.title} | ${c.status} | ${c.price > 0 ? '₹' + c.price : 'price not set'} | ${c.category} | ${c.buyUrl || '(no store link yet)'}`);
  console.log(`\nExisting rows that will be filled from their post: ${known.filter((c) => { const e = existing.get(`${c.brandId}|${c.sku}`)!; return (!e.sourcePostId && c.firstOfPost) || (!e.description && c.description) || (!e.publishedAt && c.publishedAt) || (e.sharesCount === 0 && c.sharesCount > 0); }).length}`);

  if (!APPLY) {
    console.log('\nDry run only. Nothing was written. Run with --apply to do this.');
    return;
  }

  let created = 0;
  let filled = 0;
  const productIdByPost = new Map<string, string>();

  for (const c of candidates) {
    const key = `${c.brandId}|${c.sku}`;
    const row = existing.get(key);
    if (!row) {
      const made = await prisma.brandProduct.create({
        data: {
          brandId: c.brandId,
          title: c.title,
          sku: c.sku,
          price: c.price,
          images: c.images,
          category: c.category,
          sizes: c.sizes,
          colors: c.colors,
          stock: c.stock,
          isDrapeReady: c.isDrapeReady && c.images.length > 0,
          buyUrl: c.buyUrl,
          newDrop: false,
          description: c.description,
          status: c.status,
          scheduledAt: c.scheduledAt,
          publishedAt: c.publishedAt,
          sharesCount: c.sharesCount,
          ...(c.firstOfPost ? { sourcePostId: c.postId } : {}),
          ...(c.createdAt ? { createdAt: c.createdAt } : {}),
        },
      });
      created++;
      if (c.firstOfPost) productIdByPost.set(c.postId, made.id);
      continue;
    }
    // Existing piece: fill only what is still empty.
    const data: Record<string, unknown> = {};
    if (!row.sourcePostId && c.firstOfPost) data.sourcePostId = c.postId;
    if (!row.description && c.description) data.description = c.description;
    if (!row.publishedAt && c.publishedAt) data.publishedAt = c.publishedAt;
    if (row.sharesCount === 0 && c.sharesCount > 0) data.sharesCount = c.sharesCount;
    if (Object.keys(data).length > 0) {
      await prisma.brandProduct.update({ where: { id: row.id }, data });
      filled++;
    }
    if (c.firstOfPost) productIdByPost.set(c.postId, row.id);
  }

  let likesCopied = 0;
  for (const l of likes) {
    const productId = productIdByPost.get(l.postId);
    if (!productId) continue;
    const { count } = await prisma.brandProductLike.createMany({ data: [{ productId, userId: l.userId, createdAt: l.createdAt }], skipDuplicates: true });
    likesCopied += count;
  }

  let commentsCopied = 0;
  for (const [postId, productId] of productIdByPost) {
    const mine = comments.filter((c) => c.postId === postId);
    if (mine.length === 0) continue;
    const already = await prisma.brandProductComment.count({ where: { productId } });
    if (already > 0) continue;
    const { count } = await prisma.brandProductComment.createMany({ data: mine.map((c) => ({ productId, userId: c.userId, content: c.content, createdAt: c.createdAt })) });
    commentsCopied += count;
  }

  console.log(`\nCreated ${created} catalog rows, filled ${filled} existing rows, copied ${likesCopied} likes and ${commentsCopied} comments.`);
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
