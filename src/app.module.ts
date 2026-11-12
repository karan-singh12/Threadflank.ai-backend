import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import Redis from "ioredis";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { CacheModule } from "./cache/cache.module";
import { AuthModule } from "./modules/User-panel/auth/auth.module";
import { UsersModule } from "./modules/User-panel/users/users.module";
import { AdminModule } from "./modules/Admin-panel/admin/admin.module";
import { ChatModule } from "./modules/User-panel/chat/chat.module";
import { RoomsModule } from "./modules/User-panel/rooms/rooms.module";
import { NotificationsModule } from "./modules/User-panel/notifications/notifications.module";
import { UploadsModule } from "./modules/User-panel/uploads/uploads.module";
import { PaymentsModule } from "./modules/User-panel/payments/payments.module";
import { JobsModule } from "./jobs/jobs.module";
import { TrafficMonitorInterceptor } from "./common/interceptors/traffic-monitor.interceptor";
import { ThrottlerBehindProxyGuard } from "./common/guards/throttler-behind-proxy.guard";
import { PostsModule } from "./modules/User-panel/posts/posts.module";
import { ScheduleModule } from "@nestjs/schedule";
import { WardrobeModule } from "./modules/User-panel/wardrobe/wardrobe.module";
import { LooksModule } from "./modules/User-panel/looks/looks.module";
import { TwinModule } from "./modules/User-panel/twin/twin.module";
import { DrapeModule } from "./modules/User-panel/drape/drape.module";
import { SdkModule } from "./sdk";
import { AdminAuthModule } from "./modules/Admin-panel/admin-auth/admin-auth.module";
import { AdminUsersModule } from "./modules/Admin-panel/admin-users/admin-users.module";
import { BrandsModule } from "./modules/Admin-panel/brands/brands.module";
import { BrandShowcaseModule } from "./modules/User-panel/brand-showcase/brand-showcase.module";
import { BrandPortalModule } from "./modules/Admin-panel/brand-portal/brand-portal.module";
import { BrandPostsModule } from "./modules/Admin-panel/brand-posts/brand-posts.module";
import { BrandStoriesModule } from "./modules/Admin-panel/brand-stories/brand-stories.module";
import { EmailTemplatesModule } from "./modules/Admin-panel/email-templates/email-templates.module";
import { CmsModule } from "./modules/Admin-panel/cms/cms.module";
import { ContactModule } from "./modules/Admin-panel/contact/contact.module";
import { StudioBackgroundsModule } from "./modules/Admin-panel/studio-backgrounds/studio-backgrounds.module";
import { TwinCircleModule } from "./modules/User-panel/twin-circle/twin-circle.module";
import { EventsModule } from "./modules/User-panel/events/events.module";
import { StylistsModule } from "./modules/User-panel/stylists/stylists.module";
import { ShareModule } from "./modules/User-panel/share/share.module";
import { AiObservabilityModule } from "./modules/Admin-panel/ai-observability/ai-observability.module";
import { AdminOpsModule } from "./modules/Admin-panel/admin-ops/admin-ops.module";
import { WidgetModule } from "./modules/Admin-panel/widget/widget.module";
import { SecurityObservabilityModule } from "./modules/Admin-panel/security-observability/security-observability.module";
import { BrandPanelModule } from "./modules/Brand-panel/brand-panel.module";



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
    BrandPortalModule,
    BrandShowcaseModule,
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
    SecurityObservabilityModule,
    BrandPanelModule,
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

