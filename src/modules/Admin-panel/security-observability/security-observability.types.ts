export type ThreatCategory =
  | "ENV_PROBE"
  | "VCS_PROBE"
  | "WORDPRESS_SCAN"
  | "SQL_INJECTION"
  | "XSS_ATTEMPT"
  | "PATH_TRAVERSAL"
  | "COMMAND_INJECTION"
  | "MALICIOUS_PAYLOAD"
  | "SUSPICIOUS_USER_AGENT"
  | "RATE_LIMIT_SPIKE";

export type ThreatSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface SecurityEvent {
  id: string;
  timestamp: string;
  ip: string;
  method: string;
  url: string;
  statusCode: number;
  responseTime: number;
  userAgent?: string;
  category: ThreatCategory;
  severity: ThreatSeverity;
  reason: string;
  payloadSnippet?: string;
  action: "OBSERVED" | "BLOCKED";
}

export interface BannedIp {
  ip: string;
  reason: string;
  category: ThreatCategory | "MANUAL";
  bannedAt: string;
  expiresAt: string;
  /** How many times this IP has been banned (drives escalating ban length). */
  offenses: number;
  blockedRequests: number;
}

export interface SecurityMetrics {
  mode: "OBSERVATION" | "ENFORCEMENT";
  activeBans: number;
  blockedRequests: number;
  totalThreats: number;
  threatsToday: number;
  threatsLastHour: number;
  categoryBreakdown: Record<ThreatCategory, number>;
  topAttackingIps: Array<{
    ip: string;
    count: number;
    lastSeen: string;
    topCategory: ThreatCategory;
  }>;
  recentEvents: SecurityEvent[];
}

export interface IncomingRequestTelemetry {
  ip: string;
  method: string;
  url: string;
  statusCode: number;
  responseTime: number;
  userAgent?: string;
  query?: any;
  body?: any;
}

