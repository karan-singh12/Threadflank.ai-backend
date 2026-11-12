import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminRole } from "@prisma/client";
import { AuthGuard } from "../../../common/guards/auth.guard";
import { AdminAuthGuard } from "../../Admin-panel/admin-auth/guards/admin-auth.guard";
import { AdminRolesGuard } from "../../Admin-panel/admin-auth/guards/admin-roles.guard";
import { AdminRoles } from "../../../common/decorators/admin-roles.decorator";
import { ShareService } from "./share.service";

@ApiTags("Share cards")
@Controller("share")
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async create(@Req() req: any, @Body() body: { lookId: string; channel: string }) {
    return { data: await this.share.create(req.user.userId, body?.lookId, body?.channel) };
  }

  @Get("mine")
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async mine(@Req() req: any) {
    return { data: await this.share.mine(req.user.userId) };
  }

  /** Public — used by the share landing page and the card image renderer. */
  @Get(":token")
  async resolve(@Param("token") token: string) {
    return { data: await this.share.resolve(token) };
  }

  /** Public — counted once per visit by the share landing page. */
  @Post(":token/open")
  async open(@Param("token") token: string) {
    return { data: await this.share.open(token) };
  }
}
