/**
 * Turns one row of a bulk import (a CSV line the panel has already split into fields) into a clean piece,
 * or throws a one-sentence reason the brand can act on. Pure functions, so they are easy to test.
 */

export interface ImportResolver {
  /** The exact category name an admin gave it; throws when it is not in the list. */
  category(value: string): string;
  occasions(values: string[]): string[];
}

export interface NormalizedRow {
  title: string;
  sku: string;
  price: number;
  originalPrice?: number;
  category: string;
  collection?: string;
  occasions?: string[];
  colors?: string[];
  sizes?: string[];
  stock?: number;
  images?: string[];
  buyUrl?: string;
  description?: string;
  status?: 'PUBLISHED' | 'DRAFT';
}

export const MAX_IMAGES = 8;
const MAX_LIST = 20;

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

/** Accepts a real array or a delimited string ("Red|Blue"). */
function list(v: unknown, split: RegExp): string[] {
  const parts = Array.isArray(v) ? v.map(text) : text(v).split(split);
  const out: string[] = [];
  for (const p of parts.map((s) => s.trim()).filter(Boolean)) if (!out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p);
  return out;
}

function money(v: unknown, label: string): number | undefined {
  const s = text(v).replace(/[₹,\s]/g, '');
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} "${text(v)}" is not a number.`);
  return n;
}

function httpsUrl(v: string, label: string): string {
  let ok = false;
  try {
    ok = new URL(v).protocol === 'https:';
  } catch {
    ok = false;
  }
  if (!ok) throw new Error(`${label} "${v.slice(0, 60)}" must be a full link starting with https://`);
  return v;
}

export function normalizeImportRow(raw: unknown, resolve: ImportResolver): NormalizedRow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('This row is empty.');
  const r = raw as Record<string, unknown>;

  const title = text(r.title);
  if (title.length < 2) throw new Error('Title is missing (at least 2 characters).');
  if (title.length > 200) throw new Error('Title is longer than 200 characters.');

  const sku = text(r.sku);
  if (!sku) throw new Error('SKU is missing. Every piece needs a unique SKU.');
  if (sku.length > 60) throw new Error('SKU is longer than 60 characters.');

  const price = money(r.price, 'Price');
  if (price === undefined || price <= 0) throw new Error('Price must be a number above 0.');

  const categoryRaw = text(r.category);
  if (!categoryRaw) throw new Error('Category is missing.');
  const category = resolve.category(categoryRaw);

  const out: NormalizedRow = { title, sku, price, category };

  const original = money(r.originalPrice, 'Original price');
  if (original !== undefined && original > price) out.originalPrice = original;

  const collection = text(r.collection);
  if (collection.length > 80) throw new Error('Collection name is longer than 80 characters.');
  if (collection) out.collection = collection;

  const occasions = list(r.occasions, /[|,]/);
  if (occasions.length) out.occasions = resolve.occasions(occasions);

  for (const key of ['colors', 'sizes'] as const) {
    const values = list(r[key], /[|,]/);
    if (values.length > MAX_LIST) throw new Error(`Too many ${key} (at most ${MAX_LIST}).`);
    if (values.some((x) => x.length > 40)) throw new Error(`A value in ${key} is longer than 40 characters.`);
    if (values.length) out[key] = values;
  }

  const stockRaw = text(r.stock);
  if (stockRaw) {
    const stock = Number(stockRaw);
    if (!Number.isInteger(stock) || stock < 0) throw new Error(`Stock "${stockRaw}" must be a whole number, 0 or more.`);
    out.stock = stock;
  }

  const images = list(r.images, /[|\s]+/);
  if (images.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images per piece.`);
  if (images.length) out.images = images.map((u) => httpsUrl(u, 'Image link'));

  const buyUrl = text(r.buyUrl);
  if (buyUrl) out.buyUrl = httpsUrl(buyUrl, 'Buy link');

  const description = text(r.description);
  if (description.length > 2000) throw new Error('Description is longer than 2000 characters.');
  if (description) out.description = description;

  const status = text(r.status).toLowerCase();
  if (status) {
    if (['published', 'live', 'active'].includes(status)) out.status = 'PUBLISHED';
    else if (['draft', 'hidden', 'inactive'].includes(status)) out.status = 'DRAFT';
    else throw new Error(`Status "${text(r.status)}" must be Live or Draft.`);
  }

  return out;
}
