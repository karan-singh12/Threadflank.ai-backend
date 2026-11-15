import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaxonomyKind } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TtlCache } from '../../../common/cache/ttl-cache';
import type { ImportResolver } from '../catalog/catalog-import';

export const slugOf = (v: string) => v.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clean = (v: string) => v.replace(/\s+/g, ' ').trim();

/**
 * The admin-managed lists behind Discover: categories (the pills) and occasions (what a piece is for).
 * Everything else reads them from here, so the app, the brand panel and the API never drift apart.
 */
@Injectable()
export class TaxonomyService {
  /** The Discover pills with their counts: asked on every app open, so computed at most once a minute. */
  private readonly publicCache = new TtlCache<{ id: string; name: string; slug: string; count: number }[]>(60_000, 4);

  constructor(private readonly prisma: PrismaService) {}

  // ── Reading ─────────────────────────────────────────────────────────────

  list(kind: TaxonomyKind, activeOnly = true) {
    return this.prisma.discoverCategory.findMany({
      where: { kind, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** The exact name an admin gave a category, for a value typed in any casing. Null when it is not in the list. */
  private async canonical(kind: TaxonomyKind, value: string): Promise<{ name: string | null; listEmpty: boolean }> {
    const rows = await this.list(kind, true);
    if (rows.length === 0) return { name: null, listEmpty: true };
    const hit = rows.find((r) => r.slug === slugOf(value));
    return { name: hit?.name ?? null, listEmpty: false };
  }

  /**
   * Both lists read once, so a bulk import checks hundreds of rows without a query each.
   * Before any entries exist (fresh install) every value is accepted, as requireCategory does.
   */
  async resolver(): Promise<ImportResolver> {
    const [cats, occs] = await Promise.all([this.list('CATEGORY'), this.list('OCCASION')]);
    const catBySlug = new Map(cats.map((c) => [c.slug, c.name]));
    const occBySlug = new Map(occs.map((o) => [o.slug, o.name]));
    return {
      category: (value) => {
        if (cats.length === 0) return clean(value);
        const hit = catBySlug.get(slugOf(value));
        if (!hit) throw new Error(`Category "${clean(value)}" is not one of: ${cats.map((c) => c.name).join(', ')}.`);
        return hit;
      },
      occasions: (values) => {
        const out: string[] = [];
        for (const v of values) {
          const name = occs.length === 0 ? clean(v) : occBySlug.get(slugOf(v));
          if (!name) throw new Error(`Occasion "${clean(v)}" is not one of: ${occs.map((o) => o.name).join(', ')}.`);
          if (!out.includes(name)) out.push(name);
        }
        return out;
      },
    };
  }

  /** A piece's category must be one of the active categories. Before any exist (fresh install) anything is accepted. */
  async requireCategory(value: string): Promise<string> {
    const { name, listEmpty } = await this.canonical('CATEGORY', value);
    if (listEmpty) return clean(value);
    if (name) return name;
    const all = (await this.list('CATEGORY')).map((r) => r.name).join(', ');
    throw new BadRequestException(`"${clean(value)}" is not one of the categories. Choose one of: ${all}.`);
  }

  async requireOccasions(values: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const v of values) {
      const { name, listEmpty } = await this.canonical('OCCASION', v);
      if (listEmpty) {
        out.push(clean(v));
        continue;
      }
      if (!name) {
        const all = (await this.list('OCCASION')).map((r) => r.name).join(', ');
        throw new BadRequestException(`"${clean(v)}" is not one of the occasions. Choose from: ${all}.`);
      }
      if (!out.includes(name)) out.push(name);
    }
    return out;
  }

  // ── Admin ───────────────────────────────────────────────────────────────

  /** How many pieces use each entry, and the values pieces use that are not in the list yet. */
  async usage(kind: TaxonomyKind) {
    const rows = await this.list(kind, false);
    const used = new Map<string, { value: string; count: number }>();
    if (kind === 'CATEGORY') {
      for (const g of await this.prisma.brandProduct.groupBy({ by: ['category'], _count: { _all: true } })) {
        const key = slugOf(g.category);
        const cur = used.get(key);
        used.set(key, { value: cur?.value ?? g.category, count: (cur?.count ?? 0) + g._count._all });
      }
    } else {
      const raw = await this.prisma.$queryRaw<{ v: string; n: bigint }[]>(Prisma.sql`SELECT unnest("occasions") AS v, count(*) AS n FROM "BrandProduct" GROUP BY 1`);
      for (const r of raw) {
        const key = slugOf(r.v);
        const cur = used.get(key);
        used.set(key, { value: cur?.value ?? r.v, count: (cur?.count ?? 0) + Number(r.n) });
      }
    }
    const listed = new Set(rows.map((r) => r.slug));
    return {
      items: rows.map((r) => ({ ...r, itemCount: used.get(r.slug)?.count ?? 0 })),
      unlisted: [...used.entries()].filter(([slug]) => slug && !listed.has(slug)).map(([, u]) => ({ name: u.value, itemCount: u.count })),
    };
  }

  async create(kind: TaxonomyKind, rawName: string) {
    const name = clean(rawName);
    const slug = slugOf(name);
    if (!slug) throw new BadRequestException('Enter a name with letters or numbers.');
    if (await this.prisma.discoverCategory.findUnique({ where: { kind_slug: { kind, slug } } })) {
      throw new ConflictException(`"${name}" is already in the list.`);
    }
    const last = await this.prisma.discoverCategory.aggregate({ where: { kind }, _max: { sortOrder: true } });
    this.publicCache.clear();
    return this.prisma.discoverCategory.create({ data: { kind, name, slug, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
  }

  /** Renaming also renames it on every piece that uses it, so nothing is left pointing at the old name. */
  async update(id: string, input: { name?: string; isActive?: boolean }) {
    this.publicCache.clear();
    const entry = await this.prisma.discoverCategory.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Not found.');
    const data: Prisma.DiscoverCategoryUpdateInput = {};
    if (input.isActive !== undefined) data.isActive = input.isActive;

    if (input.name !== undefined && clean(input.name) !== entry.name) {
      const name = clean(input.name);
      const slug = slugOf(name);
      if (!slug) throw new BadRequestException('Enter a name with letters or numbers.');
      const clash = await this.prisma.discoverCategory.findUnique({ where: { kind_slug: { kind: entry.kind, slug } } });
      if (clash && clash.id !== id) throw new ConflictException(`"${name}" is already in the list.`);
      data.name = name;
      data.slug = slug;
      await this.prisma.$transaction(async (tx) => {
        if (entry.kind === 'CATEGORY') {
          // Only the distinct spellings in use are looked at (a handful), never every piece.
          const used = await tx.brandProduct.groupBy({ by: ['category'] });
          const spellings = used.map((u) => u.category).filter((c) => slugOf(c) === entry.slug);
          if (spellings.length) await tx.brandProduct.updateMany({ where: { category: { in: spellings } }, data: { category: name } });
        } else {
          await tx.$executeRaw(Prisma.sql`UPDATE "BrandProduct" SET "occasions" = array_replace("occasions", ${entry.name}, ${name}) WHERE ${entry.name} = ANY("occasions")`);
        }
        await tx.discoverCategory.update({ where: { id }, data });
      });
      return this.prisma.discoverCategory.findUniqueOrThrow({ where: { id } });
    }
    return this.prisma.discoverCategory.update({ where: { id }, data });
  }

  /** Puts the given entries in this order (the first gets 0, and so on). */
  async reorder(kind: TaxonomyKind, ids: string[]) {
    const rows = await this.prisma.discoverCategory.findMany({ where: { kind, id: { in: ids } }, select: { id: true } });
    if (rows.length !== ids.length) throw new BadRequestException('Some of those entries do not exist.');
    this.publicCache.clear();
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.discoverCategory.update({ where: { id }, data: { sortOrder: i } })));
    return this.list(kind, false);
  }

  /** Only an unused entry can be deleted; otherwise turn it off so pieces keep their label. */
  async remove(id: string) {
    const entry = await this.prisma.discoverCategory.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Not found.');
    const { items } = await this.usage(entry.kind);
    const n = items.find((i) => i.id === id)?.itemCount ?? 0;
    if (n > 0) throw new ConflictException(`${n} piece${n === 1 ? '' : 's'} still use "${entry.name}". Turn it off instead, or move them first.`);
    await this.prisma.discoverCategory.delete({ where: { id } });
    this.publicCache.clear();
    return { id };
  }

  // ── Shopper side ────────────────────────────────────────────────────────

  /** Active categories in the admin's order with how many live pieces each has, for the Discover pills. */
  /** Called when pieces change, so the pill counts follow the catalog straight away. */
  invalidatePublic() {
    this.publicCache.clear();
  }

  publicCategories() {
    return this.publicCache.get('all', () => this.computePublicCategories());
  }

  private async computePublicCategories() {
    const rows = await this.list('CATEGORY', true);
    const counts = new Map<string, number>();
    const groups = await this.prisma.brandProduct.groupBy({ by: ['category'], where: { status: 'PUBLISHED', brand: { isDeleted: false, status: 'ACTIVE' } }, _count: { _all: true } });
    for (const g of groups) counts.set(slugOf(g.category), (counts.get(slugOf(g.category)) ?? 0) + g._count._all);
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, count: counts.get(r.slug) ?? 0 }));
  }
}
