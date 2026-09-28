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
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { RedisIoAdapter } from "./common/adapters/redis-io.adapter";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import * as path from "path";

async function bootstrap() {
  console.log("[bootstrap] Starting NestFactory.create...");
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );
  console.log("[bootstrap] NestFactory.create finished.");

  // Register custom Redis adapter for scalable WebSockets
  const redisIoAdapter = new RedisIoAdapter(app);
  const isRedisConnected = await redisIoAdapter.connectToRedis();
  if (isRedisConnected) {
    app.useWebSocketAdapter(redisIoAdapter);
  }

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

  // Set global API prefix
  app.setGlobalPrefix("api");

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
  app.enableCors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders: "Content-Type, Accept, Authorization",
  });

  // Register global interceptor, exception filter, and validation pipe
  app.useGlobalInterceptors(new TransformInterceptor());
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
