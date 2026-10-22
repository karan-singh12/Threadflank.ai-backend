import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppLogger } from '../../shared/logger/logger.service';

/** Periodically hits the server's own liveness endpoint (/health/live). It checks only
 * that the HTTP server is up and answering — it deliberately does not touch the database
 * or Redis. Set SERVER_URL (e.g. the public Render URL) to ping through the public
 * address; otherwise it pings localhost. */
@Injectable()
export class ServerHealthProcessor {
  private readonly logger = new AppLogger();

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleServerHealthCheck() {
    const base = (process.env.SERVER_URL || `http://127.0.0.1:${process.env.PORT || process.env.API_PORT || 3003}`).replace(/\/+$/, '');
    const url = `${base}/health/live`;
    const start = Date.now();

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        this.logger.warn('ServerHealthProcessor', `Server health check returned ${res.status}`, { url, latencyMs });
        return;
      }
      this.logger.debug('ServerHealthProcessor', 'Server is alive', { url, latencyMs });
    } catch (error) {
      this.logger.error('ServerHealthProcessor', `Server health check failed for ${url}`, error);
    }
  }
}
