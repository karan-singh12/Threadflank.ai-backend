import { BadRequestException } from '@nestjs/common';

/**
 * Store Builder data: the sections a brand arranges on its store page, in order. Stored as JSON on
 * Brand (storeDraft while editing, storeLayout once published) and resolved into real pieces,
 * drops and videos only when a page is served, so a section never shows a stale snapshot.
 */

export const SECTION_TYPES = ['pinned', 'featured', 'new_arrivals', 'bestsellers', 'collection', 'occasion', 'category', 'launches', 'videos'] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export interface StoreSection {
  id: string;
  type: SectionType;
  /** Shown above the section. Empty uses the default title for the type. */
  title?: string;
  /** For type "collection": the brand's collection name. */
  collection?: string;
  /** For type "occasion": e.g. "Mehendi". */
  occasion?: string;
  /** For type "category": e.g. "Lehenga". */
  category?: string;
  /** For type "videos": which reels or clips, in order. Empty shows the newest. */
  videoIds?: string[];
  /** How many pieces to show (4 to 24). */
  limit?: number;
  /** Kept in the layout but not shown. */
  hidden?: boolean;
}

export interface StoreLayout {
  version: 1;
  sections: StoreSection[];
  /** Pieces pinned to the top of the store, in order. */
  pinned: string[];
  /** A looping video at the top of the store instead of the banner photo. */
  coverVideo?: string;
}

export const MAX_SECTIONS = 12;
export const MAX_PINNED = 8;
export const MAX_VIDEOS = 6;
export const DEFAULT_LIMIT = 8;

export const DEFAULT_TITLES: Record<SectionType, string> = {
  pinned: 'Pinned',
  featured: 'Featured',
  new_arrivals: 'New arrivals',
  bestsellers: 'Bestsellers',
  collection: 'Collection',
  occasion: 'Occasion edit',
  category: 'Shop by category',
  launches: 'Launches',
  videos: 'Launch videos',
};

/** What a brand starts from: close to the page shoppers already see, so nothing jumps on first publish. */
export function defaultLayout(): StoreLayout {
  return {
    version: 1,
    pinned: [],
    sections: [
      { id: 'featured', type: 'featured' },
      { id: 'new', type: 'new_arrivals' },
      { id: 'launches', type: 'launches' },
      { id: 'best', type: 'bestsellers' },
    ],
  };
}

const short = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const isMediaUrl = (v: string) => /^https:\/\/\S+$/i.test(v) || /^\/[\w\-./]+$/.test(v);

/**
 * Checks a layout and returns a clean copy. Problems are reported per section in plain words, and
 * fields that don't belong to a section's type are dropped rather than kept around unused.
 */
export function normaliseLayout(input: unknown): StoreLayout {
  if (!input || typeof input !== 'object') throw new BadRequestException('The store layout is not in the expected shape.');
  const raw = input as Partial<StoreLayout>;
  const sectionsIn = Array.isArray(raw.sections) ? raw.sections : [];
  if (sectionsIn.length > MAX_SECTIONS) throw new BadRequestException(`A store can have up to ${MAX_SECTIONS} sections.`);

  const ids = new Set<string>();
  const sections = sectionsIn.map((s, i): StoreSection => {
    const n = i + 1;
    if (!s || typeof s !== 'object') throw new BadRequestException(`Section ${n} is not in the expected shape.`);
    const type = s.type as SectionType;
    if (!SECTION_TYPES.includes(type)) throw new BadRequestException(`Section ${n} has an unknown type.`);
    const id = short(s.id, 40).replace(/[^\w-]/g, '') || `s${n}`;
    if (ids.has(id)) throw new BadRequestException(`Two sections share the id "${id}".`);
    ids.add(id);

    const out: StoreSection = { id, type };
    const title = short(s.title, 60);
    if (title) out.title = title;
    if (s.hidden) out.hidden = true;
    if (s.limit !== undefined) {
      if (!Number.isInteger(s.limit) || s.limit < 4 || s.limit > 24) throw new BadRequestException(`Section ${n}: show between 4 and 24 pieces.`);
      out.limit = s.limit;
    }
    if (type === 'collection') {
      out.collection = short(s.collection, 80);
      if (!out.collection) throw new BadRequestException(`Section ${n}: pick which collection to show.`);
    }
    if (type === 'occasion') {
      out.occasion = short(s.occasion, 60);
      if (!out.occasion) throw new BadRequestException(`Section ${n}: pick an occasion.`);
    }
    if (type === 'category') {
      out.category = short(s.category, 60);
      if (!out.category) throw new BadRequestException(`Section ${n}: pick a category.`);
    }
    if (type === 'videos' && Array.isArray(s.videoIds)) {
      out.videoIds = [...new Set(s.videoIds.map((v) => short(v, 40)).filter(Boolean))].slice(0, MAX_VIDEOS);
    }
    return out;
  });

  const pinned = [...new Set((Array.isArray(raw.pinned) ? raw.pinned : []).map((p) => short(p, 40)).filter(Boolean))];
  if (pinned.length > MAX_PINNED) throw new BadRequestException(`You can pin up to ${MAX_PINNED} pieces.`);

  const layout: StoreLayout = { version: 1, sections, pinned };
  const cover = short(raw.coverVideo, 2000);
  if (cover) {
    if (!isMediaUrl(cover)) throw new BadRequestException('The cover video needs a full https:// link.');
    layout.coverVideo = cover;
  }
  return layout;
}

/** Reads a stored layout leniently: a layout saved by an older version is cleaned, never thrown on. */
export function readLayout(stored: unknown): StoreLayout | null {
  if (!stored) return null;
  try {
    return normaliseLayout(stored);
  } catch {
    return null;
  }
}

// ── Custom URL ───────────────────────────────────────────────────────────

/** Paths the apps use for their own pages, so a brand can't take them as its store URL. */
export const RESERVED_SLUGS = new Set([
  'about', 'account', 'admin', 'api', 'app', 'auth', 'billing', 'blog', 'brand', 'brands', 'campaign', 'campaigns', 'careers', 'contact', 'creators',
  'dashboard', 'discover', 'drape', 'events', 'explore', 'help', 'home', 'launch', 'launches', 'login', 'logout', 'messages', 'new', 'pricing',
  'privacy', 'profile', 'saved', 'search', 'settings', 'shop', 'signup', 'store', 'stylist', 'support', 'terms', 'threadflank', 'trending', 'wardrobe', 'www',
]);

/** Turns what a brand typed into a URL-safe slug: lower case, hyphens between words. */
export function toSlug(v: string): string {
  return v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Null when the slug is fine, otherwise what is wrong with it. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return 'Use at least 3 letters or numbers.';
  if (slug.length > 40) return 'Keep it to 40 characters.';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return 'Use lower-case letters, numbers and single hyphens.';
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is used by ThreadFlank itself. Pick another.`;
  return null;
}
