import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

type ItemInput = { name: string; brand?: string; category: string; image: string; color?: string; tags?: string[]; costPaid?: number | null };

const DAY_MS = 24 * 60 * 60 * 1000;
/** An item nobody has worn for this long is flagged as under-used. */
const UNWORN_DAYS = 90;

const parseTags = (tags: unknown): string[] => {
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const cleanCost = (v: unknown) => {
  if (v === null) return null;
  const n = Number(v);
  if (v === undefined || v === "" || !Number.isFinite(n)) return undefined;
  if (n < 0) throw new BadRequestException("Price paid can't be negative");
  return Math.round(n);
};

/** Cost per wear: the price spread over every wear (an unworn item's CPW is its full price). */
const cpwOf = (costPaid: number | null, wornCount: number) => (costPaid == null ? null : Math.round(costPaid / Math.max(1, wornCount)));

const normalise = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);

@Injectable()
export class WardrobeService {
  constructor(private readonly prisma: PrismaService) {}

  private withDerived<T extends { tags: unknown; costPaid: number | null; wornCount: number }>(item: T) {
    return { ...item, tags: parseTags(item.tags), costPerWear: cpwOf(item.costPaid, item.wornCount) };
  }

  async create(userId: string, data: ItemInput) {
    const item = await this.prisma.wardrobeItem.create({
      data: {
        userId,
        name: data.name,
        brand: data.brand || null,
        category: data.category,
        image: data.image,
        color: data.color || null,
        tags: data.tags ? JSON.stringify(data.tags) : null,
        costPaid: cleanCost(data.costPaid) ?? null,
      },
    });
    return this.withDerived(item);
  }

  async findAll(userId: string) {
    const items = await this.prisma.wardrobeItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return items.map((item) => this.withDerived(item));
  }

  private async owned(id: string, userId: string) {
    const item = await this.prisma.wardrobeItem.findFirst({ where: { id, userId } });
    if (!item) {
      throw new NotFoundException({
        success: false,
        message: "Wardrobe item not found",
      });
    }
    return item;
  }

  async findOne(id: string, userId: string) {
    return this.withDerived(await this.owned(id, userId));
  }

  async update(id: string, userId: string, data: Partial<ItemInput>) {
    await this.owned(id, userId); // verify ownership and existence

    const updateData: any = {};
    for (const key of ["name", "brand", "category", "image", "color"] as const) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    if (data.tags) updateData.tags = JSON.stringify(data.tags);
    const cost = cleanCost(data.costPaid);
    if (cost !== undefined) updateData.costPaid = cost;

    const updated = await this.prisma.wardrobeItem.update({ where: { id }, data: updateData });
    return this.withDerived(updated);
  }

  async remove(id: string, userId: string) {
    await this.owned(id, userId); // verify ownership and existence

    await this.prisma.wardrobeItem.delete({
      where: { id },
    });

    return { success: true, message: "Wardrobe item deleted successfully" };
  }

  /** Logs one wear (today unless a date is given) and bumps the counters. */
  async markWorn(id: string, userId: string, input: { wornAt?: string; lookId?: string; eventId?: string } = {}) {
    await this.owned(id, userId);
    const wornAt = input.wornAt ? new Date(input.wornAt) : new Date();
    if (Number.isNaN(wornAt.getTime())) throw new BadRequestException("Invalid wear date");
    if (wornAt.getTime() > Date.now() + DAY_MS) throw new BadRequestException("Wear date can't be in the future");

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.wardrobeItemWearLog.create({
        data: { wardrobeItemId: id, userId, wornAt, lookId: input.lookId ?? null, eventId: input.eventId ?? null },
      });
      const latest = await tx.wardrobeItemWearLog.findFirst({ where: { wardrobeItemId: id }, orderBy: { wornAt: "desc" } });
      return tx.wardrobeItem.update({
        where: { id },
        data: { wornCount: { increment: 1 }, lastWornAt: latest?.wornAt ?? wornAt },
      });
    });
    return this.withDerived(updated);
  }

  /** Removes the most recent wear, for an accidental tap. */
  async undoWear(id: string, userId: string) {
    await this.owned(id, userId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const last = await tx.wardrobeItemWearLog.findFirst({ where: { wardrobeItemId: id }, orderBy: { wornAt: "desc" } });
      if (!last) throw new BadRequestException("This item has no wears to undo");
      await tx.wardrobeItemWearLog.delete({ where: { id: last.id } });
      const previous = await tx.wardrobeItemWearLog.findFirst({ where: { wardrobeItemId: id }, orderBy: { wornAt: "desc" } });
      const count = await tx.wardrobeItemWearLog.count({ where: { wardrobeItemId: id } });
      return tx.wardrobeItem.update({ where: { id }, data: { wornCount: count, lastWornAt: previous?.wornAt ?? null } });
    });
    return this.withDerived(updated);
  }

  async wearHistory(id: string, userId: string) {
    await this.owned(id, userId);
    return this.prisma.wardrobeItemWearLog.findMany({ where: { wardrobeItemId: id }, orderBy: { wornAt: "desc" }, take: 100 });
  }

  /** Wardrobe value, cost-per-wear and under-used items. */
  async analytics(userId: string) {
    const items = await this.prisma.wardrobeItem.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    const now = Date.now();
    const cutoff = now - UNWORN_DAYS * DAY_MS;
    const since = new Date(now - 180 * DAY_MS);

    const logs = await this.prisma.wardrobeItemWearLog.findMany({
      where: { userId, wornAt: { gte: since } },
      select: { wornAt: true },
    });

    const rows = items.map((i) => ({
      id: i.id,
      name: i.name,
      brand: i.brand,
      category: i.category,
      image: i.image,
      color: i.color,
      costPaid: i.costPaid,
      wornCount: i.wornCount,
      lastWornAt: i.lastWornAt,
      createdAt: i.createdAt,
      costPerWear: cpwOf(i.costPaid, i.wornCount),
      daysSinceWorn: i.lastWornAt ? Math.floor((now - i.lastWornAt.getTime()) / DAY_MS) : null,
    }));

    const priced = rows.filter((r) => r.costPaid != null);
    const totalValue = priced.reduce((s, r) => s + (r.costPaid ?? 0), 0);
    const pricedWears = priced.reduce((s, r) => s + r.wornCount, 0);

    // "Unworn" = never worn and owned for 90+ days, or last worn 90+ days ago.
    const unworn = rows.filter((r) => (r.lastWornAt ? r.lastWornAt.getTime() < cutoff : r.createdAt.getTime() < cutoff));
    const neverWorn = rows.filter((r) => r.wornCount === 0);

    const byCategory = new Map<string, { category: string; items: number; wears: number; value: number }>();
    for (const r of rows) {
      const c = byCategory.get(r.category) ?? { category: r.category, items: 0, wears: 0, value: 0 };
      c.items += 1;
      c.wears += r.wornCount;
      c.value += r.costPaid ?? 0;
      byCategory.set(r.category, c);
    }

    const monthly = new Map<string, number>();
    for (let m = 5; m >= 0; m--) {
      const d = new Date(now);
      d.setDate(1);
      d.setMonth(d.getMonth() - m);
      monthly.set(d.toISOString().slice(0, 7), 0);
    }
    for (const l of logs) {
      const key = l.wornAt.toISOString().slice(0, 7);
      if (monthly.has(key)) monthly.set(key, (monthly.get(key) ?? 0) + 1);
    }

    return {
      totals: {
        items: rows.length,
        pricedItems: priced.length,
        totalValue,
        totalWears: rows.reduce((s, r) => s + r.wornCount, 0),
        averageCostPerWear: priced.length ? Math.round(totalValue / Math.max(1, pricedWears)) : null,
        unwornCount: unworn.length,
        neverWornCount: neverWorn.length,
        unwornDays: UNWORN_DAYS,
      },
      bestValue: priced.filter((r) => r.wornCount > 0).sort((a, b) => (a.costPerWear ?? 0) - (b.costPerWear ?? 0)).slice(0, 5),
      worstValue: [...priced].sort((a, b) => (b.costPerWear ?? 0) - (a.costPerWear ?? 0)).slice(0, 5),
      mostWorn: [...rows].sort((a, b) => b.wornCount - a.wornCount).filter((r) => r.wornCount > 0).slice(0, 5),
      unworn: unworn.slice(0, 20),
      byCategory: [...byCategory.values()].sort((a, b) => b.items - a.items),
      wearsByMonth: [...monthly.entries()].map(([month, wears]) => ({ month, wears })),
      items: rows,
    };
  }

  /**
   * "You already own something similar": items in the same category that
   * share a colour or name words with the candidate purchase.
   */
  async similar(userId: string, query: { category?: string; color?: string; name?: string }) {
    if (!query.category && !query.name && !query.color) return [];
    const items = await this.prisma.wardrobeItem.findMany({
      where: { userId, ...(query.category ? { category: query.category } : {}) },
      take: 200,
    });
    const words = new Set(normalise(query.name));
    const colour = (query.color ?? "").trim().toLowerCase();

    return items
      .map((i) => {
        let score = query.category ? 1 : 0;
        if (colour && (i.color ?? "").toLowerCase() === colour) score += 2;
        const shared = normalise(`${i.name} ${i.brand ?? ""}`).filter((w) => words.has(w)).length;
        score += Math.min(shared, 3);
        return { item: this.withDerived(i), score };
      })
      .filter((r) => r.score >= (query.category ? 2 : 1))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => ({ ...r.item, matchScore: r.score }));
  }
}
