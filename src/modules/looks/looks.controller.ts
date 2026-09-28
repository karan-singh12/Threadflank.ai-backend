import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req } from "@nestjs/common";
import { LooksService, type LookUpdateInput, type PoseVariant } from "./looks.service";
import { AuthGuard } from "../../common/guards/auth.guard";
import { AuthenticatedUser } from "../../common/interfaces/jwt-payload.interface";

@Controller("looks")
@UseGuards(AuthGuard)
export class LooksController {
  constructor(private readonly looksService: LooksService) {}

  @Post()
  async create(
    @Req() req: any,
    @Body() body: { name: string; occasion: string; image: string; pieces: string[]; gradient?: string; poseVariants?: PoseVariant[]; videoUrl?: string }
  ) {
    const userId = (req.user as AuthenticatedUser).userId;
    const look = await this.looksService.create(userId, body);
    return { success: true, data: look };
  }

  @Get()
  async findAll(@Req() req: any) {
    const userId = (req.user as AuthenticatedUser).userId;
    const looks = await this.looksService.findAll(userId);
    return { success: true, data: looks };
  }

  @Get(":id")
  async findOne(@Req() req: any, @Param("id") id: string) {
    return { success: true, data: await this.looksService.findOne(id, (req.user as AuthenticatedUser).userId) };
  }

  @Put(":id")
  async update(@Req() req: any, @Param("id") id: string, @Body() body: LookUpdateInput) {
    return { success: true, data: await this.looksService.update(id, (req.user as AuthenticatedUser).userId, body ?? {}) };
  }

  @Post(":id/review-request")
  async requestReview(@Req() req: any, @Param("id") id: string, @Body() body: { requested?: boolean }) {
    const requested = body?.requested !== false;
    return { success: true, data: await this.looksService.setReviewRequest(id, (req.user as AuthenticatedUser).userId, requested) };
  }

  @Post(":id/like")
  async toggleLike(@Req() req: any, @Param("id") id: string) {
    const userId = (req.user as AuthenticatedUser).userId;
    const look = await this.looksService.toggleLike(id, userId);
    return { success: true, data: look };
  }

  @Delete(":id")
  async remove(@Req() req: any, @Param("id") id: string) {
    const userId = (req.user as AuthenticatedUser).userId;
    const result = await this.looksService.remove(id, userId);
    return { success: true, ...result };
  }
}
