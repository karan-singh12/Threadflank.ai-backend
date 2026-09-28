import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../common/guards/auth.guard";
import { TwinCircleService, type BorrowInput, type ProfileMemberInput } from "./twin-circle.service";

@ApiTags("Twin Circle")
@ApiBearerAuth()
@Controller("circle")
@UseGuards(AuthGuard)
export class TwinCircleController {
  constructor(private readonly circles: TwinCircleService) {}

  @Get()
  async mine(@Req() req: any) {
    return { data: await this.circles.getMine(req.user.userId) };
  }

  @Post("members")
  async addProfile(@Req() req: any, @Body() body: ProfileMemberInput) {
    return { message: "Member added", data: await this.circles.addProfile(req.user.userId, body ?? {}) };
  }

  @Post("invites")
  async invite(@Req() req: any, @Body() body: { userId: string; relation?: string }) {
    return { message: "Invite sent", data: await this.circles.inviteFriend(req.user.userId, body?.userId, body?.relation) };
  }

  @Post("invites/:memberId/respond")
  async respond(@Req() req: any, @Param("memberId") memberId: string, @Body() body: { accept: boolean }) {
    return { data: await this.circles.respondInvite(req.user.userId, memberId, Boolean(body?.accept)) };
  }

  @Put("members/:memberId")
  async update(@Req() req: any, @Param("memberId") memberId: string, @Body() body: ProfileMemberInput) {
    return { message: "Member updated", data: await this.circles.updateMember(req.user.userId, memberId, body ?? {}) };
  }

  @Delete("members/:memberId")
  async remove(@Req() req: any, @Param("memberId") memberId: string) {
    return { message: "Member removed", data: await this.circles.removeMember(req.user.userId, memberId) };
  }

  @Post(":circleId/leave")
  async leave(@Req() req: any, @Param("circleId") circleId: string) {
    return { message: "You left the circle", data: await this.circles.leave(req.user.userId, circleId) };
  }

  @Get("wardrobe/:userId")
  async wardrobe(@Req() req: any, @Param("userId") userId: string) {
    return { data: await this.circles.memberWardrobe(req.user.userId, userId) };
  }

  @Get("borrow")
  async borrows(@Req() req: any) {
    return { data: await this.circles.listBorrows(req.user.userId) };
  }

  @Post("borrow")
  async borrow(@Req() req: any, @Body() body: BorrowInput) {
    return { message: "Request sent", data: await this.circles.createBorrow(req.user.userId, body) };
  }

  @Post("borrow/:id/:action")
  async borrowAction(@Req() req: any, @Param("id") id: string, @Param("action") action: "accept" | "decline" | "returned" | "cancel") {
    return { data: await this.circles.respondBorrow(req.user.userId, id, action) };
  }
}
