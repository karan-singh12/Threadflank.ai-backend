import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "crypto";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let error = "InternalServerError";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      
      if (typeof res === "string") {
        message = res;
        error = exception.name;
      } else if (typeof res === "object" && res !== null) {
        message = (res as any).message || (res as any).error || message;
        error = (res as any).error || exception.name;
      }
    } else {
      error = (exception as any)?.name || "UnhandledError";
      message = exception instanceof Error ? exception.message : String(exception);
    }
    // If message is an array (e.g. from class-validator), convert to single string
    const formattedMessage = Array.isArray(message)
      ? message.join(", ")
      : message;

    // Sanitize request body for debugging in terminal
    let sanitizedBody: any = undefined;
    if (request?.body && typeof request?.body === "object") {
      try {
        sanitizedBody = { ...request.body };
        const sensitiveKeys = ["password", "token", "secret", "apiKey", "creditCard", "refreshToken"];
        for (const k of sensitiveKeys) {
          if (k in sanitizedBody) sanitizedBody[k] = "***REDACTED***";
        }
      } catch {}
    }

    const userId = request?.user?.userId || request?.user?.id || "anonymous";
    const stack = exception instanceof Error ? exception.stack : undefined;

    // Vivid terminal logging for all catch-time errors
    console.error(
      `\n\x1b[41m\x1b[37m[API ERROR CAUGHT]\x1b[0m \x1b[31m${request?.method} ${request?.url} -> HTTP ${status} (${error})\x1b[0m\n` +
      `  \x1b[1mTime:\x1b[0m    ${new Date().toISOString()}\n` +
      `  \x1b[1mMessage:\x1b[0m ${formattedMessage}\n` +
      `  \x1b[1mUser:\x1b[0m    ${userId}\n` +
      (sanitizedBody ? `  \x1b[1mBody:\x1b[0m    ${JSON.stringify(sanitizedBody)}\n` : "") +
      (stack ? `  \x1b[90m${stack}\x1b[0m\n` : "")
    );

    // Build the errors array matching Express ValidationError if we have array messages (like validation errors)
    let errors: any[] | undefined = undefined;
    if (Array.isArray(message)) {
      errors = message.map((msg) => {
        const field = typeof msg === "string" ? msg.split(" ")[0] : "";
        return {
          field,
          message: msg,
        };
      });
    }

    const requestId = request?.id || request?.headers?.["x-request-id"] || randomUUID();
    const apiVersion = process.env.API_VERSION || "1.0.0";

    // Fastify and Express both support response.status().send()
    response.status(status).send({
      success: false,
      statusCode: status,
      message: formattedMessage,
      error: error,
      errors: errors,
      meta: {
        requestId,
        version: apiVersion,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
