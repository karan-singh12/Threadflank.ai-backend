import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BrandDropsService } from '../drops/brand-drops.service';
import { WITH_COUNTS, toPublicProduct, type PublicProduct } from '../catalog/brand-catalog.service';
import { DEFAULT_LIMIT, DEFAULT_TITLES, StoreLayout, StoreSection, type SectionType } from './store-layout';

export interface StoreVideo {
  id: string;
  kind: 'reel' | 'clip';
  url: string;
  title: string;
  aspectRatio: string;
  poster?: string;
}

export interface ResolvedSection {
  id: string;
  type: SectionType;
  title: string;
  hidden: boolean;
  products?: PublicProduct[];
  drops?: Awaited<ReturnType<BrandDropsService['listPublic']>>;
  videos?: StoreVideo[];
  /** Nothing to show right now. Shoppers never see an empty section; the brand's preview says why. */
  empty: boolean;
}

const LIVE = { status: 'PUBLISHED' } as const;

/**
 * Turns a layout into what a store page shows: real, live pieces, drops and videos. The shopper
 * store and the brand's preview both come through here, so the preview is exactly the store.
 */
@Injectable()
export class StoreLayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drops: BrandDropsService,
  ) {}

  async resolve(brandId: string, layout: StoreLayout, opts: { userId?: string; includeHidden?: boolean } = {}): Promise<{ sections: ResolvedSection[]; coverVideo?: string }> {
    const wanted = layout.sections.filter((s) => opts.includeHidden || !s.hidden);
    // Pinned pieces always open the store, unless the brand placed a Pinned section somewhere itself.
    const sections: StoreSection[] = layout.pinned.length && !wanted.some((s) => s.type === 'pinned') ? [{ id: 'pinned', type: 'pinned' }, ...wanted] : wanted;

    const resolved = await Promise.all(sections.map((s) => this.one(brandId, layout, s, opts.userId)));
    await this.markLiked(resolved, opts.userId);
    return { sections: resolved, ...(layout.coverVideo ? { coverVideo: layout.coverVideo } : {}) };
  }

  private async one(brandId: string, layout: StoreLayout, s: StoreSection, userId?: string): Promise<ResolvedSection> {
    const base = { id: s.id, type: s.type, title: s.title || this.defaultTitle(s), hidden: Boolean(s.hidden) };
    const take = s.limit ?? DEFAULT_LIMIT;

    if (s.type === 'launches') {
      const drops = await this.drops.listPublic(brandId, userId);
      return { ...base, drops, empty: drops.length === 0 };
    }
    if (s.type === 'videos') {
      const videos = await this.videos(brandId, s.videoIds ?? []);
      return { ...base, videos, empty: videos.length === 0 };
    }
    if (s.type === 'pinned') {
      if (layout.pinned.length === 0) return { ...base, products: [], empty: true };
      const rows = await this.prisma.brandProduct.findMany({ where: { brandId, ...LIVE, id: { in: layout.pinned } }, include: WITH_COUNTS });
      const byId = new Map(rows.map((r) => [r.id, r]));
      // Kept in the brand's pinned order; a pinned piece that went to draft simply drops out.
      const products = layout.pinned.map((id) => byId.get(id)).filter((r): r is (typeof rows)[number] => Boolean(r)).map(toPublicProduct);
      return { ...base, products, empty: products.length === 0 };
    }

    const where: Prisma.BrandProductWhereInput = { brandId, ...LIVE };
    let orderBy: Prisma.BrandProductOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];
    if (s.type === 'featured') where.featured = true;
    if (s.type === 'bestsellers') orderBy = [{ drapesCount: 'desc' }, { clicksCount: 'desc' }, { id: 'desc' }];
    if (s.type === 'new_arrivals') orderBy = [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
    if (s.type === 'collection') where.collection = { equals: s.collection, mode: 'insensitive' };
    if (s.type === 'occasion') where.occasions = { has: s.occasion };
    if (s.type === 'category') where.category = { equals: s.category, mode: 'insensitive' };
    const rows = await this.prisma.brandProduct.findMany({ where, orderBy, take, include: WITH_COUNTS });
    const products = rows.map(toPublicProduct);
    return { ...base, products, empty: products.length === 0 };
  }

  private defaultTitle(s: StoreSection) {
    if (s.type === 'collection' && s.collection) return s.collection;
    if (s.type === 'occasion' && s.occasion) return `${s.occasion} edit`;
    if (s.type === 'category' && s.category) return s.category;
    return DEFAULT_TITLES[s.type];
  }

  /** Finished reels and clips, either the ones the brand picked (in its order) or the newest four. */
  async videos(brandId: string, ids: string[]): Promise<StoreVideo[]> {
    const pick = ids.length ? { id: { in: ids } } : {};
    const [reels, clips] = await Promise.all([
      this.prisma.brandReel.findMany({ where: { brandId, status: 'READY', videoUrl: { not: null }, ...pick }, orderBy: { createdAt: 'desc' }, take: ids.length || 4 }),
      this.prisma.brandVideo.findMany({ where: { brandId, status: 'READY', videoUrl: { not: null }, ...pick }, orderBy: { createdAt: 'desc' }, take: ids.length || 4 }),
    ]);
    const all: StoreVideo[] = [
      ...reels.map((r) => ({ id: r.id, kind: 'reel' as const, url: r.videoUrl!, title: r.title, aspectRatio: r.aspectRatio })),
      ...clips.map((c) => ({ id: c.id, kind: 'clip' as const, url: c.videoUrl!, title: 'Motion clip', aspectRatio: c.aspectRatio, poster: c.sourceImageUrl })),
    ];
    if (ids.length) return ids.map((id) => all.find((v) => v.id === id)).filter((v): v is StoreVideo => Boolean(v));
    return all.slice(0, 4);
  }

  /** One query for every piece on the page, instead of one per section. */
  private async markLiked(sections: ResolvedSection[], userId?: string) {
    if (!userId) return;
    const ids = [...new Set(sections.flatMap((s) => s.products?.map((p) => p.id) ?? []))];
    if (ids.length === 0) return;
    const liked = new Set((await this.prisma.brandProductLike.findMany({ where: { userId, productId: { in: ids } }, select: { productId: true } })).map((l) => l.productId));
    for (const s of sections) for (const p of s.products ?? []) p.likedByMe = liked.has(p.id);
  }
}
