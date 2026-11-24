import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreLayoutService } from './store-layout.service';
import { defaultLayout, normaliseLayout, readLayout, slugProblem, toSlug, type StoreLayout } from './store-layout';

/** Where shoppers reach a store. Set USER_APP_URL in each environment; production is the default. */
export const userAppUrl = () => (process.env.USER_APP_URL?.trim() || 'https://threadflank.com').replace(/\/+$/, '');

const KEEP_OLD_SLUGS = 5;

/**
 * The brand's own side of the Store Builder. Edits go to a draft; shoppers keep seeing the
 * published layout until the brand presses Publish, and Discard throws the draft away.
 */
@Injectable()
export class StoreBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly layouts: StoreLayoutService,
  ) {}

  private async brand(brandId: string) {
    const b = await this.prisma.brand.findFirst({
      where: { id: brandId, isDeleted: false },
      select: { id: true, slug: true, previousSlugs: true, storeDraft: true, storeLayout: true, storePublishedAt: true },
    });
    if (!b) throw new NotFoundException('Brand not found.');
    return b;
  }

  /** Everything the builder opens with. The draft falls back to the published layout, then to the default. */
  async get(brandId: string) {
    const b = await this.brand(brandId);
    const published = readLayout(b.storeLayout);
    const draft = readLayout(b.storeDraft);
    return {
      draft: draft ?? published ?? defaultLayout(),
      published,
      publishedAt: b.storePublishedAt?.toISOString() ?? null,
      hasUnpublishedChanges: Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(published),
      slug: b.slug,
      previousSlugs: b.previousSlugs,
      storeUrl: `${userAppUrl()}/brands/${b.slug}`,
      shortUrl: `${userAppUrl()}/${b.slug}`,
    };
  }

  async saveDraft(brandId: string, input: unknown) {
    const layout = normaliseLayout(input);
    await this.brand(brandId);
    // Only this brand's own pieces and videos can be put on its page.
    if (layout.pinned.length) {
      const own = await this.prisma.brandProduct.findMany({ where: { brandId, id: { in: layout.pinned } }, select: { id: true } });
      const ok = new Set(own.map((o) => o.id));
      layout.pinned = layout.pinned.filter((id) => ok.has(id));
    }
    const videoIds = [...new Set(layout.sections.flatMap((s) => s.videoIds ?? []))];
    if (videoIds.length) {
      const [reels, clips] = await Promise.all([
        this.prisma.brandReel.findMany({ where: { brandId, id: { in: videoIds } }, select: { id: true } }),
        this.prisma.brandVideo.findMany({ where: { brandId, id: { in: videoIds } }, select: { id: true } }),
      ]);
      const ok = new Set([...reels, ...clips].map((v) => v.id));
      for (const s of layout.sections) if (s.videoIds) s.videoIds = s.videoIds.filter((id) => ok.has(id));
    }
    await this.prisma.brand.update({ where: { id: brandId }, data: { storeDraft: layout as unknown as Prisma.InputJsonValue } });
    return this.get(brandId);
  }

  /** Makes the draft what shoppers see. Publishing with no draft publishes the default layout the first time. */
  async publish(brandId: string) {
    const b = await this.brand(brandId);
    const draft = readLayout(b.storeDraft);
    const published = readLayout(b.storeLayout);
    const next: StoreLayout | null = draft ?? (published ? null : defaultLayout());
    if (!next) throw new BadRequestException('There are no unpublished changes.');
    await this.prisma.brand.update({
      where: { id: brandId },
      data: { storeLayout: next as unknown as Prisma.InputJsonValue, storeDraft: Prisma.DbNull, storePublishedAt: new Date() },
    });
    return this.get(brandId);
  }

  async discard(brandId: string) {
    await this.brand(brandId);
    await this.prisma.brand.update({ where: { id: brandId }, data: { storeDraft: Prisma.DbNull } });
    return this.get(brandId);
  }

  /** The draft (with hidden sections, marked) or the published layout, resolved exactly as shoppers would get it. */
  async preview(brandId: string, which: 'draft' | 'published') {
    const b = await this.brand(brandId);
    const published = readLayout(b.storeLayout);
    const layout = which === 'published' ? published ?? defaultLayout() : readLayout(b.storeDraft) ?? published ?? defaultLayout();
    return this.layouts.resolve(brandId, layout, { includeHidden: which === 'draft' });
  }

  /**
   * Changes the store's URL. The old one keeps working (it is remembered for redirects), up to the
   * last five, so links a brand already shared don't break.
   */
  async changeSlug(brandId: string, raw: string) {
    const slug = toSlug(raw);
    const problem = slugProblem(slug);
    if (problem) throw new BadRequestException(problem);
    const b = await this.brand(brandId);
    if (slug === b.slug) return this.get(brandId);

    const taken = await this.prisma.brand.findFirst({ where: { id: { not: brandId }, OR: [{ slug }, { previousSlugs: { has: slug } }] }, select: { id: true } });
    if (taken) throw new ConflictException(`threadflank.com/${slug} is taken. Try another.`);

    const previousSlugs = [b.slug, ...b.previousSlugs.filter((s) => s !== slug && s !== b.slug)].slice(0, KEEP_OLD_SLUGS);
    try {
      await this.prisma.brand.update({ where: { id: brandId }, data: { slug, previousSlugs } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`threadflank.com/${slug} was just taken. Try another.`);
      throw e;
    }
    return this.get(brandId);
  }
}
