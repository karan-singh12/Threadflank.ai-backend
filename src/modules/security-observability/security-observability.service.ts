import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  ThreatCategory,
  ThreatSeverity,
  SecurityEvent,
  SecurityMetrics,
  IncomingRequestTelemetry,
} from "./security-observability.types";

const MAX_MEMORY_EVENTS = 500;

// High-speed regex detectors
const PATTERNS = {
  SQLI: /(\b(union\s+select|select\s+.*\s+from|insert\s+into|update\s+.*\s+set|delete\s+from|drop\s+table|alter\s+table|create\s+table|information_schema|waitfor\s+delay|sleep\s*\(\s*\d+\s*\)|benchmark\s*\()\b|--|;\s*--|'\s*or\s*'1'='1|"\s*or\s*"1"="1|'\s*or\s*1=1|"\s*or\s*1=1|\b1=1\b)/i,
  ENV_SECRETS: /(\/\.env|\.env\b|\/service-account\.json|\/firebase-key\.json|\/firebase-adminsdk\.json|\/credentials\.json|\/gcp-credentials\.json|\/gcp-key\.json|\/gcp-sa\.json|\/aws\/\.env|\/docker\/\.env)/i,
  VCS: /(\/\.git|\/\.svn|\/\.hg)/i,
  WORDPRESS_CMS: /(wp-includes|wp-admin|wp-content|xmlrpc\.php|wlwmanifest\.xml|phpinfo|\.php\b)/i,
  XSS: /(<script|javascript:|onerror\s*=|onload\s*=|onclick\s*=|document\.cookie)/i,
  PATH_TRAVERSAL: /(\.\.\/|\.\.\\)/,
  COMMAND_INJECTION: /(;\s*(cat|ls|id|whoami|curl|wget)\b|\|\s*(cat|ls|id|whoami)\b|\$\(whoami\)|\$\(id\))/i,
  BOT_PAYLOAD: /(need_fuck|eval\(|base64_decode)/i,
  BOT_USER_AGENT: /(sqlmap|nikto|nmap|acunetix|masscan|zgrab|python-requests|wget|curl)/i,
};

@Injectable()
export class SecurityObservabilityService {
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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Passive inspection of every request finishing through Fastify onResponse.
   * Completely non-blocking and safe.
   */
  async recordRequest(telemetry: IncomingRequestTelemetry): Promise<void> {
    try {
      const { ip, method, url, statusCode, responseTime, userAgent, query, body } = telemetry;
      const now = new Date();
      const nowIso = now.toISOString();

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
        return; // Normal benign request
      }

      const { category, severity, reason, payloadSnippet } = threat;

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
        action: "OBSERVED", // Always observed, never blocked
      };

      // Add to in-memory buffer (newest first)
      this.events.unshift(event);
      if (this.events.length > MAX_MEMORY_EVENTS) {
        this.events.pop();
      }

      // Update counters
      this.totalRecordedThreats++;
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
      mode: "OBSERVATION",
      totalThreats: this.totalRecordedThreats,
      threatsToday: threatsToday || this.totalRecordedThreats,
      threatsLastHour,
      categoryBreakdown: { ...this.categoryCounts },
      topAttackingIps,
      recentEvents: this.events.slice(0, 50),
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

