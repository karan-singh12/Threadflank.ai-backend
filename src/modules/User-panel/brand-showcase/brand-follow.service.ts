import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppLogger } from '../../../shared/logger/logger.service';

/** Following a brand, and telling followers and the waitlist when a drop goes live. */
@Injectable()
export class BrandFollowService {
  private readonly logger = new AppLogger();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async liveBrand(slug: string) {
    const brand = await this.prisma.brand.findFirst({ where: { slug, isDeleted: false, status: 'ACTIVE' }, select: { id: true } });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  /** Idempotent: following twice leaves one follow. */
  async follow(slug: string, userId: string) {
    const brand = await this.liveBrand(slug);
    await this.prisma.brandFollow.upsert({ where: { brandId_userId: { brandId: brand.id, userId } }, create: { brandId: brand.id, userId }, update: {} });
    return { following: true, followers: await this.count(brand.id) };
  }

  async unfollow(slug: string, userId: string) {
    const brand = await this.liveBrand(slug);
    await this.prisma.brandFollow.deleteMany({ where: { brandId: brand.id, userId } });
    return { following: false, followers: await this.count(brand.id) };
  }

  count(brandId: string) {
    return this.prisma.brandFollow.count({ where: { brandId } });
  }

  async isFollowing(brandId: string, userId?: string) {
    if (!userId) return false;
    return (await this.prisma.brandFollow.count({ where: { brandId, userId } })) > 0;
  }

  /** Brands the shopper follows, newest follow first. */
  async mine(userId: string) {
    const rows = await this.prisma.brandFollow.findMany({
      where: { userId, brand: { isDeleted: false, status: 'ACTIVE' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { brand: { select: { id: true, name: true, slug: true, logoUrl: true } } },
    });
    return rows.map((r) => ({ id: r.brand.id, name: r.brand.name, slug: r.brand.slug, logo: r.brand.logoUrl ?? '' }));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cron() {
    try {
      const n = await this.announceLaunches();
      if (n > 0) this.logger.info('BrandFollowService', `Announced ${n} drop launch(es)`);
    } catch (e) {
      this.logger.error('BrandFollowService', 'Drop launch announcements failed', e);
    }
  }

  /**
   * Tells the waitlist and the brand's followers that a drop is live. Each drop is claimed with one
   * conditional update first, so two server instances never send it twice. Drops that went live more
   * than a day ago (e.g. created before this existed) are marked done without messaging anyone.
   */
  async announceLaunches(now = new Date()): Promise<number> {
    const stale = new Date(now.getTime() - 86_400_000);
    await this.prisma.brandDrop.updateMany({ where: { notifiedAt: null, launchDate: { lt: stale } }, data: { notifiedAt: now } });
    const due = await this.prisma.brandDrop.findMany({
      where: { notifiedAt: null, launchDate: { lte: now }, brand: { isDeleted: false, status: 'ACTIVE' } },
      select: { id: true, title: true, collectionName: true, brand: { select: { id: true, name: true, slug: true } } },
      take: 50,
    });
    let announced = 0;
    for (const drop of due) {
      const claim = await this.prisma.brandDrop.updateMany({ where: { id: drop.id, notifiedAt: null }, data: { notifiedAt: now } });
      if (claim.count === 0) continue;
      const [waiting, followers] = await Promise.all([
        this.prisma.dropWaitlistEntry.findMany({ where: { dropId: drop.id }, select: { userId: true } }),
        this.prisma.brandFollow.findMany({ where: { brandId: drop.brand.id }, select: { userId: true } }),
      ]);
      const link = `/brands/${drop.brand.slug}`;
      const data = { brandId: drop.brand.id, dropId: drop.id };
      // Waitlist first, with the stronger message; a follower who is also waiting gets only that one.
      const waitIds = new Set(waiting.map((w) => w.userId));
      await this.notifications.createMany([...waitIds], { type: 'DROP_LIVE', title: `${drop.title} is live`, body: `${drop.brand.name} just dropped ${drop.collectionName}. You were on the waitlist.`, link, data });
      await this.notifications.createMany(followers.map((f) => f.userId).filter((id) => !waitIds.has(id)), { type: 'DROP_LIVE', title: `${drop.brand.name} just dropped ${drop.collectionName}`, body: drop.title, link, data });
      announced++;
    }
    return announced;
  }
}
