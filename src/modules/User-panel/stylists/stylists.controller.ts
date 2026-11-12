import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminRole, StylistVerificationStatus } from "@prisma/client";
import { AuthGuard } from "../../../common/guards/auth.guard";
import { AdminAuthGuard } from "../../Admin-panel/admin-auth/guards/admin-auth.guard";
import { AdminRolesGuard } from "../../Admin-panel/admin-auth/guards/admin-roles.guard";
import { AdminRoles } from "../../../common/decorators/admin-roles.decorator";
import { CurrentAdmin } from "../../../common/decorators/current-admin.decorator";
import { AuthenticatedAdmin } from "../../../common/interfaces/admin-jwt-payload.interface";
import { StylistsService, type StylistApplication } from "./stylists.service";

@ApiTags("Stylists")
@ApiBearerAuth()
@Controller("stylists")
@UseGuards(AuthGuard)
export class StylistsController {
  constructor(private readonly stylists: StylistsService) {}

  @Get("me")
  async me(@Req() req: any) {
    return { data: await this.stylists.mine(req.user.userId) };
  }

  @Put("me")
  async apply(@Req() req: any, @Body() body: StylistApplication) {
    return { message: "Stylist profile saved", data: await this.stylists.apply(req.user.userId, body ?? {}) };
  }

  @Get("queue")
  async queue(@Req() req: any) {
    return { data: await this.stylists.queue(req.user.userId) };
  }

  @Get("looks/:lookId/comments")
  async comments(@Req() req: any, @Param("lookId") lookId: string) {
    return { data: await this.stylists.comments(req.user.userId, lookId) };
  }

  @Post("looks/:lookId/comments")
  async comment(@Req() req: any, @Param("lookId") lookId: string, @Body() body: { comment: string }) {
    return { message: "Comment posted", data: await this.stylists.comment(req.user.userId, lookId, body?.comment) };
  }

  @Delete("comments/:id")
  async deleteComment(@Req() req: any, @Param("id") id: string) {
    return { data: await this.stylists.deleteOwnComment(req.user.userId, id) };
  }
}
