import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminRole } from "@prisma/client";
import { AuthGuard } from "../../../common/guards/auth.guard";
import { AdminAuthGuard } from "../admin-auth/guards/admin-auth.guard";
import { AdminRolesGuard } from "../admin-auth/guards/admin-roles.guard";
import { AdminRoles } from "../../../common/decorators/admin-roles.decorator";
import { ShareService } from "../../User-panel/share/share.service";

@ApiTags("Admin Panel — Share analytics")
@ApiBearerAuth()
@Controller("admin-panel/shares")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class AdminShareController {
  constructor(private readonly share: ShareService) {}

  @Get("stats")
  async stats(@Query("days") days?: string) {
    return { message: "Share stats fetched", data: await this.share.adminStats(Math.min(90, Math.max(7, Number(days) || 30))) };
  }
}
