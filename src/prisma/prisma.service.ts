import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/chat_db";
    // On Windows "localhost" resolves to ::1 first, and Docker Desktop's IPv6 forwarding can
    // stall long enough to hit the 2s connect timeout below. 127.0.0.1 connects in ~20ms.
    if (/@localhost[:/]/.test(connectionString)) {
      console.warn("[prisma] DATABASE_URL uses 'localhost'; use 127.0.0.1 to avoid slow IPv6 connects and connection timeouts.");
    }
    const pool = new Pool({
      connectionString,
      max: 3, // Limit maximum database connections to avoid pool exhaustion
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000, // Fail fast rather than hanging
    });
    // An idle connection that drops (database restart, network blip) is emitted as a pool
    // "error" event; with no listener Node treats it as fatal and the server exits.
    pool.on("error", (err) => console.warn("[prisma] idle database connection error:", err.message));
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      console.log("Prisma successfully connected to PostgreSQL database.");
    } catch (err: any) {
      console.warn("Prisma connection warning: Database server might be offline.", err.message);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
