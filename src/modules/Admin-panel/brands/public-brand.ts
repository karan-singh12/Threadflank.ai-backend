/**
 * Brand.socialLinks is a grab-bag: links the brand shows shoppers, but also private account data
 * (work email, AI credit balance, rank score, the admin's verification decision). Anything sent to a
 * shopper goes through this allow-list, so a new private key can never leak by default.
 */
const PUBLIC_KEYS = [
  'instagram',
  'facebook',
  'twitter',
  'youtube',
  'tiktok',
  'pinterest',
  'website',
  'banner',
  'announcementText',
  'themeAccent',
  'flagshipAddress',
  'isOnlineOnly',
] as const;

export function publicSocialLinks(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_KEYS) {
    const v = source[key];
    if (v !== undefined && v !== null && v !== '') out[key] = v;
  }
  return out;
}

/** The fields of a Brand a shopper may see. Use as `select` and pass the result through toPublicBrand. */
export const PUBLIC_BRAND_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  description: true,
  category: true,
  websiteUrl: true,
  isVerified: true,
  socialLinks: true,
} as const;

export function toPublicBrand<T extends { socialLinks?: unknown }>(brand: T) {
  return { ...brand, socialLinks: publicSocialLinks(brand.socialLinks) };
}
