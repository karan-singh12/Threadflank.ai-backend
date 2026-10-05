import { Controller, Get, Put, Body, UseGuards, Req } from "@nestjs/common";
import { TwinService, TwinProfileInput } from "./twin.service";
import { AuthGuard } from "../../common/guards/auth.guard";

/** Your own selfie and body details (circle members keep theirs on the circle). */
@Controller("twin")
@UseGuards(AuthGuard)
export class TwinController {
  constructor(private readonly twinService: TwinService) {}

  @Get()
  async find(@Req() req: any) {
    const userId = req.user.userId;
    const profile = await this.twinService.find(userId);
    return { success: true, data: profile };
  }

  @Put()
  async upsert(@Req() req: any, @Body() body: TwinProfileInput) {
    const userId = req.user.userId;
    const profile = await this.twinService.upsert(userId, body);
    return { success: true, data: profile };
  }
}
