import * as dotenv from "dotenv";
dotenv.config();

// Some framework hooks (e.g. WebSocket connect/disconnect) are called without being
// awaited. A promise that fails there must not take down every user's session, so
// log it instead of letting Node exit.
process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled promise rejection:", reason);
});

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { RedisIoAdapter } from "./common/adapters/redis-io.adapter";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import * as path from "path";
import { Readable } from "stream";
import { SecurityObservabilityService } from "./modules/Admin-panel/security-observability/security-observability.service";
import { getClientIp } from "./common/utils/client-ip.util";

async function bootstrap() {
  console.log("[bootstrap] Starting NestFactory.create...");
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Drape sends twins and garment photos inline as data URIs (up to 6 people with
    // several pieces each), well past Fastify's 1 MB default.
    new FastifyAdapter({
      bodyLimit: 30 * 1024 * 1024,
      // Slowloris / hung-connection protection
      connectionTimeout: 120_000,
      keepAliveTimeout: 65_000,
      // Generous: mobile clients upload up to 100 MB over slow links
      requestTimeout: 300_000,
    })
  );
  console.log("[bootstrap] NestFactory.create finished.");

  // Passive Security & Bot Observability hook (0ms latency, zero blocking):
  const securityService = app.get(SecurityObservabilityService);
  const fastify = app.getHttpAdapter().getInstance();

  // IP blocking is intentionally off for now: bot/flood protection will sit in front of the API (Cloudflare).
  // Browser access is limited by the CORS_ORIGINS allowlist below. The passive telemetry hook further down still logs threats.

  // Baseline security headers (the API has no use for framing, sniffing or referrers)
  fastify.addHook("onSend", async (request: any, reply: any, payload: any) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Resource-Policy", "cross-origin"); // media is embedded by the web/mobile apps
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    // Swagger UI needs inline scripts/styles, so only lock down the JSON API surface
    if (!request.raw?.url?.startsWith("/api/docs")) {
      reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    }
    return payload;
  });

  fastify.addHook("onResponse", async (request: any, reply: any) => {
    try {
      const ip = getClientIp(request);

      securityService.recordRequest({
        ip,
        method: request.method,
        url: request.raw?.url || request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime || 0,
        userAgent: request.headers?.["user-agent"] || "",
        query: request.query,
        body: request.body,
      });
    } catch {
      // Never break request lifecycle
    }
  });

  // Register custom Redis adapter for scalable WebSockets
  const redisIoAdapter = new RedisIoAdapter(app);
  const isRedisConnected = await redisIoAdapter.connectToRedis();
  if (isRedisConnected) {
    app.useWebSocketAdapter(redisIoAdapter);
  }

  // Razorpay signs the exact webhook body, so keep the raw bytes for that one route
  // (as req.rawBody) before Fastify parses the JSON.
  app.getHttpAdapter().getInstance().addHook("preParsing", async (request: any, _reply: any, payload: any) => {
    if (!request.url?.startsWith("/api/billing/razorpay/webhook")) return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    request.rawBody = Buffer.concat(chunks);
    const replay = Readable.from([request.rawBody]) as Readable & { receivedEncodedLength?: number };
    replay.receivedEncodedLength = request.rawBody.length;
    return replay;
  });

  // Register fastify multipart parser
  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024,
    },
  });

  // Register fastify static to serve uploads in public directory
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), "public"),
    prefix: "/public/",
    decorateReply: false,
  });

  // Set global API prefix (while excluding root and health checks for orchestrators & uptime monitors)
  app.setGlobalPrefix("api", {
    exclude: ["", "health", "health/(.*)", "api/health", "api/health/(.*)"],
  });

  // Swagger/OpenAPI docs — existing controllers already carry @ApiTags/@ApiOperation
  // decorators; this just exposes them (and everything new) at /api/docs.
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Threadflank API")
    .setDescription("Outfit Checker / Threadflank backend API")
    .setVersion(process.env.API_VERSION || "1.0.0")
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, swaggerDocument);

  // Enable CORS
  // Set CORS_ORIGINS="https://app.threadflank.com,https://admin.threadflank.com" to lock this
  // down. Unset keeps the previous allow-all behaviour so deploys don't break unannounced.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    // x-widget-*: the embeddable try-on (on brands' stores) identifies itself with these on /widget/tryon.
    allowedHeaders: "Content-Type, Accept, Authorization, X-Widget-Key, X-Widget-Origin",
    maxAge: 86400,
  });

  // Register global interceptor, exception filter, and validation pipe
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );

  const PORT = process.env.PORT || process.env.API_PORT || 3003;

  await app.listen(PORT, "0.0.0.0");
  console.log(`NestJS Fastify server running on http://localhost:${PORT}`);
}

bootstrap();
// Server reloaded for discover endpoints
