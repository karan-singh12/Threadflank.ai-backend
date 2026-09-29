import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    const method = req.method || "GET";
    const url = req.originalUrl || req.url || "/";
    const startTime = Date.now();
    const userId = req.user?.userId || req.user?.id;
    const userTag = userId ? ` [User: ${userId}]` : "";

    // Terminal log for incoming request
    console.log(
      `\x1b[90m[${new Date().toLocaleTimeString()}]\x1b[0m \x1b[36m-->\x1b[0m \x1b[1m${method}\x1b[0m ${url}${userTag}`
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = res.statusCode || 200;

          // Colorize status code
          let statusColor = "\x1b[32m"; // Green
          if (statusCode >= 300 && statusCode < 400) statusColor = "\x1b[36m"; // Cyan
          if (statusCode >= 400 && statusCode < 500) statusColor = "\x1b[33m"; // Yellow
          if (statusCode >= 500) statusColor = "\x1b[31m"; // Red

          console.log(
            `\x1b[90m[${new Date().toLocaleTimeString()}]\x1b[0m \x1b[32m<--\x1b[0m \x1b[1m${method}\x1b[0m ${url} ${statusColor}${statusCode}\x1b[0m \x1b[90m(${duration}ms)\x1b[0m`
          );
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          const statusCode = err.status || err.statusCode || 500;
          console.log(
            `\x1b[90m[${new Date().toLocaleTimeString()}]\x1b[0m \x1b[31m<--\x1b[0m \x1b[1m${method}\x1b[0m ${url} \x1b[31m${statusCode}\x1b[0m \x1b[90m(${duration}ms)\x1b[0m \x1b[31m[Failed: ${err.message || "Error"}]\x1b[0m`
          );
        },
      })
    );
  }
}
