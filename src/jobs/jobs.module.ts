import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { LogCleanupProcessor } from "./processors/log-cleanup.processor";
import { BackgroundJobsProcessor } from "./processors/background-jobs.processor";
import { BackgroundJobsService } from "./queues/background-jobs.service";
import { BrandPostSchedulerProcessor } from "./processors/brand-post-scheduler.processor";
import { BrandStoryCleanupProcessor } from "./processors/brand-story-cleanup.processor";
import { PrismaModule } from "../prisma/prisma.module";
import { BrandPostsModule } from "../modules/brand-posts/brand-posts.module";
import { BrandStoriesModule } from "../modules/brand-stories/brand-stories.module";

function getRedisConnectionOptions() {
  const redisUrlStr = process.env.REDIS_URL;
  if (redisUrlStr) {
    try {
      const parsed = new URL(redisUrlStr);
      const options: any = {
        host: parsed.hostname,
        port: parseInt(parsed.port || "6379", 10),
        maxRetriesPerRequest: null,
      };

      if (parsed.username) {
        options.username = decodeURIComponent(parsed.username);
      }
      if (parsed.password) {
        options.password = decodeURIComponent(parsed.password);
      }

      // Render/Upstash secure Redis links start with rediss://
      if (parsed.protocol === "rediss:") {
        options.tls = {
          rejectUnauthorized: false,
        };
      }
      return options;
    } catch (error) {
      // If parsing fails, fall back
    }
  }

  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = parseInt(process.env.REDIS_PORT ?? "6379", 10);
  const password = process.env.REDIS_PASSWORD || undefined;
  const useTls = process.env.REDIS_TLS === "true";

  const options: any = {
    host,
    port,
    password,
    maxRetriesPerRequest: null,
  };

  if (useTls) {
    options.tls = {
      rejectUnauthorized: false,
    };
  }

  return options;
}

@Module({
  imports: [
    PrismaModule,
    BrandPostsModule,
    BrandStoriesModule,
    // Initialize BullModule root connection
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: getRedisConnectionOptions(),
      }),
    }),
    // Register background tasks queue
    BullModule.registerQueue({
      name: "background-jobs",
    }),
  ],
  providers: [
    LogCleanupProcessor,
    BackgroundJobsProcessor,
    BackgroundJobsService,
    BrandPostSchedulerProcessor,
    BrandStoryCleanupProcessor,
  ],
  exports: [
    BackgroundJobsService,
  ],
})
export class JobsModule { }
