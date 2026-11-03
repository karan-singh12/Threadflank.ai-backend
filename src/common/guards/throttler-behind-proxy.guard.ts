import { Injectable } from "@nestjs/common";
import { ThrottlerException, ThrottlerGuard } from "@nestjs/throttler";
import { getClientIp } from "../utils/client-ip.util";

/**
 * Extends the default ThrottlerGuard to correctly read the real client IP
 * when the app is behind a reverse proxy (NGINX, Cloudflare, etc.).
 * See getClientIp for how the address is resolved (spoof-resistant).
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return getClientIp(req);
  }

  /** A real HttpException, so clients get a 429 they can back off from instead of a generic 500. */
  protected async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException("Too many requests. Please slow down and try again later.");
  }
}
