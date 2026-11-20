import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { ColumnInfo, SQL_STATEMENT_TIMEOUT_MS, SQL_TABLE_ALLOWLIST } from './sql-schema';

/**
 * The only connection generated SQL ever runs on.
 *
 * Three things make it safe, and they are independent of each other: the statement is wrapped in
 * a READ ONLY transaction (Postgres refuses a write inside one, whatever the guard missed), it
 * carries a statement timeout, and the transaction is always rolled back. Point
 * READONLY_DATABASE_URL at a role with SELECT on nothing but the allow-listed tables and the
 * boundary is enforced by the database itself; without it this still cannot write, but a bug in
 * the guard could read a table it should not, so production should always set it.
 */
@Injectable()
export class ReadOnlyDb implements OnModuleDestroy {
  private readonly logger = new Logger(ReadOnlyDb.name);
  private pool: Pool | null = null;
  private columnsCache: ColumnInfo[] | null = null;

  /** True when a dedicated restricted role is configured, rather than borrowing the app's own. */
  get isolated(): boolean {
    return Boolean(process.env.READONLY_DATABASE_URL);
  }

  get configured(): boolean {
    return Boolean(process.env.READONLY_DATABASE_URL || process.env.DATABASE_URL);
  }

  private getPool(): Pool {
    if (this.pool) return this.pool;

    const connectionString = process.env.READONLY_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('No database URL configured for the read-only query path.');
    }
    if (!this.isolated) {
      this.logger.warn('READONLY_DATABASE_URL is not set; generated SQL will run as the application role (read-only transaction only).');
    }

    // Deliberately tiny: this path must never be able to starve the application's own pool.
    this.pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 3_000,
    });
    this.pool.on('error', (err) => this.logger.warn(`idle read-only connection error: ${err.message}`));
    return this.pool;
  }

  /**
   * Runs one already-guarded statement. Every exit path rolls back, so nothing a query did —
   * including a temp table a clever prompt talked the model into — survives the call.
   */
  async run<T = Record<string, unknown>>(sql: string, timeoutMs = SQL_STATEMENT_TIMEOUT_MS): Promise<{ rows: T[]; rowCount: number }> {
    const client: PoolClient = await this.getPool().connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${Number(timeoutMs) * 2}`);
      const result = await client.query(sql);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
    } finally {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* the transaction is already gone (timeout, dropped connection) */
      }
      client.release();
    }
  }

  /**
   * The allow-listed columns as the database actually has them. Read once and kept, since the
   * schema only changes on deploy, and it is this — not a hand-written list — that the model is
   * shown, so the prompt cannot drift away from the real tables.
   */
  async columns(): Promise<ColumnInfo[]> {
    if (this.columnsCache) return this.columnsCache;

    const { rows } = await this.run<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY(ARRAY[${SQL_TABLE_ALLOWLIST.map((t) => `'${t}'`).join(',')}])
        ORDER BY table_name, ordinal_position
        LIMIT 2000`,
    );

    this.columnsCache = rows.map((r) => ({ table: r.table_name, column: r.column_name, dataType: r.data_type }));
    return this.columnsCache;
  }

  async onModuleDestroy() {
    await this.pool?.end().catch(() => undefined);
  }
}
