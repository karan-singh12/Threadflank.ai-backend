import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BrandPostsService } from '../../modules/brand-posts/brand-posts.service';
import { AppLogger } from '../../shared/logger/logger.service';

/** Flips due SCHEDULED brand posts to PUBLISHED. Mirrors LogCleanupProcessor's shape. */
@Injectable()
export class BrandPostSchedulerProcessor {
  private readonly logger = new AppLogger();

  constructor(private readonly brandPostsService: BrandPostsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduledPublish() {
    try {
      const count = await this.brandPostsService.publishDueScheduledPosts();
      if (count > 0) {
        this.logger.info('BrandPostSchedulerProcessor', `Published ${count} scheduled brand post(s)`);
      }
    } catch (error) {
      this.logger.error('BrandPostSchedulerProcessor', 'Failed to publish scheduled brand posts', error);
    }
  }
}
