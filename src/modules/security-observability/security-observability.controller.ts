import { Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminRole } from "@prisma/client";
import { AdminAuthGuard } from "../admin-auth/guards/admin-auth.guard";
import { AdminRolesGuard } from "../admin-auth/guards/admin-roles.guard";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { SecurityObservabilityService } from "./security-observability.service";
import { ThreatCategory } from "./security-observability.types";

@ApiTags("Admin Panel — Security Observability")
@ApiBearerAuth()
@Controller("admin-panel/security")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class SecurityObservabilityController {
  constructor(private readonly securityService: SecurityObservabilityService) {}

  @Get("metrics")
  @ApiOperation({ summary: "Get live security metrics, category breakdown, and top attacking IPs" })
  async getMetrics() {
    return {
      message: "Security metrics fetched",
      data: this.securityService.getMetrics(),
    };
  }

  @Get("events")
  @ApiOperation({ summary: "Get filtered security and bot probe events" })
  async getEvents(
    @Query("category") category?: ThreatCategory,
    @Query("ip") ip?: string,
    @Query("search") search?: string,
    @Query("limit") limit?: string
  ) {
    return {
      message: "Security events fetched",
      data: this.securityService.getEvents({
        category,
        ip,
        search,
        limit: limit ? parseInt(limit, 10) : 100,
      }),
    };
  }

  @Post("clear")
  @ApiOperation({ summary: "Reset security observation event buffer" })
  async clear() {
    return {
      message: "Security buffer reset",
      data: this.securityService.clearBuffer(),
    };
  }
}

