export interface UtmContext {
  /** Used as utm_campaign when there is no collection or campaign of its own. */
  brandSlug: string;
  /** utm_content: which piece the shopper bought from. SKU reads better in a brand's analytics than an id. */
  sku?: string | null;
  productId: string;
  collection?: string | null;
  /** A ThreadFlank campaign or a creator collab that sent the shopper, when there is one. */
  campaign?: string | null;
}

const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/**
 * The brand's buy link with UTM tags, so the click-out shows up in the brand's own Google Analytics
 * (or any analytics that reads UTMs) as coming from ThreadFlank, per piece and collection.
 *
 * A link that already carries a utm_source is left exactly as the brand wrote it: they set up their
 * own tracking and ours must not overwrite it. Links we cannot parse, or that are not http(s), are
 * returned unchanged rather than mangled.
 */
export function withUtm(buyUrl: string, ctx: UtmContext): string {
  let url: URL;
  try {
    url = new URL(buyUrl.trim());
  } catch {
    return buyUrl;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return buyUrl;
  if (url.searchParams.has('utm_source')) return buyUrl;

  const campaign = (ctx.campaign && slug(ctx.campaign)) || (ctx.collection && slug(ctx.collection)) || slug(ctx.brandSlug) || 'store';
  url.searchParams.set('utm_source', 'threadflank');
  url.searchParams.set('utm_medium', 'referral');
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', (ctx.sku && ctx.sku.trim().slice(0, 64)) || ctx.productId);
  return url.toString();
}
