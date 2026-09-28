import { SkipThrottle as SkipThrottler } from "@nestjs/throttler";

/**
 * Marks a route or controller to skip global throttling.
 * Use on public health-check endpoints, webhooks, etc.
 * (Delegates to @nestjs/throttler, which only honours its own metadata keys.)
 *
 * @example
 * @SkipThrottle()
 * @Get('health')
 * healthCheck() { return 'ok'; }
 */
export const SkipThrottle = () => SkipThrottler({ default: true });
