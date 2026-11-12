import { Injectable, Logger, OnModuleInit, OnApplicationShutdown } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { isPrivateIp } from "../../../common/utils/client-ip.util";
import {
  ThreatCategory,
  ThreatSeverity,
  SecurityEvent,
  BannedIp,
  SecurityMetrics,
  IncomingRequestTelemetry,
} from "./security-observability.types";

const MAX_MEMORY_EVENTS = 500;

// ─── Enforcement tuning (all overridable via env) ────────────────────────────
const envInt = (name: string, fallback: number) => {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const ENFORCE = (process.env.SECURITY_ENFORCE ?? "true") !== "false";
/** Hard ceiling for ANY request from one IP (matched or not), per minute. */
const HARD_RATE_LIMIT_PER_MIN = envInt("SECURITY_HARD_RATE_LIMIT", 300);
/** Strike points within STRIKE_WINDOW_MS that trigger an automatic ban. */
const BAN_THRESHOLD = envInt("SECURITY_BAN_THRESHOLD", 20);
const STRIKE_WINDOW_MS = envInt("SECURITY_STRIKE_WINDOW_MIN", 10) * 60_000;
/** Escalating ban length by repeat offense: 1h → 24h → 7d. */
const BAN_DURATIONS_MS = [3_600_000, 86_400_000, 7 * 86_400_000];
const MAX_TRACKED_IPS = 20_000;
const ALLOWLIST = new Set(
  (process.env.SECURITY_IP_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean)
);

/** Strike points per detected category. Body-only matches score low to limit false-positive bans. */
const STRIKE_WEIGHTS: Record<ThreatCategory, number> = {
  ENV_PROBE: 10,
  VCS_PROBE: 10,
  WORDPRESS_SCAN: 7,
  PATH_TRAVERSAL: 10,
  MALICIOUS_PAYLOAD: 10,
  COMMAND_INJECTION: 5,
  SQL_INJECTION: 4,
  XSS_ATTEMPT: 2,
  RATE_LIMIT_SPIKE: 5,
  SUSPICIOUS_USER_AGENT: 1,
};

// High-speed regex detectors
const PATTERNS = {
  SQLI: /(\b(union\s+select|select\s+.*\s+from|insert\s+into|update\s+.*\s+set|delete\s+from|drop\s+table|alter\s+table|create\s+table|information_schema|waitfor\s+delay|sleep\s*\(\s*\d+\s*\)|benchmark\s*\()\b|['")]\s*--(\s|$)|;\s*--|'\s*or\s*'1'='1|"\s*or\s*"1"="1|'\s*or\s*1=1|"\s*or\s*1=1|\b1=1\b)/i,
  ENV_SECRETS: /(\/\.env|\.env\b|\/\.aws|\/\.ssh|\/\.config\/|\/\.docker|\/\.npmrc|\/\.htpasswd|\/id_rsa|\/(service-?account|sa|key|keyfile|credentials?|secrets?|firebase[\w-]*|gcp[\w-]*|google[\w-]*|aws[\w-]*|application_default_credentials)\.(json|ya?ml|txt|env)\b|\/(config|settings|appsettings|database|docker-compose)\.(json|ya?ml|php|ini|env)\b|\/aws\/\.env|\/docker\/\.env)/i,
  VCS: /(\/\.git|\/\.svn|\/\.hg|\/\.DS_Store)/i,
  WORDPRESS_CMS: /(wp-includes|wp-admin|wp-content|wp-login|xmlrpc\.php|wlwmanifest\.xml|phpinfo|phpmyadmin|\.php\b|\.asp\b|\.aspx\b|\.jsp\b|\.cgi\b|\/cgi-bin\/|\/_profiler|\/_environment|\/server-(info|status)|\/actuator|\/vendor\/phpunit|\.(bak|old|save|swp|orig)$|~$)/i,
  XSS: /(<script|javascript:|onerror\s*=|onload\s*=|onclick\s*=|document\.cookie)/i,
  PATH_TRAVERSAL: /(\.\.\/|\.\.\\)/,
  COMMAND_INJECTION: /(;\s*(cat|ls|id|whoami|curl|wget)\b|\|\s*(cat|ls|id|whoami)\b|\$\(whoami\)|\$\(id\))/i,
  BOT_PAYLOAD: /(need_fuck|eval\(|base64_decode)/i,
  BOT_USER_AGENT: /(sqlmap|nikto|nmap|acunetix|masscan|zgrab|python-requests|wget|curl)/i,
};

@Injectable()
export class SecurityObservabilityService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SecurityObservabilityService.name);

  // In-memory ring buffer of recent suspicious events
  private events: SecurityEvent[] = [];

  // IP sliding window request tracker (ip -> { count, firstSeen })
  private ipWindows = new Map<string, { count: number; firstSeen: number }>();

  // IP to Threat Stats tracker (ip -> { count, lastSeen, categories: Set })
  private ipThreatStats = new Map<string, { count: number; lastSeen: string; topCategory: ThreatCategory }>();

  // Category counts
  private categoryCounts: Record<ThreatCategory, number> = {
    ENV_PROBE: 0,
    VCS_PROBE: 0,
    WORDPRESS_SCAN: 0,
    SQL_INJECTION: 0,
    XSS_ATTEMPT: 0,
    PATH_TRAVERSAL: 0,
    COMMAND_INJECTION: 0,
    MALICIOUS_PAYLOAD: 0,
    SUSPICIOUS_USER_AGENT: 0,
    RATE_LIMIT_SPIKE: 0,
  };

  private totalRecordedThreats = 0;
  private totalBlockedRequests = 0;

  // Active bans (ip -> ban) and offense history that survives expiry so repeat offenders escalate
  private bans = new Map<string, BannedIp>();
  private offenseCounts = new Map<string, number>();
  // Strike points inside the sliding STRIKE_WINDOW_MS (ip -> { points, windowStart })
  private strikes = new Map<string, { points: number; windowStart: number }>();
  // Hard per-IP request ceiling, counted for every request including unmatched routes
  private hardRate = new Map<string, { count: number; windowStart: number }>();

  // Counters not yet flushed to security_daily_stats, and bans/ban-hit counts not yet saved
  private pendingStat = { threats: 0, blockedRequests: 0, bansIssued: 0, categories: {} as Record<string, number> };
  private dirtyBans = new Set<string>();
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Sweep expired state so the maps cannot grow without bound under a distributed scan
    this.timers.push(setInterval(() => this.sweep(), 60_000));
    this.timers.push(setInterval(() => void this.flush(), 30_000));
    this.timers.forEach((t) => t.unref());

    // Restore bans so a deploy/restart doesn't hand the attacker a clean slate
    try {
      const rows = await this.prisma.blockedIp.findMany({ where: { active: true, expiresAt: { gt: new Date() } } });
      for (const r of rows) {
        this.bans.set(r.ip, {
          ip: r.ip,
          reason: r.reason,
          category: r.category as BannedIp["category"],
          bannedAt: r.bannedAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          offenses: r.offenses,
          blockedRequests: r.blockedRequests,
        });
        this.offenseCounts.set(r.ip, r.offenses);
      }
      // Offense history for IPs whose bans already expired, so repeat offenders still escalate
      const past = await this.prisma.blockedIp.findMany({ where: { expiresAt: { lte: new Date() } }, select: { ip: true, offenses: true } });
      for (const r of past) if (!this.offenseCounts.has(r.ip)) this.offenseCounts.set(r.ip, r.offenses);
      if (rows.length) this.logger.log(`Restored ${rows.length} active IP ban(s) from database`);
    } catch (err) {
      this.logger.warn(`Could not restore IP bans (table missing? run prisma db push): ${err}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.timers.forEach(clearInterval);
    await this.flush();
  }

  /** Writes pending counters + changed bans to the DB. Never throws. */
  private async flush(): Promise<void> {
    const stat = this.pendingStat;
    this.pendingStat = { threats: 0, blockedRequests: 0, bansIssued: 0, categories: {} };
    const dirty = Array.from(this.dirtyBans);
    this.dirtyBans.clear();

    try {
      if (stat.threats || stat.blockedRequests || stat.bansIssued) {
        const date = new Date(new Date().toISOString().slice(0, 10)); // UTC midnight
        const existing = await this.prisma.securityDailyStat.findUnique({ where: { date } });
        const cats: Record<string, number> = { ...((existing?.categories as Record<string, number>) || {}) };
        for (const [k, v] of Object.entries(stat.categories)) cats[k] = (cats[k] || 0) + v;
        await this.prisma.securityDailyStat.upsert({
          where: { date },
          create: { date, threats: stat.threats, blockedRequests: stat.blockedRequests, bansIssued: stat.bansIssued, categories: cats },
          update: {
            threats: { increment: stat.threats },
            blockedRequests: { increment: stat.blockedRequests },
            bansIssued: { increment: stat.bansIssued },
            categories: cats,
          },
        });
      }
      for (const ip of dirty) {
        const b = this.bans.get(ip);
        if (!b) continue;
        const data = {
          reason: b.reason.substring(0, 500),
          category: b.category,
          offenses: b.offenses,
          blockedRequests: b.blockedRequests,
          bannedAt: new Date(b.bannedAt),
          expiresAt: new Date(b.expiresAt),
          active: true,
        };
        await this.prisma.blockedIp.upsert({ where: { ip }, create: { ip, ...data }, update: data });
      }
    } catch (err) {
      // Put the counters back so a transient DB error doesn't lose them
      this.pendingStat.threats += stat.threats;
      this.pendingStat.blockedRequests += stat.blockedRequests;
      this.pendingStat.bansIssued += stat.bansIssued;
      for (const [k, v] of Object.entries(stat.categories)) this.pendingStat.categories[k] = (this.pendingStat.categories[k] || 0) + v;
      dirty.forEach((ip) => this.dirtyBans.add(ip));
      this.logger.debug(`Security flush failed: ${err}`);
    }
  }

  // ─── Enforcement ───────────────────────────────────────────────────────────

  /**
   * Called from a Fastify onRequest hook, before routing, auth or body parsing.
   * Cheap O(1) map lookups only. Returns the status to reject with, or null to allow.
   */
  checkRequest(ip: string): { status: 403 | 429; retryAfterSec: number } | null {
    if (!ENFORCE || isPrivateIp(ip) || ALLOWLIST.has(ip)) return null;

    const ban = this.bans.get(ip);
    if (ban) {
      const remaining = new Date(ban.expiresAt).getTime() - Date.now();
      if (remaining > 0) {
        ban.blockedRequests++;
        this.totalBlockedRequests++;
        this.pendingStat.blockedRequests++;
        this.dirtyBans.add(ip);
        return { status: 403, retryAfterSec: Math.ceil(remaining / 1000) };
      }
      this.bans.delete(ip); // expired
    }

    const now = Date.now();
    const bucket = this.hardRate.get(ip);
    if (!bucket || now - bucket.windowStart >= 60_000) {
      this.hardRate.set(ip, { count: 1, windowStart: now });
      return null;
    }
    bucket.count++;
    if (bucket.count > HARD_RATE_LIMIT_PER_MIN) {
      this.totalBlockedRequests++;
      this.pendingStat.blockedRequests++;
      // Sustained flooding earns a ban; the first overflow only gets a 429
      if (bucket.count === HARD_RATE_LIMIT_PER_MIN * 2) {
        this.addStrike(ip, STRIKE_WEIGHTS.RATE_LIMIT_SPIKE * 2, "RATE_LIMIT_SPIKE", "Sustained request flooding");
      }
      return { status: 429, retryAfterSec: Math.max(1, Math.ceil((60_000 - (now - bucket.windowStart)) / 1000)) };
    }
    return null;
  }

  /** Adds strike points; bans the IP once the windowed total crosses BAN_THRESHOLD. */
  private addStrike(ip: string, points: number, category: ThreatCategory, reason: string): void {
    if (!ENFORCE || isPrivateIp(ip) || ALLOWLIST.has(ip) || this.bans.has(ip)) return;
    const now = Date.now();
    const s = this.strikes.get(ip);
    if (!s || now - s.windowStart > STRIKE_WINDOW_MS) {
      this.strikes.set(ip, { points, windowStart: now });
    } else {
      s.points += points;
    }
    if ((this.strikes.get(ip)?.points ?? 0) >= BAN_THRESHOLD) {
      this.banIp(ip, reason, category);
    }
  }

  banIp(ip: string, reason: string, category: BannedIp["category"] = "MANUAL", durationMs?: number): BannedIp {
    const offenses = (this.offenseCounts.get(ip) || 0) + 1;
    this.offenseCounts.set(ip, offenses);
    const duration =
      durationMs ?? BAN_DURATIONS_MS[Math.min(offenses, BAN_DURATIONS_MS.length) - 1];
    const now = Date.now();
    const ban: BannedIp = {
      ip,
      reason,
      category,
      bannedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + duration).toISOString(),
      offenses,
      blockedRequests: 0,
    };
    this.bans.set(ip, ban);
    this.strikes.delete(ip);
    this.pendingStat.bansIssued++;
    this.dirtyBans.add(ip);
    this.logger.warn(`Auto-banned ${ip} for ${Math.round(duration / 60000)} min (offense #${offenses}): ${reason}`);
    return ban;
  }

  unbanIp(ip: string): { removed: boolean } {
    this.strikes.delete(ip);
    this.offenseCounts.delete(ip);
    this.dirtyBans.delete(ip);
    const removed = this.bans.delete(ip);
    this.prisma.blockedIp.updateMany({ where: { ip }, data: { active: false, offenses: 0 } }).catch(() => {});
    return { removed };
  }

  listBans(): BannedIp[] {
    const now = Date.now();
    return Array.from(this.bans.values())
      .filter((b) => new Date(b.expiresAt).getTime() > now)
      .sort((a, b) => b.bannedAt.localeCompare(a.bannedAt));
  }

  private sweep(): void {
    const now = Date.now();
    for (const [ip, b] of this.bans) if (new Date(b.expiresAt).getTime() <= now) this.bans.delete(ip);
    for (const [ip, s] of this.strikes) if (now - s.windowStart > STRIKE_WINDOW_MS) this.strikes.delete(ip);
    for (const [ip, h] of this.hardRate) if (now - h.windowStart >= 60_000) this.hardRate.delete(ip);
    // Offense history must outlive bans so repeat offenders escalate; only trim when oversized
    if (this.offenseCounts.size > MAX_TRACKED_IPS) this.offenseCounts.clear();
    if (this.ipThreatStats.size > MAX_TRACKED_IPS) this.ipThreatStats.clear();
  }

  /**
   * Passive inspection of every request finishing through Fastify onResponse.
   * Completely non-blocking and safe.
   */
  async recordRequest(telemetry: IncomingRequestTelemetry): Promise<void> {
    try {
      const { ip, method, url, statusCode, responseTime, userAgent, query, body } = telemetry;
      const now = new Date();
      const nowIso = now.toISOString();

      // Already-banned traffic was rejected in onRequest; don't re-log or re-score it
      if (statusCode === 403 && this.bans.has(ip)) return;

      // Rate limit monitoring (requests per minute per IP)
      const currentMinute = Math.floor(Date.now() / 60000);
      const rateKey = `${ip}:${currentMinute}`;
      const rateData = this.ipWindows.get(rateKey) || { count: 0, firstSeen: Date.now() };
      rateData.count++;
      this.ipWindows.set(rateKey, rateData);

      // Clean rate window every ~100 hits
      if (this.ipWindows.size > 2000) {
        const threshold = Date.now() - 120000;
        for (const [k, v] of this.ipWindows.entries()) {
          if (v.firstSeen < threshold) this.ipWindows.delete(k);
        }
      }

      // Check for threat categories
      const threat = this.detectThreat(method, url, query, body, userAgent, rateData.count);
      if (!threat) {
        // Unknown-path guessing: a handful of 404s is normal, dozens is a directory scanner
        if (statusCode === 404) {
          this.addStrike(ip, 1, "WORDPRESS_SCAN", "Excessive 404s (path scanning)");
        }
        return; // Normal benign request
      }

      const { category, severity, reason, payloadSnippet } = threat;

      // Only score probes that did not hit a real route, so a legit 2xx user is not
      // penalised by a loose body-regex false positive.
      const isProbeStatus = statusCode >= 400 || ["ENV_PROBE", "VCS_PROBE", "PATH_TRAVERSAL", "MALICIOUS_PAYLOAD"].includes(category);
      if (isProbeStatus) {
        this.addStrike(ip, STRIKE_WEIGHTS[category], category, `${category}: ${reason}`);
      }
      const nowBanned = this.bans.has(ip);

      const event: SecurityEvent = {
        id: `sec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: nowIso,
        ip,
        method,
        url,
        statusCode,
        responseTime,
        userAgent: userAgent ? userAgent.substring(0, 300) : undefined,
        category,
        severity,
        reason,
        payloadSnippet,
        action: nowBanned ? "BLOCKED" : "OBSERVED",
      };

      // Add to in-memory buffer (newest first)
      this.events.unshift(event);
      if (this.events.length > MAX_MEMORY_EVENTS) {
        this.events.pop();
      }

      // Update counters
      this.totalRecordedThreats++;
      this.pendingStat.threats++;
      this.pendingStat.categories[category] = (this.pendingStat.categories[category] || 0) + 1;
      this.categoryCounts[category] = (this.categoryCounts[category] || 0) + 1;

      // Update IP threat stats
      const ipStat = this.ipThreatStats.get(ip) || { count: 0, lastSeen: nowIso, topCategory: category };
      ipStat.count++;
      ipStat.lastSeen = nowIso;
      ipStat.topCategory = category;
      this.ipThreatStats.set(ip, ipStat);

      // Asynchronously record into Prisma TrafficLog table
      this.persistToTrafficLog(telemetry, event).catch(() => {});
    } catch (err) {
      // Security observer should never throw or break request flow
      this.logger.debug(`Error in security analysis: ${err}`);
    }
  }

  /**
   * Fast rule-based detector
   */
  private detectThreat(
    method: string,
    url: string,
    query: any,
    body: any,
    userAgent?: string,
    reqCountThisMinute: number = 0
  ): { category: ThreatCategory; severity: ThreatSeverity; reason: string; payloadSnippet?: string } | null {
    const rawTarget = url + (query ? " " + JSON.stringify(query) : "");
    const bodyStr = body ? (typeof body === "object" ? JSON.stringify(body) : String(body)) : "";

    // 1. Env & Secrets probe
    if (PATTERNS.ENV_SECRETS.test(url)) {
      return {
        category: "ENV_PROBE",
        severity: "CRITICAL",
        reason: "Probe for exposed environment variables or cloud credentials file",
        payloadSnippet: url,
      };
    }

    // 2. VCS Source Control probe
    if (PATTERNS.VCS.test(url)) {
      return {
        category: "VCS_PROBE",
        severity: "HIGH",
        reason: "Probe for exposed Git, SVN or Mercurial repository metadata",
        payloadSnippet: url,
      };
    }

    // 3. WordPress / CMS scanner
    if (PATTERNS.WORDPRESS_CMS.test(url)) {
      return {
        category: "WORDPRESS_SCAN",
        severity: "MEDIUM",
        reason: "Automated scan looking for vulnerable WordPress, XML-RPC or PHP scripts",
        payloadSnippet: url,
      };
    }

    // 4. SQL Injection in URL/Query or Body
    if (PATTERNS.SQLI.test(rawTarget)) {
      return {
        category: "SQL_INJECTION",
        severity: "CRITICAL",
        reason: "Potential SQL injection attack vector detected in URL/query parameters",
        payloadSnippet: rawTarget.substring(0, 200),
      };
    }
    if (bodyStr && PATTERNS.SQLI.test(bodyStr)) {
      return {
        category: "SQL_INJECTION",
        severity: "CRITICAL",
        reason: "Potential SQL injection attack vector detected in request body",
        payloadSnippet: bodyStr.substring(0, 200),
      };
    }

    // 5. Malicious Bot payload (e.g. {"need_fuck":"yes"})
    if (bodyStr && PATTERNS.BOT_PAYLOAD.test(bodyStr)) {
      return {
        category: "MALICIOUS_PAYLOAD",
        severity: "HIGH",
        reason: "Known malicious scanner exploit signature found in request body",
        payloadSnippet: bodyStr.substring(0, 200),
      };
    }

    // 6. Path Traversal
    if (PATTERNS.PATH_TRAVERSAL.test(rawTarget)) {
      return {
        category: "PATH_TRAVERSAL",
        severity: "HIGH",
        reason: "Directory traversal (../) attempt detected in request path",
        payloadSnippet: rawTarget.substring(0, 200),
      };
    }

    // 7. XSS Attempt
    if (PATTERNS.XSS.test(rawTarget) || (bodyStr && PATTERNS.XSS.test(bodyStr))) {
      return {
        category: "XSS_ATTEMPT",
        severity: "MEDIUM",
        reason: "Potential Cross-Site Scripting (XSS) payload detected",
        payloadSnippet: (rawTarget + " " + bodyStr).substring(0, 200),
      };
    }

    // 8. Command Injection
    if (PATTERNS.COMMAND_INJECTION.test(rawTarget) || (bodyStr && PATTERNS.COMMAND_INJECTION.test(bodyStr))) {
      return {
        category: "COMMAND_INJECTION",
        severity: "CRITICAL",
        reason: "Shell command injection syntax detected",
        payloadSnippet: (rawTarget + " " + bodyStr).substring(0, 200),
      };
    }

    // 9. Rate limit burst
    if (reqCountThisMinute > 60) {
      return {
        category: "RATE_LIMIT_SPIKE",
        severity: "MEDIUM",
        reason: `High request velocity detected (${reqCountThisMinute} req/min from this IP)`,
        payloadSnippet: `${reqCountThisMinute} req/min`,
      };
    }

    // 10. Automated hacking tool User Agent
    if (userAgent && PATTERNS.BOT_USER_AGENT.test(userAgent)) {
      return {
        category: "SUSPICIOUS_USER_AGENT",
        severity: "LOW",
        reason: `Automated security scanner or CLI tool User-Agent: ${userAgent}`,
        payloadSnippet: userAgent,
      };
    }

    return null;
  }

  /**
   * Persist threat event to DB TrafficLog
   */
  private async persistToTrafficLog(
    telemetry: IncomingRequestTelemetry,
    event: SecurityEvent
  ): Promise<void> {
    try {
      await this.prisma.trafficLog.create({
        data: {
          ip: telemetry.ip.substring(0, 45),
          method: (telemetry.method || "GET").substring(0, 10),
          url: telemetry.url.substring(0, 2000),
          statusCode: telemetry.statusCode,
          responseTime: Math.round(telemetry.responseTime),
          userAgent: telemetry.userAgent ? telemetry.userAgent.substring(0, 500) : null,
          timestamp: new Date(),
          requestBody: telemetry.body ? (typeof telemetry.body === "object" ? telemetry.body : { raw: telemetry.body }) : null,
          suspicious: true,
          suspicionReasons: [event.reason, `Category: ${event.category}`, `Severity: ${event.severity}`],
        },
      });
    } catch {
      // In case DB is busy, in-memory buffer still has it
    }
  }

  /**
   * Metrics for the Admin Panel Dashboard
   */
  getMetrics(): SecurityMetrics {
    const oneHourAgo = Date.now() - 3600000;
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const threatsLastHour = this.events.filter(
      (e) => new Date(e.timestamp).getTime() > oneHourAgo
    ).length;

    const threatsToday = this.events.filter(
      (e) => new Date(e.timestamp).getTime() >= todayMidnight.getTime()
    ).length;

    // Top Attacking IPs sorted by count
    const topAttackingIps = Array.from(this.ipThreatStats.entries())
      .map(([ip, data]) => ({
        ip,
        count: data.count,
        lastSeen: data.lastSeen,
        topCategory: data.topCategory,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      mode: ENFORCE ? "ENFORCEMENT" : "OBSERVATION",
      activeBans: this.listBans().length,
      blockedRequests: this.totalBlockedRequests,
      totalThreats: this.totalRecordedThreats,
      threatsToday: threatsToday || this.totalRecordedThreats,
      threatsLastHour,
      categoryBreakdown: { ...this.categoryCounts },
      topAttackingIps,
      recentEvents: this.events.slice(0, 50),
    };
  }

  /**
   * Durable totals ("how many bots did we stop"), unlike getMetrics which resets on restart.
   * Unflushed in-memory counters are added so the numbers are current to the request.
   */
  async getStats(days = 14) {
    const since = new Date(Date.now() - days * 86_400_000);
    const todayKey = new Date().toISOString().slice(0, 10);
    const [rows, totals, uniqueBanned, activeBans] = await Promise.all([
      this.prisma.securityDailyStat.findMany({ where: { date: { gte: since } }, orderBy: { date: "asc" } }),
      this.prisma.securityDailyStat.aggregate({ _sum: { threats: true, blockedRequests: true, bansIssued: true } }),
      this.prisma.blockedIp.count(),
      this.prisma.blockedIp.count({ where: { active: true, expiresAt: { gt: new Date() } } }),
    ]);

    const p = this.pendingStat;
    const daily = rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      threats: r.threats,
      blockedRequests: r.blockedRequests,
      bansIssued: r.bansIssued,
    }));
    const today = daily.find((d) => d.date === todayKey);
    if (today) {
      today.threats += p.threats;
      today.blockedRequests += p.blockedRequests;
      today.bansIssued += p.bansIssued;
    } else {
      daily.push({ date: todayKey, threats: p.threats, blockedRequests: p.blockedRequests, bansIssued: p.bansIssued });
    }
    const t = daily.find((d) => d.date === todayKey)!;

    return {
      today: { threats: t.threats, blockedRequests: t.blockedRequests, bansIssued: t.bansIssued },
      allTime: {
        threats: (totals._sum.threats || 0) + p.threats,
        blockedRequests: (totals._sum.blockedRequests || 0) + p.blockedRequests,
        bansIssued: (totals._sum.bansIssued || 0) + p.bansIssued,
        uniqueBlockedIps: Math.max(uniqueBanned, this.bans.size),
      },
      activeBans: Math.max(activeBans, this.listBans().length),
      daily,
    };
  }

  /**
   * Filtered / Paginated events list
   */
  getEvents(filter?: { category?: ThreatCategory; ip?: string; search?: string; limit?: number }) {
    let result = [...this.events];

    if (filter?.category) {
      result = result.filter((e) => e.category === filter.category);
    }
    if (filter?.ip) {
      result = result.filter((e) => e.ip.includes(filter.ip!));
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (e) =>
          e.url.toLowerCase().includes(q) ||
          e.ip.toLowerCase().includes(q) ||
          e.reason.toLowerCase().includes(q) ||
          (e.payloadSnippet && e.payloadSnippet.toLowerCase().includes(q))
      );
    }

    const limit = filter?.limit || 100;
    return {
      total: result.length,
      events: result.slice(0, limit),
    };
  }

  /**
   * Clear in-memory event buffer if admin desires
   */
  clearBuffer(): { message: string } {
    this.events = [];
    this.totalRecordedThreats = 0;
    for (const key of Object.keys(this.categoryCounts)) {
      this.categoryCounts[key as ThreatCategory] = 0;
    }
    this.ipThreatStats.clear();
    this.ipWindows.clear();
    return { message: "Security observation buffer reset successfully" };
  }
}

