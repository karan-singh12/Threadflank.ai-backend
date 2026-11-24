import { isIP } from 'net';

/**
 * True for a public https URL. Blocks the server from being pointed at itself or the private network
 * (localhost, 10/8, 172.16/12, 192.168/16, link-local and cloud metadata, carrier-grade NAT, IPv6
 * loopback/ULA/link-local, *.internal). Used wherever a URL from outside makes the server fetch something.
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  const v = isIP(host);
  if (v === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  } else if (v === 6) {
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host.startsWith('::ffff:')) return false;
  }
  return true;
}

/**
 * fetch() that follows at most `maxRedirects` redirects itself, checking every hop with
 * isPublicHttpsUrl, so a public URL can't bounce the server onto a private address.
 */
export async function fetchPublic(url: string, init: RequestInit & { maxRedirects?: number } = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= (init.maxRedirects ?? 3); hop++) {
    if (!isPublicHttpsUrl(current)) throw new Error('That address is not a public https:// link.');
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects.');
}
