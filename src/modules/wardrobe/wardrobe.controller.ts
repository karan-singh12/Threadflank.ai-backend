import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req, Query } from "@nestjs/common";
import { WardrobeService } from "./wardrobe.service";
import { AuthGuard } from "../../common/guards/auth.guard";

@Controller("wardrobe")
@UseGuards(AuthGuard)
export class WardrobeController {
  constructor(private readonly wardrobeService: WardrobeService) {}

  @Post()
  async create(
    @Req() req: any,
    @Body() body: { name: string; brand?: string; category: string; image: string; color?: string; tags?: string[]; costPaid?: number }
  ) {
    const userId = req.user.userId;
    const item = await this.wardrobeService.create(userId, body);
    return { success: true, data: item };
  }

  @Get()
  async findAll(@Req() req: any) {
    const userId = req.user.userId;
    const items = await this.wardrobeService.findAll(userId);
    return { success: true, data: items };
  }

  // Static routes must stay above ":id" so they aren't captured as an id.
  @Get("analytics")
  async analytics(@Req() req: any) {
    return { success: true, data: await this.wardrobeService.analytics(req.user.userId) };
  }

  @Get("similar")
  async similar(@Req() req: any, @Query() query: { category?: string; color?: string; name?: string }) {
    return { success: true, data: await this.wardrobeService.similar(req.user.userId, query) };
  }

  @Get(":id")
  async findOne(@Req() req: any, @Param("id") id: string) {
    const userId = req.user.userId;
    const item = await this.wardrobeService.findOne(id, userId);
    return { success: true, data: item };
  }

  @Get(":id/wears")
  async wears(@Req() req: any, @Param("id") id: string) {
    return { success: true, data: await this.wardrobeService.wearHistory(id, req.user.userId) };
  }

  @Post(":id/worn")
  async markWorn(@Req() req: any, @Param("id") id: string, @Body() body: { wornAt?: string; lookId?: string; eventId?: string }) {
    return { success: true, data: await this.wardrobeService.markWorn(id, req.user.userId, body ?? {}) };
  }

  @Delete(":id/worn")
  async undoWear(@Req() req: any, @Param("id") id: string) {
    return { success: true, data: await this.wardrobeService.undoWear(id, req.user.userId) };
  }

  @Put(":id")
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { name?: string; brand?: string; category?: string; image?: string; color?: string; tags?: string[]; costPaid?: number | null }
  ) {
    const userId = req.user.userId;
    const item = await this.wardrobeService.update(id, userId, body);
    return { success: true, data: item };
  }

  @Delete(":id")
  async remove(@Req() req: any, @Param("id") id: string) {
    const userId = req.user.userId;
    const result = await this.wardrobeService.remove(id, userId);
    return { success: true, ...result };
  }
}
