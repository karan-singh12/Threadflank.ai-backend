import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { fetchPublic } from '../../../common/utils/public-url';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { BrandCatalogService } from './brand-catalog.service';
import { BULK_MAX } from './catalog-page.dto';
import { shopifyRow, storeOrigin, wooRow, type StoreSource, type SyncRow } from './store-sync';

const UA = 'ThreadflankCatalogSync/1.0 (+https://threadflank.com)';

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetchPublic(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('json')) return { ok: false, status: res.status, body: null };
    return { ok: true, status: res.status, body: await res.json() };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/**
 * Imports (or re-syncs) a brand's catalog from its Shopify or WooCommerce store, through the same
 * checks as a CSV import: admin categories, plan limits, and a reason for every row that fails.
 * Pieces are matched by SKU and remember their store and id, so running it again updates them.
 */
@Injectable()
export class StoreSyncService {
  private readonly logger = new Logger(StoreSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxonomy: TaxonomyService,
    private readonly catalog: BrandCatalogService,
  ) {}

  /** Which platform a store runs on, by asking each public feed for one product. */
  private async detect(origin: string): Promise<StoreSource> {
    const shopify = await getJson(`${origin}/products.json?limit=1`);
    if (shopify.ok && Array.isArray((shopify.body as { products?: unknown })?.products)) return 'SHOPIFY';
    const woo = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=1`);
    if (woo.ok && Array.isArray(woo.body)) return 'WOOCOMMERCE';
    throw new BadRequestException("We couldn't read products from that store. Shopify and WooCommerce stores work here; for anything else, use CSV import.");
  }

  async sync(brandId: string, input: { url: string; category: string; status?: 'DRAFT' | 'PUBLISHED' }) {
    let origin: string;
    try {
      origin = storeOrigin(input.url);
    } catch {
      throw new BadRequestException('Paste your store address, like yourbrand.com or yourbrand.myshopify.com.');
    }
    // The fallback category must be a real one; the store's own types are used when they match.
    const fallback = await this.taxonomy.requireCategory(input.category);
    const resolver = await this.taxonomy.resolver();
    const pick = (storeType: string | undefined) => {
      if (!storeType?.trim()) return fallback;
      try {
        return resolver.category(storeType);
      } catch {
        return fallback;
      }
    };
    const status = input.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';
    const source = await this.detect(origin);

    const rows: SyncRow[] = [];
    if (source === 'SHOPIFY') {
      for (let page = 1; rows.length < BULK_MAX && page <= 4; page++) {
        const r = await getJson(`${origin}/products.json?limit=250&page=${page}`);
        const products = (r.body as { products?: Parameters<typeof shopifyRow>[0][] })?.products ?? [];
        if (!r.ok || products.length === 0) break;
        rows.push(...products.map((p) => shopifyRow(p, origin, pick, status)));
        if (products.length < 250) break;
      }
    } else {
      for (let page = 1; rows.length < BULK_MAX && page <= 5; page++) {
        const r = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
        const products = Array.isArray(r.body) ? (r.body as Parameters<typeof wooRow>[0][]) : [];
        if (!r.ok || products.length === 0) break;
        rows.push(...products.map((p) => wooRow(p, pick, status)));
        if (products.length < 100) break;
      }
    }
    if (rows.length === 0) throw new BadRequestException('That store has no public products yet.');

    const batch = rows.slice(0, BULK_MAX);
    const result = await this.catalog.importItems(brandId, {
      items: batch.map(({ externalId: _id, ...row }) => {
        void _id;
        return row;
      }),
      updateExisting: true,
    });

    // Remember where each piece came from, so the next sync is an update and the brand can see the source.
    const now = new Date();
    const tags = batch.map((r) => this.prisma.brandProduct.updateMany({ where: { brandId, sku: r.sku }, data: { externalSource: source, externalId: r.externalId, syncedAt: now } }));
    for (let i = 0; i < tags.length; i += 50) await this.prisma.$transaction(tags.slice(i, i + 50));

    this.logger.log(`Store sync for ${brandId} from ${origin} (${source}): ${result.created} new, ${result.updated} updated, ${result.failed} failed`);
    return { source, store: origin, found: rows.length, truncated: rows.length > BULK_MAX, ...result };
  }
}
