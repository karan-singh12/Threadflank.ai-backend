import { Controller, Get, Post, Param, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../common/guards/auth.guard";
import { NotificationsService } from "./notifications.service";

@ApiTags("Notifications")
@ApiBearerAuth()
@Controller("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(@Req() req: any, @Query("limit") limit?: string) {
    return { data: await this.notifications.list(req.user.userId, Number(limit) || 30) };
  }

  @Post("read-all")
  async readAll(@Req() req: any) {
    await this.notifications.markAllRead(req.user.userId);
    return { message: "Notifications marked as read" };
  }

  @Post(":id/read")
  async read(@Req() req: any, @Param("id") id: string) {
    await this.notifications.markRead(req.user.userId, id);
    return { message: "Notification marked as read" };
  }
}
