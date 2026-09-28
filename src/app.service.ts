import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { RedisService } from "./cache/redis.service";

export interface SystemHealth {
  status: "ok" | "degraded" | "error";
  service: string;
  version: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
  memory: {
    rss: string;
    heapTotal: string;
    heapUsed: string;
  };
  checks: {
    database: {
      status: "connected" | "disconnected";
      latencyMs: number;
      error?: string;
    };
    redis: {
      status: "connected" | "disconnected";
      latencyMs: number;
      error?: string;
    };
  };
}

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  private formatBytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  async getHealthStatus(): Promise<SystemHealth> {
    const mem = process.memoryUsage();

    // Check Database connectivity & latency
    let dbStatus: "connected" | "disconnected" = "disconnected";
    let dbLatencyMs = 0;
    let dbError: string | undefined;

    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = "connected";
      dbLatencyMs = Date.now() - dbStart;
    } catch (err: any) {
      dbStatus = "disconnected";
      dbLatencyMs = Date.now() - dbStart;
      dbError = err?.message || "Database ping failed";
    }

    // Check Redis connectivity & latency
    let redisStatus: "connected" | "disconnected" = "disconnected";
    let redisLatencyMs = 0;
    let redisError: string | undefined;

    const redisStart = Date.now();
    try {
      if (this.redisService) {
        const client = this.redisService.getClient();
        const pingPromise = client.ping();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Redis ping timeout (1s)")), 1000),
        );
        await Promise.race([pingPromise, timeoutPromise]);
        redisStatus = "connected";
        redisLatencyMs = Date.now() - redisStart;
      } else {
        redisError = "RedisService not initialized";
      }
    } catch (err: any) {
      redisStatus = "disconnected";
      redisLatencyMs = Date.now() - redisStart;
      redisError = err?.message || "Redis ping failed";
    }

    let overallStatus: "ok" | "degraded" | "error" = "ok";
    if (dbStatus !== "connected") {
      overallStatus = "error";
    } else if (redisStatus !== "connected") {
      overallStatus = "degraded";
    }

    return {
      status: overallStatus,
      service: "Threadflank API",
      version: process.env.API_VERSION || "1.0.0",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rss: this.formatBytes(mem.rss),
        heapTotal: this.formatBytes(mem.heapTotal),
        heapUsed: this.formatBytes(mem.heapUsed),
      },
      checks: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
          ...(dbError ? { error: dbError } : {}),
        },
        redis: {
          status: redisStatus,
          latencyMs: redisLatencyMs,
          ...(redisError ? { error: redisError } : {}),
        },
      },
    };
  }

  getLivenessStatus() {
    return {
      status: "alive",
      service: "Threadflank API",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  async getReadinessStatus() {
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        ready: true,
        service: "Threadflank API",
        database: "connected",
        latencyMs: Date.now() - dbStart,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        ready: false,
        service: "Threadflank API",
        database: "disconnected",
        latencyMs: Date.now() - dbStart,
        error: err?.message || "Database unreachable",
        timestamp: new Date().toISOString(),
      };
    }
  }
}
