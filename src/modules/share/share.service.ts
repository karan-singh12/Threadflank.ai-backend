import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";

const CHANNELS = ["whatsapp", "instagram", "link"] as const;
export type ShareChannel = (typeof CHANNELS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** URL-safe 10-char token, short enough to survive being forwarded as text. */
const newToken = () => randomBytes(8).toString("base64url").slice(0, 10);

@Injectable()
export class ShareService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, lookId: string, channel: string) {
    if (!CHANNELS.includes(channel as ShareChannel)) throw new BadRequestException("Unknown share channel");
    const look = await this.prisma.look.findFirst({ where: { id: lookId, userId } });
    if (!look) throw new NotFoundException("Look not found");

    // One link per look + channel keeps open counts meaningful.
    const existing = await this.prisma.shareEvent.findFirst({ where: { lookId, sharedBy: userId, channel } });
    if (existing) return existing;
    return this.prisma.shareEvent.create({ data: { lookId, sharedBy: userId, channel, token: newToken() } });
  }

  /** Public: what the share page and the card renderer need. */
  async resolve(token: string) {
    const share = await this.prisma.shareEvent.findUnique({
      where: { token },
      include: { look: { select: { id: true, name: true, occasion: true, image: true, pieces: true, videoUrl: true, poseVariants: true, createdAt: true } } },
    });
    if (!share) throw new NotFoundException("This share link has expired");
    const user = await this.prisma.user.findUnique({ where: { id: share.sharedBy }, select: { username: true, email: true, avatar: true } });
    return {
      token: share.token,
      channel: share.channel,
      look: share.look,
      sharedBy: { name: user?.username || user?.email.split("@")[0] || "A friend", avatar: user?.avatar ?? null },
    };
  }

  async open(token: string) {
    await this.prisma.shareEvent.updateMany({ where: { token }, data: { openCount: { increment: 1 }, lastOpenedAt: new Date() } });
    return { ok: true };
  }

  async mine(userId: string) {
    return this.prisma.shareEvent.findMany({
      where: { sharedBy: userId },
      orderBy: { createdAt: "desc" },
      include: { look: { select: { id: true, name: true, image: true } } },
      take: 50,
    });
  }

  async adminStats(days = 30) {
    const since = new Date(Date.now() - days * DAY_MS);
    const [byChannel, totals, recent, top] = await Promise.all([
      this.prisma.shareEvent.groupBy({ by: ["channel"], _count: true, _sum: { openCount: true } }),
      this.prisma.shareEvent.aggregate({ _count: true, _sum: { openCount: true } }),
      this.prisma.shareEvent.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, openCount: true } }),
      this.prisma.shareEvent.findMany({
        orderBy: { openCount: "desc" },
        take: 10,
        include: { look: { select: { id: true, name: true, image: true } } },
      }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: top.map((t) => t.sharedBy) } }, select: { id: true, username: true, email: true } });
    const userById = new Map(users.map((u) => [u.id, u.username || u.email]));

    const daily = new Map<string, { date: string; shares: number; opens: number }>();
    for (let d = days - 1; d >= 0; d--) {
      const key = new Date(Date.now() - d * DAY_MS).toISOString().slice(0, 10);
      daily.set(key, { date: key, shares: 0, opens: 0 });
    }
    for (const r of recent) {
      const row = daily.get(r.createdAt.toISOString().slice(0, 10));
      if (row) {
        row.shares += 1;
        row.opens += r.openCount;
      }
    }
    const shares = totals._count;
    const opens = totals._sum.openCount ?? 0;
    return {
      totals: { shares, opens, opensPerShare: shares ? Math.round((opens / shares) * 100) / 100 : 0 },
      byChannel: byChannel.map((c) => ({ channel: c.channel, shares: c._count, opens: c._sum.openCount ?? 0 })),
      daily: [...daily.values()],
      top: top.map((t) => ({ token: t.token, channel: t.channel, openCount: t.openCount, look: t.look, sharedBy: userById.get(t.sharedBy) ?? "—", createdAt: t.createdAt })),
    };
  }
}
