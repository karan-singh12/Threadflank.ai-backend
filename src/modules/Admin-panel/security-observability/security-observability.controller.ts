import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import * as net from "net";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminRole } from "@prisma/client";
import { AdminAuthGuard } from "../admin-auth/guards/admin-auth.guard";
import { AdminRolesGuard } from "../admin-auth/guards/admin-roles.guard";
import { AdminRoles } from "../../../common/decorators/admin-roles.decorator";
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

  @Get("stats")
  @ApiOperation({ summary: "Durable block/threat totals (today, all-time, daily series)" })
  async getStats(@Query("days") days?: string) {
    const d = Math.min(Math.max(parseInt(days || "14", 10) || 14, 1), 90);
    return { message: "Security stats fetched", data: await this.securityService.getStats(d) };
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

  @Get("bans")
  @ApiOperation({ summary: "List currently banned IPs" })
  async listBans() {
    return { message: "Active IP bans fetched", data: this.securityService.listBans() };
  }

  @Post("bans")
  @ApiOperation({ summary: "Manually ban an IP (default 24h)" })
  async ban(@Body() body: { ip?: string; reason?: string; hours?: number }) {
    const ip = (body?.ip || "").trim();
    if (!net.isIP(ip)) throw new BadRequestException("A valid IPv4/IPv6 address is required");
    const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 24 * 365);
    return {
      message: "IP banned",
      data: this.securityService.banIp(ip, (body.reason || "Manual ban by admin").substring(0, 200), "MANUAL", hours * 3_600_000),
    };
  }

  @Delete("bans/:ip")
  @ApiOperation({ summary: "Lift a ban and reset the IP's offense history" })
  async unban(@Param("ip") ip: string) {
    return { message: "IP unbanned", data: this.securityService.unbanIp(ip) };
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

