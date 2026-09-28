import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminRole, StylistVerificationStatus } from "@prisma/client";
import { AuthGuard } from "../../common/guards/auth.guard";
import { AdminAuthGuard } from "../admin-auth/guards/admin-auth.guard";
import { AdminRolesGuard } from "../admin-auth/guards/admin-roles.guard";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { CurrentAdmin } from "../../common/decorators/current-admin.decorator";
import { AuthenticatedAdmin } from "../../common/interfaces/admin-jwt-payload.interface";
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

@ApiTags("Admin Panel — Stylists")
@ApiBearerAuth()
@Controller("admin-panel/stylists")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class AdminStylistsController {
  constructor(private readonly stylists: StylistsService) {}

  @Get()
  async list(@Query() query: { status?: string; page?: number; limit?: number; search?: string }) {
    const res = await this.stylists.adminList(query);
    return { message: "Stylists fetched", data: res.data, meta: res.meta };
  }

  @Get("comments")
  async comments(@Query() query: { page?: number; limit?: number }) {
    const res = await this.stylists.adminComments(query);
    return { message: "Stylist comments fetched", data: res.data, meta: res.meta };
  }

  @Delete("comments/:id")
  async deleteComment(@Param("id") id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: "Comment deleted", data: await this.stylists.adminDeleteComment(id, admin) };
  }

  @Post(":id/verify")
  async verify(@Param("id") id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: "Stylist verified", data: await this.stylists.setStatus(id, StylistVerificationStatus.VERIFIED, admin) };
  }

  @Post(":id/reject")
  async reject(@Param("id") id: string, @Body() body: { reason?: string }, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: "Stylist rejected", data: await this.stylists.setStatus(id, StylistVerificationStatus.REJECTED, admin, body?.reason) };
  }

  @Post(":id/suspend")
  async suspend(@Param("id") id: string, @Body() body: { reason?: string }, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: "Stylist suspended", data: await this.stylists.setStatus(id, StylistVerificationStatus.SUSPENDED, admin, body?.reason) };
  }
}
