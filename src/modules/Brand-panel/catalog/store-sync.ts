import { MAX_IMAGES } from './catalog-import';

/**
 * Turning a Shopify or WooCommerce store's public product feed into catalog import rows.
 * Pure functions, so the mapping can be tested without a network.
 *
 *   Shopify:      https://<store>/products.json?limit=250&page=N         (public on every Shopify store)
 *   WooCommerce:  https://<store>/wp-json/wc/store/v1/products?per_page=100&page=N   (the Store API, public)
 */

export type StoreSource = 'SHOPIFY' | 'WOOCOMMERCE';

/**
 * Public feeds say whether a piece is available, not how many are left. An available piece is
 * recorded with this many so it reads "In stock" (never a made-up "Only 2 left"); the brand can
 * set real numbers in the catalog.
 */
export const AVAILABLE_STOCK = 25;

/** One row in the same shape the CSV import reads, plus where it came from. */
export type SyncRow = {
  externalId: string;
  sku: string;
  title: string;
  price: string;
  originalPrice?: string;
  category: string;
  description?: string;
  images?: string;
  sizes?: string;
  colors?: string;
  stock: string;
  buyUrl?: string;
  status: string;
};

const stripHtml = (html: string | null | undefined) =>
  (html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);

const httpsOnly = (urls: (string | undefined | null)[]) =>
  urls
    .filter((u): u is string => Boolean(u))
    .map((u) => (u.startsWith('//') ? `https:${u}` : u))
    .filter((u) => u.startsWith('https://'))
    .slice(0, MAX_IMAGES);

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].slice(0, 30).map((x) => x.slice(0, 40));
const isSize = (name: string) => /^(size|sizes|taille)$/i.test(name.trim());
const isColour = (name: string) => /^(colou?rs?|shade)$/i.test(name.trim());

/** The store's own type when it is one of ours, else the brand's chosen fallback. */
export type CategoryPick = (storeType: string | undefined) => string;

// ── Shopify ──────────────────────────────────────────────────────────────

type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  body_html?: string | null;
  product_type?: string;
  images?: { src: string }[];
  options?: { name: string; values: string[] }[];
  variants?: { sku?: string | null; price?: string; compare_at_price?: string | null; available?: boolean }[];
};

export function shopifyRow(p: ShopifyProduct, origin: string, pick: CategoryPick, status: 'DRAFT' | 'PUBLISHED'): SyncRow {
  const variants = p.variants ?? [];
  const prices = variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
  const price = prices.length ? Math.min(...prices) : 0;
  const compare = variants.map((v) => Number(v.compare_at_price)).filter((n) => Number.isFinite(n) && n > price);
  const available = variants.some((v) => v.available !== false);
  const opts = p.options ?? [];
  return {
    externalId: String(p.id),
    sku: (variants.find((v) => v.sku)?.sku || `shopify-${p.id}`).slice(0, 60),
    title: p.title.slice(0, 200),
    price: String(price),
    ...(compare.length ? { originalPrice: String(Math.max(...compare)) } : {}),
    category: pick(p.product_type),
    description: stripHtml(p.body_html) || undefined,
    images: httpsOnly((p.images ?? []).map((i) => i.src)).join('|') || undefined,
    sizes: uniq(opts.filter((o) => isSize(o.name)).flatMap((o) => o.values)).join('|') || undefined,
    colors: uniq(opts.filter((o) => isColour(o.name)).flatMap((o) => o.values)).join('|') || undefined,
    stock: String(available ? AVAILABLE_STOCK : 0),
    buyUrl: `${origin}/products/${encodeURIComponent(p.handle)}`,
    status,
  };
}

// ── WooCommerce (Store API) ──────────────────────────────────────────────

type WooProduct = {
  id: number;
  name: string;
  sku?: string;
  permalink?: string;
  description?: string;
  short_description?: string;
  prices?: { price?: string; regular_price?: string; currency_minor_unit?: number };
  images?: { src: string }[];
  categories?: { name: string }[];
  attributes?: { name: string; terms?: { name: string }[] }[];
  is_in_stock?: boolean;
};

export function wooRow(p: WooProduct, pick: CategoryPick, status: 'DRAFT' | 'PUBLISHED'): SyncRow {
  const unit = 10 ** (p.prices?.currency_minor_unit ?? 2);
  const price = Number(p.prices?.price ?? 0) / unit;
  const regular = Number(p.prices?.regular_price ?? 0) / unit;
  const attrs = p.attributes ?? [];
  const storeType = (p.categories ?? []).map((c) => c.name).find((name) => pick(name) !== pick(undefined)) ?? p.categories?.[0]?.name;
  return {
    externalId: String(p.id),
    sku: (p.sku || `woo-${p.id}`).slice(0, 60),
    title: stripHtml(p.name).slice(0, 200),
    price: String(price > 0 ? price : regular),
    ...(regular > price && price > 0 ? { originalPrice: String(regular) } : {}),
    category: pick(storeType),
    description: stripHtml(p.description || p.short_description) || undefined,
    images: httpsOnly((p.images ?? []).map((i) => i.src)).join('|') || undefined,
    sizes: uniq(attrs.filter((a) => isSize(a.name)).flatMap((a) => (a.terms ?? []).map((t) => t.name))).join('|') || undefined,
    colors: uniq(attrs.filter((a) => isColour(a.name)).flatMap((a) => (a.terms ?? []).map((t) => t.name))).join('|') || undefined,
    stock: String(p.is_in_stock === false ? 0 : AVAILABLE_STOCK),
    buyUrl: p.permalink?.startsWith('https://') ? p.permalink : undefined,
    status,
  };
}

/** "shop.example.com/collections/x" → "https://shop.example.com". */
export function storeOrigin(input: string): string {
  const withScheme = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const u = new URL(withScheme);
  return `https://${u.host}`;
}
