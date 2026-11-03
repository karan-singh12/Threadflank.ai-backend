/**
 * Resolves the real client IP behind reverse proxies.
 *
 * The leftmost X-Forwarded-For entry is whatever the client chose to send, so trusting it
 * lets an attacker dodge per-IP limits (or get someone else's IP banned). Each trusted proxy
 * appends the address it saw, so we count TRUST_PROXY_HOPS entries from the right.
 * Default is 1 (a single edge proxy such as Railway / Cloudflare / NGINX); set 0 when the
 * app is exposed directly.
 */
export function getClientIp(req: Record<string, any>): string {
  const hops = Math.max(0, parseInt(process.env.TRUST_PROXY_HOPS ?? "1", 10) || 0);
  const socketIp = req.socket?.remoteAddress || req.raw?.socket?.remoteAddress || req.ip || "unknown";

  if (hops === 0) return normalizeIp(socketIp);

  const header = req.headers?.["x-forwarded-for"];
  if (typeof header === "string" && header.length > 0) {
    const chain = header.split(",").map((s) => s.trim()).filter(Boolean);
    if (chain.length > 0) {
      return normalizeIp(chain[Math.max(0, chain.length - hops)]);
    }
  }
  const realIp = req.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp) return normalizeIp(realIp.trim());
  return normalizeIp(socketIp);
}

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, "").substring(0, 45);
}

/** Loopback / private ranges are never auto-banned (health checks, internal services, dev). */
export function isPrivateIp(ip: string): boolean {
  return (
    ip === "unknown" ||
    ip === "::1" ||
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    // 100.64.0.0/10 carrier-grade NAT: Railway's internal proxy hops (the 100.64.0.x in Reports)
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^f[cd][0-9a-f]{2}:/i.test(ip) ||
    ip.startsWith("fe80:")
  );
}
