import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { BrandEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface BrandEventInput {
  brandId: string;
  type: BrandEventType;
  productId?: string;
  userId?: string;
  /** Who is acting (user id, else IP): the same actor viewing the same thing again within 30 minutes counts once. */
  actor?: string;
  /** The search that led here, for store views that came from search. */
  query?: string;
  /** Creator collab code (click-outs from a creator link). */
  ref?: string;
}

const FLUSH_EVERY_MS = 3_000;
const FLUSH_AT = 200;
const DEDUPE_MS = 30 * 60_000;
const DEDUPED: ReadonlySet<BrandEventType> = new Set(['STORE_VIEW', 'PRODUCT_VIEW']);

/**
 * What shoppers do with a brand: view its store or a piece, try a piece on, save, share, tap Buy.
 * Events are collected in memory and written in batches, so a busy store page costs one insert
 * per few seconds, not one per visitor. Recording never throws and never slows the request down.
 */
@Injectable()
export class BrandEventsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BrandEventsService.name);
  private buffer: Prisma.BrandEventCreateManyInput[] = [];
  private seen = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush(), FLUSH_EVERY_MS);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  record(e: BrandEventInput): void {
    try {
      if (DEDUPED.has(e.type) && e.actor) {
        const key = `${e.type}:${e.actor}:${e.productId ?? e.brandId}`;
        const now = Date.now();
        const at = this.seen.get(key);
        if (at && now - at < DEDUPE_MS) return;
        this.seen.set(key, now);
        if (this.seen.size > 20_000) this.prune(now);
      }
      this.buffer.push({ brandId: e.brandId, type: e.type, productId: e.productId ?? null, userId: e.userId ?? null, query: e.query ?? null, ref: e.ref ?? null });
      if (this.buffer.length >= FLUSH_AT) void this.flush();
    } catch {
      /* analytics must never break a request */
    }
  }

  /**
   * A shopper's try-on of a brand piece finished: count it on the piece and in the brand's events.
   * Pieces that are not live (or not found) are ignored, so a stale id costs nothing.
   */
  async recordDrape(productId: string, userId?: string): Promise<void> {
    try {
      const piece = await this.prisma.brandProduct.findFirst({ where: { id: productId, status: 'PUBLISHED' }, select: { id: true, brandId: true } });
      if (!piece) return;
      await this.prisma.brandProduct.update({ where: { id: piece.id }, data: { drapesCount: { increment: 1 } } });
      this.record({ brandId: piece.brandId, type: 'DRAPE', productId: piece.id, userId });
    } catch (e) {
      this.logger.debug(`drape not recorded: ${e instanceof Error ? e.message : e}`);
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.prisma.brandEvent.createMany({ data: batch });
    } catch (e) {
      // Losing a few analytics rows is better than retrying forever or growing memory.
      this.logger.warn(`dropped ${batch.length} brand events: ${e instanceof Error ? e.message : e}`);
    }
  }

  private prune(now: number) {
    for (const [k, at] of this.seen) if (now - at >= DEDUPE_MS) this.seen.delete(k);
    // Still huge (a flood of distinct actors): start over rather than grow.
    if (this.seen.size > 20_000) this.seen.clear();
  }
}
