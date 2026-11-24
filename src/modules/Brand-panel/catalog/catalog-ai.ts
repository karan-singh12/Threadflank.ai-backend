import type { JsonSchema } from '../../../shared/vision/vision.service';

// ── Image size from the file header ──────────────────────────────────────
// Reading the header is enough to know a photo's size, so the drape check can flag a tiny photo
// without decoding it or adding an image library.

export function imageDimensions(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24) return null;
  // PNG: signature, then the IHDR chunk with width and height as big-endian 32-bit ints.
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // GIF: logical screen size, little-endian 16-bit.
  if (b.toString('ascii', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  // WebP: RIFF container with one of three chunk kinds.
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X' && b.length >= 30) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8 ' && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L' && b.length >= 25) {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** A problem with the photo itself, found without AI. `blocking` means try-on cannot work well. */
export interface PhotoIssue {
  message: string;
  blocking: boolean;
  penalty: number;
}

export function localPhotoIssues(dim: { width: number; height: number } | null): PhotoIssue[] {
  if (!dim) return [];
  const issues: PhotoIssue[] = [];
  const short = Math.min(dim.width, dim.height);
  if (short < 400) issues.push({ message: `The photo is very small (${dim.width}×${dim.height}). Use one at least 800 pixels wide.`, blocking: true, penalty: 40 });
  else if (short < 700) issues.push({ message: `The photo is small (${dim.width}×${dim.height}). 800 pixels wide or more gives a sharper try-on.`, blocking: false, penalty: 15 });
  if (dim.width / dim.height > 1.25) issues.push({ message: 'The photo is landscape. A portrait photo (about 3:4) fits the try-on frame.', blocking: false, penalty: 10 });
  return issues;
}

// ── Drape-ready check ────────────────────────────────────────────────────

export interface DrapeVision {
  mainSubject: 'single_garment' | 'outfit_set' | 'multiple_products' | 'not_clothing';
  view: 'front' | 'back' | 'side' | 'detail_closeup' | 'unclear';
  presentation: 'on_model' | 'mannequin' | 'hanger' | 'flatlay' | 'other';
  background: 'plain' | 'studio' | 'busy';
  garmentFullyVisible: boolean;
  wellLit: boolean;
  textOrWatermark: boolean;
}

export const DRAPE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    mainSubject: { type: 'string', enum: ['single_garment', 'outfit_set', 'multiple_products', 'not_clothing'], description: 'outfit_set = one coordinated set sold together, e.g. a lehenga with blouse and dupatta' },
    view: { type: 'string', enum: ['front', 'back', 'side', 'detail_closeup', 'unclear'] },
    presentation: { type: 'string', enum: ['on_model', 'mannequin', 'hanger', 'flatlay', 'other'] },
    background: { type: 'string', enum: ['plain', 'studio', 'busy'] },
    garmentFullyVisible: { type: 'boolean', description: 'true when the whole garment is in frame, neckline to hem, nothing cropped' },
    wellLit: { type: 'boolean' },
    textOrWatermark: { type: 'boolean', description: 'true when text, a logo overlay or a watermark is printed over the photo' },
  },
  required: ['mainSubject', 'view', 'presentation', 'background', 'garmentFullyVisible', 'wellLit', 'textOrWatermark'],
};

export const DRAPE_PROMPT = [
  'You check product photos for a virtual try-on. The try-on dresses a person in the garment from the photo,',
  'so it needs the whole garment, seen from the front, as the only product in the picture.',
  'Look at the photo and fill in each field honestly. Do not guess generously: if the view is ambiguous say "unclear".',
].join(' ');

export const PASS_SCORE = 70;

/**
 * Turns the engine's observations, plus what the file header said, into a score out of 100 and the
 * list of things the brand should fix. A blocking problem fails the piece whatever the score.
 */
export function scoreDrape(v: DrapeVision | null, local: PhotoIssue[]): { score: number; ready: boolean; issues: string[] } {
  const found: PhotoIssue[] = [...local];
  if (v) {
    if (v.mainSubject === 'not_clothing') found.push({ message: "This photo doesn't show a garment.", blocking: true, penalty: 100 });
    if (v.mainSubject === 'multiple_products') found.push({ message: 'The photo shows several products. Use one piece (or one set) per photo.', blocking: true, penalty: 40 });
    if (v.view === 'back' || v.view === 'side') found.push({ message: 'Use a front view. Try-on dresses the front of the person.', blocking: true, penalty: 30 });
    if (v.view === 'detail_closeup') found.push({ message: 'This is a close-up. Lead with a photo of the whole piece and keep close-ups for later photos.', blocking: true, penalty: 40 });
    if (v.view === 'unclear') found.push({ message: "It's hard to tell which side of the piece this shows. A straight front view works best.", blocking: false, penalty: 15 });
    if (!v.garmentFullyVisible) found.push({ message: 'Part of the piece is cut off. Show it whole, from neckline to hem.', blocking: true, penalty: 30 });
    if (v.background === 'busy') found.push({ message: 'The background is busy. A plain or studio background gives a cleaner try-on.', blocking: false, penalty: 15 });
    if (!v.wellLit) found.push({ message: 'The photo is dark or unevenly lit, so colours may come out wrong.', blocking: false, penalty: 10 });
    if (v.textOrWatermark) found.push({ message: 'Text or a watermark sits on the photo and can show up in try-ons.', blocking: false, penalty: 10 });
  }
  let score = Math.max(0, Math.min(100, 100 - found.reduce((n, i) => n + i.penalty, 0)));
  // A blocking problem fails the photo whatever else is right, so the stored score alone says pass or
  // fail: anything below PASS_SCORE needs work.
  if (found.some((i) => i.blocking)) score = Math.min(score, PASS_SCORE - 1);
  // Without the visual check only size problems are known, so a photo is never passed on that alone.
  const ready = v !== null && score >= PASS_SCORE;
  return { score: v ? score : 0, ready, issues: found.map((i) => i.message) };
}

/**
 * How the brand panel labels a piece's photo. This is a warning for the brand, not a gate: shoppers
 * can still try on any piece with a photo (`isDrapeReady`), whatever the check found.
 */
export function photoStatus(p: { images: string[]; drapeCheckedAt: Date | null; drapeScore: number }): 'missing' | 'unchecked' | 'good' | 'needs_work' {
  if (p.images.length === 0) return 'missing';
  if (!p.drapeCheckedAt) return 'unchecked';
  return p.drapeScore >= PASS_SCORE ? 'good' : 'needs_work';
}

// ── Auto-tagging ─────────────────────────────────────────────────────────

export interface TagAnswer {
  title?: string;
  category?: string;
  occasions?: string[];
  colors?: string[];
  fabric?: string;
  pattern?: string;
  tags?: string[];
}

export interface TagSuggestion {
  title: string | null;
  category: string | null;
  occasions: string[];
  colors: string[];
  fabric: string | null;
  pattern: string | null;
  tags: string[];
}

export function tagSchema(categories: string[], occasions: string[]): JsonSchema {
  return {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short product title, at most 8 words, no brand name' },
      category: categories.length ? { type: 'string', enum: categories } : { type: 'string' },
      occasions: { type: 'array', items: occasions.length ? { type: 'string', enum: occasions } : { type: 'string' }, description: 'Up to 3 that genuinely fit' },
      colors: { type: 'array', items: { type: 'string' }, description: 'Up to 3 main colours, plain names like "Mustard" or "Emerald Green"' },
      fabric: { type: 'string', description: 'e.g. Silk, Cotton, Georgette, Chanderi. "unknown" if you cannot tell' },
      pattern: { type: 'string', description: 'e.g. Solid, Floral, Bandhani, Zari border, Embroidered' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Up to 6 short style words a shopper might search' },
    },
    required: ['title', 'category', 'occasions', 'colors', 'fabric', 'pattern', 'tags'],
  };
}

export function tagPrompt(title?: string) {
  return [
    'You catalogue Indian and western fashion for a shopping app. Look at the product photo and describe the garment.',
    'Pick the category and occasions only from the allowed values. Name colours the way a shopper would.',
    title ? `The brand calls it "${title.slice(0, 120)}".` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

const slugOf = (v: string) => v.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (v: string) => v.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
const UNKNOWN = new Set(['unknown', 'n/a', 'na', 'none', 'other', '-', 'not sure']);

function pick(value: string | undefined, list: string[]): string | null {
  if (!value?.trim()) return null;
  if (list.length === 0) return value.trim().slice(0, 60);
  return list.find((l) => slugOf(l) === slugOf(value)) ?? null;
}

/**
 * Keeps only what the brand can use: category and occasions from the admin's lists (anything else
 * is dropped, not forced to the nearest match), tidy colour names, no "unknown" placeholders.
 */
export function cleanTagAnswer(a: TagAnswer, lists: { categories: string[]; occasions: string[] }): TagSuggestion {
  const short = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const occasions: string[] = [];
  for (const o of Array.isArray(a.occasions) ? a.occasions : []) {
    const hit = pick(short(o, 60), lists.occasions);
    if (hit && !occasions.includes(hit)) occasions.push(hit);
  }
  const colors: string[] = [];
  for (const c of Array.isArray(a.colors) ? a.colors : []) {
    const name = titleCase(short(c, 24));
    if (name && !UNKNOWN.has(name.toLowerCase()) && !colors.some((x) => x.toLowerCase() === name.toLowerCase())) colors.push(name);
  }
  const tags: string[] = [];
  for (const t of Array.isArray(a.tags) ? a.tags : []) {
    const tag = short(t, 24).replace(/^#/, '').toLowerCase();
    if (tag && !UNKNOWN.has(tag) && !tags.includes(tag)) tags.push(tag);
  }
  const fabric = titleCase(short(a.fabric, 40));
  const pattern = titleCase(short(a.pattern, 40));
  const title = short(a.title, 80);
  return {
    title: title || null,
    category: pick(short(a.category, 60), lists.categories),
    occasions: occasions.slice(0, 3),
    colors: colors.slice(0, 4),
    fabric: fabric && !UNKNOWN.has(fabric.toLowerCase()) ? fabric : null,
    pattern: pattern && !UNKNOWN.has(pattern.toLowerCase()) ? pattern : null,
    tags: tags.slice(0, 8),
  };
}

// ── Product description ──────────────────────────────────────────────────

export type DescribeTone = 'elegant' | 'playful' | 'minimal' | 'festive';
export type DescribeLanguage = 'english' | 'hinglish';

export interface DescribeAnswer {
  title?: string;
  description?: string;
  seoKeywords?: string[];
}

export const DESCRIBE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Product title, 4 to 10 words, no brand name, no emojis' },
    description: { type: 'string', description: '2 to 4 short sentences a shopper reads on the product page' },
    seoKeywords: { type: 'array', items: { type: 'string' }, description: '5 to 8 search phrases, lowercase' },
  },
  required: ['title', 'description', 'seoKeywords'],
};

const TONES: Record<DescribeTone, string> = {
  elegant: 'refined and graceful, never flowery',
  playful: 'light and friendly',
  minimal: 'plain and factual, short sentences',
  festive: 'warm and celebratory, suited to weddings and festivals',
};

export function describePrompt(input: {
  brand: string;
  title?: string;
  category?: string;
  fabric?: string;
  pattern?: string;
  colors?: string[];
  occasions?: string[];
  notes?: string;
  tone: DescribeTone;
  language: DescribeLanguage;
  withPhoto: boolean;
}) {
  const facts = [
    input.title && `Working title: ${input.title}`,
    input.category && `Category: ${input.category}`,
    input.fabric && `Fabric: ${input.fabric}`,
    input.pattern && `Pattern: ${input.pattern}`,
    input.colors?.length && `Colours: ${input.colors.join(', ')}`,
    input.occasions?.length && `Occasions: ${input.occasions.join(', ')}`,
    input.notes && `Brand's notes: ${input.notes.slice(0, 400)}`,
  ].filter(Boolean);
  return [
    `Write the product listing for a piece by ${input.brand}, a fashion brand selling on ThreadFlank.`,
    input.withPhoto ? 'The photo shows the piece; describe what is actually visible.' : '',
    facts.length ? `What the brand told us:\n- ${facts.join('\n- ')}` : '',
    `Tone: ${TONES[input.tone]}.`,
    input.language === 'hinglish'
      ? 'Write the title and description in natural Hinglish (Hindi in Latin script mixed with English), the way Indian shoppers talk. Keywords stay in English.'
      : 'Write in clear Indian English.',
    'Do not invent facts that are not given or visible: no fabric, care or size claims you cannot see. No prices, no discounts, no emojis, no hashtags.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function cleanDescribeAnswer(a: DescribeAnswer): { title: string; description: string; seoKeywords: string[] } | null {
  const short = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const title = short(a.title, 80).replace(/\s+/g, ' ');
  const description = short(a.description, 2000);
  if (!title || description.length < 30) return null;
  const seoKeywords: string[] = [];
  for (const k of Array.isArray(a.seoKeywords) ? a.seoKeywords : []) {
    const kw = short(k, 40).toLowerCase().replace(/\s+/g, ' ');
    if (kw && !seoKeywords.includes(kw)) seoKeywords.push(kw);
  }
  return { title, description, seoKeywords: seoKeywords.slice(0, 10) };
}
