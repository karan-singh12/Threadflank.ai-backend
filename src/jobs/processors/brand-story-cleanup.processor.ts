import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BrandStoriesService } from '../../modules/brand-stories/brand-stories.service';
import { AppLogger } from '../../shared/logger/logger.service';

/** Purges brand stories that expired more than 7 days ago. Active/expired-but-recent
 * stories are already filtered out at query time — this just keeps the table lean. */
@Injectable()
export class BrandStoryCleanupProcessor {
  private readonly logger = new AppLogger();

  constructor(private readonly brandStoriesService: BrandStoriesService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleStoryCleanup() {
    try {
      const count = await this.brandStoriesService.purgeExpired();
      if (count > 0) {
        this.logger.info('BrandStoryCleanupProcessor', `Purged ${count} long-expired brand story(ies)`);
      }
    } catch (error) {
      this.logger.error('BrandStoryCleanupProcessor', 'Failed to purge expired brand stories', error);
    }
  }
}
