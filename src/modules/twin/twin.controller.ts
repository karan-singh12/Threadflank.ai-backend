import { Controller, Get, Put, Post, Body, UseGuards, Req } from "@nestjs/common";
import { TwinService, TwinProfileInput, GenerateTwinDto } from "./twin.service";
import { AuthGuard } from "../../common/guards/auth.guard";

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

  @Post("generate")
  async generateTwin(@Req() req: any, @Body() body: GenerateTwinDto) {
    const userId = req.user.userId;
    const result = await this.twinService.generateAndPersist(userId, body);
    return { success: true, data: result };
  }
}
