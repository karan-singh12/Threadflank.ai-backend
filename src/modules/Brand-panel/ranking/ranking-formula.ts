/**
 * The monthly ranking formula from the platform blueprint (section 5):
 *   Score = Drapes x4 + Saves x3 + Shares x3 + Click-outs x2 + Views x0.1 + New launches x5
 * reset on the 1st of every month (India time), adjusted for catalog size so a big catalog can't
 * win on quantity alone. Paid placement never enters it: nothing here reads auctions or slots.
 */

export const WEIGHTS = { drapes: 4, saves: 3, shares: 3, clicks: 2, views: 0.1, launches: 5 } as const;
export type Part = keyof typeof WEIGHTS;

/** Catalogs larger than this have their score scaled by sqrt(this / live pieces). */
export const CATALOG_ALLOWANCE = 50;

const IST_MS = 330 * 60_000;

/** "2026-11": the month a moment falls in, in India time. */
export function monthKey(at: Date = new Date()): string {
  const ist = new Date(at.getTime() + IST_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isMonthKey(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** The month's span as UTC instants: from 00:00 IST on the 1st to 00:00 IST on the next 1st. */
export function monthRange(key: string): { start: Date; end: Date } {
  const [y, m] = key.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1) - IST_MS), end: new Date(Date.UTC(y, m, 1) - IST_MS) };
}

export function previousMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** How far through the month a moment is, 0 to 1. */
export function monthProgress(key: string, at: Date = new Date()): number {
  const { start, end } = monthRange(key);
  return Math.max(0, Math.min(1, (at.getTime() - start.getTime()) / (end.getTime() - start.getTime())));
}

/** Points earned per action (already de-duplicated and weighted for trust), plus launches and catalog size. */
export interface Activity {
  drapes: number;
  saves: number;
  shares: number;
  clicks: number;
  views: number;
  launches: number;
  livePieces: number;
}

export interface Breakdown {
  parts: Record<Part, { count: number; points: number }>;
  raw: number;
  /** 1 for catalogs up to CATALOG_ALLOWANCE live pieces; below 1 for bigger ones. */
  catalogFactor: number;
  livePieces: number;
  score: number;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function scoreOf(a: Activity): Breakdown {
  const parts = {} as Breakdown['parts'];
  let raw = 0;
  for (const k of Object.keys(WEIGHTS) as Part[]) {
    const count = round(a[k], 1);
    const points = round(count * WEIGHTS[k], 1);
    parts[k] = { count, points };
    raw += points;
  }
  const catalogFactor = a.livePieces > CATALOG_ALLOWANCE ? round(Math.sqrt(CATALOG_ALLOWANCE / a.livePieces), 3) : 1;
  return { parts, raw: round(raw), catalogFactor, livePieces: a.livePieces, score: round(raw * catalogFactor) };
}

export interface Standing {
  brandId: string;
  score: number;
  rank: number;
  breakdown: Breakdown;
}

/**
 * Ranks by score, highest first. Equal scores share a rank (1, 2, 2, 4) and a brand with no score
 * this month isn't ranked at all.
 */
export function rankAll(rows: { brandId: string; breakdown: Breakdown }[]): Standing[] {
  const scored = rows.filter((r) => r.breakdown.score > 0).sort((a, b) => b.breakdown.score - a.breakdown.score || a.brandId.localeCompare(b.brandId));
  const out: Standing[] = [];
  scored.forEach((r, i) => {
    const prev = out[i - 1];
    const rank = prev && prev.score === r.breakdown.score ? prev.rank : i + 1;
    out.push({ brandId: r.brandId, score: r.breakdown.score, rank, breakdown: r.breakdown });
  });
  return out;
}

/** How many more points lift the brand one place. Null at #1, or when it isn't ranked yet. */
export function nextRankGap(standings: Standing[], brandId: string): { rank: number; pointsNeeded: number } | null {
  const me = standings.find((s) => s.brandId === brandId);
  if (!me || me.rank === 1) return null;
  const above = standings.filter((s) => s.score > me.score).at(-1);
  if (!above) return null;
  return { rank: above.rank, pointsNeeded: round(above.score - me.score + 0.1) };
}

/**
 * What would move the score most, in the brand's terms. Ordered by likely impact; the panel shows
 * the first few.
 */
export function rankingTips(b: Breakdown, ctx: { upcomingLaunch: boolean; photosNeedingWork: number; noBuyLink: number }): string[] {
  const tips: string[] = [];
  if (b.parts.launches.count === 0 && !ctx.upcomingLaunch) tips.push(`Schedule a launch this month: each new launch adds ${WEIGHTS.launches} points, and its waitlist brings shoppers back.`);
  if (b.livePieces < 12) tips.push('Add more pieces: brands with at least a dozen live pieces get tried on far more.');
  if (ctx.photosNeedingWork > 0) tips.push(`Fix ${ctx.photosNeedingWork} ${ctx.photosNeedingWork === 1 ? 'photo' : 'photos'} flagged by the try-on check: try-ons are worth ${WEIGHTS.drapes} points each.`);
  if (ctx.noBuyLink > 0) tips.push(`Add buy links to ${ctx.noBuyLink} ${ctx.noBuyLink === 1 ? 'piece' : 'pieces'}: a click-out is worth ${WEIGHTS.clicks} points and only counts when there's somewhere to go.`);
  if (b.parts.drapes.count > 0 && b.parts.clicks.count / b.parts.drapes.count < 0.03) tips.push('Shoppers try your pieces on but rarely click through. Check prices, size availability and the first photo.');
  if (b.parts.shares.count === 0) tips.push('Make a launch reel in AI Studio and share it: shares are worth 3 points each.');
  if (b.catalogFactor < 1) tips.push(`Your score is scaled for a ${b.livePieces}-piece catalog. Featuring and pinning your strongest pieces focuses attention where it scores.`);
  return tips;
}
