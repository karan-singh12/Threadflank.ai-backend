import { BadRequestException } from '@nestjs/common';

/** Pieces with at most this many left count as "low stock" (catalog filters, shopper badges, alerts). */
export const LOW_STOCK_AT = 3;

export const MAX_VARIANTS = 100;
const MAX_STOCK = 100_000;

export interface VariantInput {
  size?: string;
  color?: string;
  colorHex?: string;
  sku?: string;
  price?: number | null;
  stock?: number;
}

export interface CleanVariant {
  size: string;
  color: string;
  colorHex: string | null;
  sku: string | null;
  price: number | null;
  stock: number;
  sortOrder: number;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/**
 * Checks a brand's variant table and puts it in a form the database can take. Every problem is
 * reported in words a brand understands, with the row it is on, rather than as a validation dump.
 */
export function normaliseVariants(input: VariantInput[]): CleanVariant[] {
  if (!Array.isArray(input)) throw new BadRequestException('Send the variants as a list.');
  if (input.length > MAX_VARIANTS) throw new BadRequestException(`A piece can have up to ${MAX_VARIANTS} sizes and colours.`);
  const seen = new Map<string, number>();
  return input.map((raw, i) => {
    const row = i + 1;
    const size = text(raw?.size, 40);
    const color = text(raw?.color, 40);
    if (!size && !color) throw new BadRequestException(`Row ${row} needs a size, a colour, or both.`);
    const key = `${size.toLowerCase()}|${color.toLowerCase()}`;
    const first = seen.get(key);
    if (first !== undefined) {
      const label = [size, color].filter(Boolean).join(' / ');
      throw new BadRequestException(`Row ${row} repeats ${label} from row ${first}.`);
    }
    seen.set(key, row);

    const stock = raw?.stock ?? 0;
    if (!Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) throw new BadRequestException(`Row ${row}: stock must be a whole number from 0 to ${MAX_STOCK}.`);

    let price: number | null = null;
    if (raw?.price !== undefined && raw?.price !== null) {
      if (typeof raw.price !== 'number' || !Number.isFinite(raw.price) || raw.price < 0) throw new BadRequestException(`Row ${row}: price must be a number of rupees, or empty to use the piece's price.`);
      price = Math.round(raw.price * 100) / 100;
    }

    const hex = text(raw?.colorHex, 7);
    if (hex && !/^#[0-9a-f]{6}$/i.test(hex)) throw new BadRequestException(`Row ${row}: colour code must look like #A1B2C3.`);

    return { size, color, colorHex: hex ? hex.toUpperCase() : null, sku: text(raw?.sku, 64) || null, price, stock, sortOrder: i };
  });
}

/** What a piece shows when it has variants: total stock, and its sizes and colours in the brand's order. */
export function rollUp(variants: Pick<CleanVariant, 'size' | 'color' | 'stock'>[]) {
  const sizes: string[] = [];
  const colors: string[] = [];
  let stock = 0;
  for (const v of variants) {
    stock += v.stock;
    if (v.size && !sizes.some((s) => s.toLowerCase() === v.size.toLowerCase())) sizes.push(v.size);
    if (v.color && !colors.some((c) => c.toLowerCase() === v.color.toLowerCase())) colors.push(v.color);
  }
  return { stock, sizes, colors };
}

export type StockState = 'in' | 'low' | 'out';

export function stockState(stock: number): StockState {
  if (stock <= 0) return 'out';
  return stock <= LOW_STOCK_AT ? 'low' : 'in';
}

// ── Size chart ───────────────────────────────────────────────────────────

export interface SizeChart {
  unit: 'in' | 'cm';
  /** The first column is the size; the rest are measurements, e.g. Bust, Waist, Length. */
  columns: string[];
  rows: string[][];
}

const MAX_COLUMNS = 8;
const MAX_ROWS = 20;
const CELL = 24;

/**
 * Validates a size chart. Null clears it. Empty measurement cells are allowed (a brand may not
 * know every number) but every row must have a size, and rows must match the header.
 */
export function normaliseSizeChart(input: unknown): SizeChart | null {
  if (input === null) return null;
  if (!input || typeof input !== 'object') throw new BadRequestException('The size chart is not in the expected shape.');
  const chart = input as Partial<SizeChart>;
  const unit = chart.unit === 'cm' ? 'cm' : chart.unit === 'in' ? 'in' : null;
  if (!unit) throw new BadRequestException('Pick inches or centimetres for the size chart.');

  if (!Array.isArray(chart.columns) || chart.columns.length < 2) throw new BadRequestException('A size chart needs the Size column and at least one measurement.');
  if (chart.columns.length > MAX_COLUMNS) throw new BadRequestException(`A size chart can have up to ${MAX_COLUMNS} columns.`);
  const columns = chart.columns.map((c, i) => {
    const name = text(c, CELL);
    if (!name) throw new BadRequestException(`Column ${i + 1} of the size chart needs a name.`);
    return name;
  });

  if (!Array.isArray(chart.rows) || chart.rows.length === 0) throw new BadRequestException('Add at least one size to the chart.');
  if (chart.rows.length > MAX_ROWS) throw new BadRequestException(`A size chart can have up to ${MAX_ROWS} sizes.`);
  const sizes = new Set<string>();
  const rows = chart.rows.map((r, i) => {
    if (!Array.isArray(r) || r.length !== columns.length) throw new BadRequestException(`Row ${i + 1} of the size chart should have ${columns.length} cells.`);
    const cells = r.map((c) => text(typeof c === 'number' ? String(c) : c, CELL));
    if (!cells[0]) throw new BadRequestException(`Row ${i + 1} of the size chart needs a size.`);
    const key = cells[0].toLowerCase();
    if (sizes.has(key)) throw new BadRequestException(`Size ${cells[0]} is in the chart twice.`);
    sizes.add(key);
    return cells;
  });
  return { unit, columns, rows };
}
