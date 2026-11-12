/**
 * Builds catalog items from what a brand's admin-added posts already say. Used two ways:
 *  - live, as a fallback so a brand with no catalog rows yet still shows its pieces to shoppers;
 *  - by prisma/backfill-brand-catalog.ts, which saves the same items as real catalog rows and carries
 *    over everything a post held (caption, status, shares, likes, comments).
 * Nothing is invented. Structured product details win; a post with none becomes one "look" item named
 * from its caption, with the price left at 0 ("not set").
 */
export interface PostVariantLike {
  productName: string;
  size: string;
  color: string;
  price: number | null;
  inStock: boolean;
  stockCount: number | null;
  productUrl: string | null;
  imageUrl: string | null;
}

export type PostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED';

export interface PostLike {
  id: string;
  title: string | null;
  caption: string | null;
  images: unknown;
  category: string | null;
  taggedProducts: unknown;
  variants: PostVariantLike[];
  // Carried over by the migration; optional so the live fallback only needs what it shows.
  status?: PostStatus;
  scheduledAt?: Date | null;
  publishedAt?: Date | null;
  sharesCount?: number;
  createdAt?: Date;
}

export interface BrandLike {
  id: string;
  name: string;
  category: string | null;
  websiteUrl: string | null;
  posts: PostLike[];
}

export interface CatalogCandidate {
  brandId: string;
  brandName: string;
  /** The post it came from, and whether it is the first piece of that post (it inherits the post's likes and comments). */
  postId: string;
  firstOfPost: boolean;
  sku: string;
  title: string;
  description: string | null;
  status: PostStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  sharesCount: number;
  createdAt: Date | null;
  price: number;
  images: string[];
  category: string;
  sizes: string[];
  colors: string[];
  stock: number;
  buyUrl: string;
  /** Look photos show a person wearing the piece, so they are not offered for try-on until the brand says so. */
  isDrapeReady: boolean;
}

export interface SkippedItem {
  brand: string;
  item: string;
  why: string;
}

export const isHttps = (v?: string | null) => !!v && /^https:\/\/\S+$/i.test(v.trim());
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 14);

const priceOf = (raw: unknown): number => {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** A readable name from the post itself: its title, else the caption's first sentence. */
export const lookTitle = (title: string | null, caption: string | null): string => {
  const raw = (title && title.trim()) || (caption ?? '').trim().split(/(?<=[.!?])\s/)[0] || '';
  const clean = raw.replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();
  if (clean.length <= 80) return clean;
  return clean.slice(0, 80).replace(/\s+\S*$/, '') + '…';
};

const imagesOf = (images: unknown): string[] =>
  Array.isArray(images) ? (images as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

export function candidatesFromBrand(brand: BrandLike): { candidates: CatalogCandidate[]; skipped: SkippedItem[] } {
  const candidates: CatalogCandidate[] = [];
  const skipped: SkippedItem[] = [];
  const fallbackUrl = isHttps(brand.websiteUrl) ? brand.websiteUrl!.trim() : '';

  for (const post of brand.posts) {
    const category = post.category || brand.category || 'Fashion';
    const photos = imagesOf(post.images);
    const postImage = photos[0] ?? '';
    const tagged = Array.isArray(post.taggedProducts) ? (post.taggedProducts as { name?: string; price?: unknown; thumbnail?: string }[]) : [];
    const hasDetails = post.variants.length > 0 || tagged.length > 0;
    const caption = (post.caption ?? '').trim() || null;
    // What every piece made from this post carries over from it.
    const fromPost = {
      brandId: brand.id,
      brandName: brand.name,
      postId: post.id,
      description: caption,
      status: post.status ?? ('PUBLISHED' as PostStatus),
      scheduledAt: post.scheduledAt ?? null,
      publishedAt: post.publishedAt ?? null,
      sharesCount: post.sharesCount ?? 0,
      createdAt: post.createdAt ?? null,
    };
    const made = () => candidates.filter((c) => c.postId === post.id).length;

    if (!hasDetails) {
      const title = lookTitle(post.title, post.caption);
      const why = !title ? 'no caption to name it' : photos.length === 0 ? 'no photo' : '';
      if (why) {
        skipped.push({ brand: brand.name, item: post.id, why });
        continue;
      }
      candidates.push({ ...fromPost, firstOfPost: made() === 0, sku: `P-${post.id.slice(-8)}-look`, title, price: 0, images: photos, category, sizes: [], colors: [], stock: 1, buyUrl: fallbackUrl, isDrapeReady: false });
      continue;
    }

    if (post.variants.length > 0) {
      // One product per name, with its real sizes, colours and stock.
      const groups = new Map<string, PostVariantLike[]>();
      for (const v of post.variants) groups.set(v.productName, [...(groups.get(v.productName) ?? []), v]);
      for (const [name, vs] of groups) {
        const price = Math.min(...vs.map((v) => v.price ?? Infinity));
        const buyUrl = vs.map((v) => v.productUrl).find(isHttps) || fallbackUrl;
        const image = vs.map((v) => v.imageUrl).find(Boolean) || postImage;
        const why = !Number.isFinite(price) || price <= 0 ? 'no price' : !image ? 'no photo' : '';
        if (why) {
          skipped.push({ brand: brand.name, item: name, why });
          continue;
        }
        const known = vs.every((v) => v.stockCount !== null && v.stockCount !== undefined);
        candidates.push({
          ...fromPost,
          firstOfPost: made() === 0,
          sku: `P-${post.id.slice(-8)}-${slug(name)}`,
          title: name,
          price,
          images: [...new Set([...vs.map((v) => v.imageUrl).filter((x): x is string => !!x), postImage].filter(Boolean))],
          category,
          sizes: [...new Set(vs.map((v) => v.size).filter(Boolean))],
          colors: [...new Set(vs.map((v) => v.color).filter(Boolean))],
          // Real counts when the brand gave them; otherwise 1 for "in stock", 0 for "out".
          stock: known ? vs.reduce((n, v) => n + (v.inStock ? (v.stockCount as number) : 0), 0) : vs.some((v) => v.inStock) ? 1 : 0,
          buyUrl,
          isDrapeReady: true,
        });
      }
      continue;
    }

    for (const t of tagged) {
      const name = (t.name ?? '').trim();
      if (!name) continue;
      const price = priceOf(t.price);
      const image = t.thumbnail || postImage;
      const why = price <= 0 ? 'no price' : !image ? 'no photo' : '';
      if (why) {
        skipped.push({ brand: brand.name, item: name, why });
        continue;
      }
      candidates.push({ ...fromPost, firstOfPost: made() === 0, sku: `P-${post.id.slice(-8)}-${slug(name)}`, title: name, price, images: [image], category, sizes: [], colors: [], stock: 1, buyUrl: fallbackUrl, isDrapeReady: true });
    }
  }
  return { candidates, skipped };
}
