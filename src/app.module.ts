import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import Redis from "ioredis";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { CacheModule } from "./cache/cache.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { AdminModule } from "./modules/admin/admin.module";
import { ChatModule } from "./chat/chat.module";
import { RoomsModule } from "./modules/rooms/rooms.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { UploadsModule } from "./modules/uploads/uploads.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { JobsModule } from "./jobs/jobs.module";
import { TrafficMonitorInterceptor } from "./common/interceptors/traffic-monitor.interceptor";
import { ThrottlerBehindProxyGuard } from "./common/guards/throttler-behind-proxy.guard";
import { PostsModule } from "./modules/posts/posts.module";
import { ScheduleModule } from "@nestjs/schedule";
import { WardrobeModule } from "./modules/wardrobe/wardrobe.module";
import { LooksModule } from "./modules/looks/looks.module";
import { TwinModule } from "./modules/twin/twin.module";
import { DrapeModule } from "./modules/drape/drape.module";
import { SdkModule } from "./sdk";
import { AdminAuthModule } from "./modules/admin-auth/admin-auth.module";
import { AdminUsersModule } from "./modules/admin-users/admin-users.module";
import { BrandsModule } from "./modules/brands/brands.module";
import { BrandPostsModule } from "./modules/brand-posts/brand-posts.module";
import { BrandStoriesModule } from "./modules/brand-stories/brand-stories.module";
import { EmailTemplatesModule } from "./modules/email-templates/email-templates.module";
import { CmsModule } from "./modules/cms/cms.module";
import { ContactModule } from "./modules/contact/contact.module";
import { StudioBackgroundsModule } from "./modules/studio-backgrounds/studio-backgrounds.module";
import { TwinCircleModule } from "./modules/twin-circle/twin-circle.module";
import { EventsModule } from "./modules/events/events.module";
import { StylistsModule } from "./modules/stylists/stylists.module";
import { ShareModule } from "./modules/share/share.module";
import { AiObservabilityModule } from "./modules/ai-observability/ai-observability.module";
import { AdminOpsModule } from "./modules/admin-ops/admin-ops.module";
import { WidgetModule } from "./modules/widget/widget.module";



@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: async () => {
        const host = process.env.REDIS_HOST || "127.0.0.1";
        const port = parseInt(process.env.REDIS_PORT ?? "6379", 10);

        let storage: any = undefined;

        // Verify connection with a quick ping
        const checkClient = new Redis({
          host,
          port,
          connectTimeout: 1000,
          maxRetriesPerRequest: 0,
        });
        checkClient.on("error", () => { });

        try {
          await checkClient.ping();

          // Redis is online! Create a real client
          const client = new Redis({
            host,
            port,
            retryStrategy(times) {
              return Math.min(times * 100, 3000); // retry delay
            },
          });
          client.on("error", () => { });
          storage = new ThrottlerStorageRedisService(client);
        } catch {
          // Redis offline: fall back to built-in in-memory store
        } finally {
          checkClient.disconnect();
        }

        // Every throttler listed here applies to every route, so there is one global
        // limit. Stricter per-controller limits (auth: 10/min, uploads: 20/min) are
        // set with @Throttle({ default: … }) on those controllers.
        return {
          throttlers: [
            {
              name: "default",
              ttl: 60_000,
              limit: 100,
            },
          ],
          storage,
        };
      },
    }),


    // ─── Task Scheduling ─────────────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ─── Feature Modules ─────────────────────────────────────────────────────
    PrismaModule,
    CacheModule,
    AuthModule,
    UsersModule,
    AdminModule,
    ChatModule,
    RoomsModule,
    NotificationsModule,
    UploadsModule,
    PaymentsModule,
    JobsModule,
    PostsModule,
    WardrobeModule,
    LooksModule,
    TwinModule,
    DrapeModule,

    // ─── GenAI SDK + Admin Panel ─────────────────────────────────────────────
    SdkModule,
    AdminAuthModule,
    AdminUsersModule,
    BrandsModule,
    BrandPostsModule,
    BrandStoriesModule,
    EmailTemplatesModule,
    CmsModule,
    ContactModule,
    StudioBackgroundsModule,
    TwinCircleModule,
    EventsModule,
    StylistsModule,
    ShareModule,
    AiObservabilityModule,
    AdminOpsModule,
    WidgetModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TrafficMonitorInterceptor,
    },
  ],
})
export class AppModule { }

