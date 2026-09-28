import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { AppService } from "./app.service";
import { SkipThrottle } from "./common/decorators/skip-throttle.decorator";

@ApiTags("Health")
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: "API Root status & index" })
  getRoot() {
    return {
      service: "Threadflank API",
      status: "running",
      version: process.env.API_VERSION || "1.0.0",
      docs: "/api/docs",
      health: "/api/health",
    };
  }

  @SkipThrottle()
  @Get(["health", "api/health"])
  @ApiOperation({ summary: "Detailed health status of services (PostgreSQL, Redis, System Memory, Uptime)" })
  @ApiResponse({ status: 200, description: "Detailed health status returned" })
  async getHealth() {
    return this.appService.getHealthStatus();
  }

  @SkipThrottle()
  @Get(["health/live", "api/health/live"])
  @ApiOperation({ summary: "Liveness probe for Docker / Kubernetes" })
  @ApiResponse({ status: 200, description: "Application process is running" })
  getLiveness() {
    return this.appService.getLivenessStatus();
  }

  @SkipThrottle()
  @Get(["health/ready", "api/health/ready"])
  @ApiOperation({ summary: "Readiness probe verifying database connectivity" })
  @ApiResponse({ status: 200, description: "Database is connected and ready" })
  @ApiResponse({ status: 503, description: "Database is disconnected or unreachable" })
  async getReadiness() {
    const status = await this.appService.getReadinessStatus();
    if (!status.ready) {
      throw new ServiceUnavailableException(status);
    }
    return status;
  }
}
