import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { PrismaService } from "../../prisma/prisma.service";
import { getClientIp, isPrivateIp } from "../utils/client-ip.util";

// Rate limiting tracking using in-memory map
const requestCounts = new Map<string, { count: number; firstRequest: number }>();

// Deliberately strict and non-global. The old patterns flagged any quote, ';', '&' or '|',
// and the query check ran on JSON.stringify(query), which always contains '"', so every
// request with a query string (and any caption with an apostrophe) was "suspicious".
// Data only reaches Prisma as bound parameters, so a lone quote is not a signal; we look
// for real attack syntax. Probe scoring/banning lives in SecurityObservabilityService.
const SUSPICIOUS_PATTERNS = {
  SQL_INJECTION: /(\bunion\s+(all\s+)?select\b|\bselect\b[\s\S]{1,80}\bfrom\b[\s\S]{0,40}\b(information_schema|pg_catalog)\b|;\s*(drop|alter|truncate)\s+table\b|\b(pg_sleep|benchmark|waitfor\s+delay)\b|'\s*or\s*'?\d+'?\s*=\s*'?\d+|\binformation_schema\b)/i,
  XSS_ATTEMPT: /(<script\b|<iframe\b|javascript:|\bonerror\s*=|\bonload\s*=)/i,
  PATH_TRAVERSAL: /(\.\.\/|\.\.\\|%2e%2e%2f)/i,
  COMMAND_INJECTION: /(;\s*(cat|ls|id|whoami|curl|wget|nc|bash|sh)\b|\$\((whoami|id|curl|wget)|`\s*(whoami|id|curl|wget))/i,
};

@Injectable()
export class TrafficMonitorInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();
    const startTime = Date.now();

    const rawReq = req.raw || req;
    const rawRes = res.raw || res;

    // Get IP
    // Never trust a client-supplied header (the old x-system-ip) for identity
    const ip = getClientIp(req);

    // Get User info (from request if authenticated)
    const userId = req.user?.id || req.user?.userId || req.user?._id;
    const userType = req.user?.role || 'guest';

    // Track request count for rate limiting
    const currentTime = Date.now();
    const requestKey = `${ip}:${Math.floor(currentTime / 60000)}`;

    const existing = requestCounts.get(requestKey);
    if (existing) {
      existing.count++;
    } else {
      requestCounts.set(requestKey, { count: 1, firstRequest: currentTime });
    }

    // Clean old entries
    for (const [key, value] of requestCounts.entries()) {
      if (currentTime - value.firstRequest > 300000) {
        requestCounts.delete(key);
      }
    }

    let suspicious = false;
    const suspicionReasons: string[] = [];

    let urlToCheck: string = req.originalUrl || req.url || '';
    try { urlToCheck = decodeURIComponent(urlToCheck); } catch { /* malformed encoding: check as-is */ }

    if (SUSPICIOUS_PATTERNS.SQL_INJECTION.test(urlToCheck)) {
      suspicious = true;
      suspicionReasons.push('Potential SQL injection attempt detected in URL');
    }
    if (SUSPICIOUS_PATTERNS.XSS_ATTEMPT.test(urlToCheck)) {
      suspicious = true;
      suspicionReasons.push('Potential XSS attempt detected in URL');
    }
    if (SUSPICIOUS_PATTERNS.PATH_TRAVERSAL.test(urlToCheck)) {
      suspicious = true;
      suspicionReasons.push('Path traversal attempt detected');
    }

    // Check body (which is parsed at interceptor stage)
    if (req.body && typeof req.body === 'object') {
      const bodyStr = JSON.stringify(req.body);
      if (SUSPICIOUS_PATTERNS.SQL_INJECTION.test(bodyStr)) {
        suspicious = true;
        suspicionReasons.push('Potential SQL injection attempt detected in request body');
      }
      if (SUSPICIOUS_PATTERNS.XSS_ATTEMPT.test(bodyStr)) {
        suspicious = true;
        suspicionReasons.push('Potential XSS attempt detected in request body');
      }
      if (SUSPICIOUS_PATTERNS.COMMAND_INJECTION.test(bodyStr)) {
        suspicious = true;
        suspicionReasons.push('Potential command injection attempt detected');
      }
    }

    if (existing && existing.count > 120 && !isPrivateIp(ip)) {
      suspicious = true;
      suspicionReasons.push(`High request rate: ${existing.count} requests per minute`);
    }

    const userAgent = req.headers?.['user-agent'] || '';
    const suspiciousUserAgents = ['curl', 'wget', 'python-requests', 'nikto', 'sqlmap', 'nmap'];
    if (suspiciousUserAgents.some(agent => userAgent.toLowerCase().includes(agent))) {
      suspicious = true;
      suspicionReasons.push(`Suspicious user agent: ${userAgent}`);
    }

    const logTraffic = async (statusCode: number, errorMessage?: string) => {
      try {
        const responseTime = Date.now() - startTime;
        
        let finalSuspicious = suspicious;
        const finalReasons = [...suspicionReasons];

        if (statusCode >= 400) {
          // 401/403 alone is routine (expired token, wrong role); repeated probing is
          // caught by the security module's strike scoring instead.
          if (statusCode >= 500) {
            finalReasons.push('Server error triggered');
          }
        }

        const validUserType = ['admin', 'user', 'guest'].includes(userType?.toLowerCase())
          ? userType.toLowerCase()
          : 'guest';

        // Prepare request body for logging
        const isSensitive = ['/login', '/password', '/otp', '/reset'].some(endpoint => 
          (req.originalUrl || req.url || '').includes(endpoint)
        );
        let sanitizedBody: any = null;
        if (!isSensitive && req.body) {
          sanitizedBody = { ...req.body };
          const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'creditCard'];
          for (const field of sensitiveFields) {
            if (sanitizedBody[field]) {
              sanitizedBody[field] = '***REDACTED***';
            }
          }
        }

        // Insert into traffic_logs using Prisma Client ORM
        await this.prisma.trafficLog.create({
          data: {
            ip: ip.substring(0, 45),
            method: (req.method || 'GET').substring(0, 10),
            url: (req.originalUrl || req.url || '').substring(0, 10000),
            statusCode,
            responseTime,
            userAgent: userAgent ? userAgent.substring(0, 500) : null,
            userId: userId ? String(userId).substring(0, 255) : null,
            userType: validUserType,
            timestamp: new Date(startTime),
            requestBody: sanitizedBody || null,
            errorMessage: errorMessage || null,
            suspicious: finalSuspicious,
            suspicionReasons: finalReasons.length > 0 ? finalReasons : null,
          },
        });

      } catch (error) {
        console.error('Traffic monitoring logging error:', error);
      }
    };

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = res.statusCode || rawRes.statusCode || 200;
          logTraffic(statusCode);
        },
        error: (err) => {
          const statusCode = err.status || err.statusCode || 500;
          const errorMessage = err.message || 'Internal server error';
          logTraffic(statusCode, errorMessage);
        }
      })
    );
  }
}
