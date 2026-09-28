import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../common/guards/auth.guard";
import { EventsService, type EventInput, type PlanInput } from "./events.service";

@ApiTags("Events")
@ApiBearerAuth()
@Controller("events")
@UseGuards(AuthGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  async list(@Req() req: any) {
    return { data: await this.events.list(req.user.userId) };
  }

  @Post()
  async create(@Req() req: any, @Body() body: EventInput) {
    return { message: "Event created", data: await this.events.create(req.user.userId, body ?? {}) };
  }

  @Get(":id")
  async get(@Req() req: any, @Param("id") id: string) {
    return { data: await this.events.get(req.user.userId, id) };
  }

  @Put(":id")
  async update(@Req() req: any, @Param("id") id: string, @Body() body: EventInput) {
    return { message: "Event updated", data: await this.events.update(req.user.userId, id, body ?? {}) };
  }

  @Delete(":id")
  async remove(@Req() req: any, @Param("id") id: string) {
    return { message: "Event deleted", data: await this.events.remove(req.user.userId, id) };
  }

  @Put(":id/plans/:planId")
  async setPlan(@Req() req: any, @Param("id") id: string, @Param("planId") planId: string, @Body() body: PlanInput) {
    return { data: await this.events.setPlan(req.user.userId, id, planId, body ?? {}) };
  }

  @Post(":id/plans/:planId/suggest")
  async suggest(@Req() req: any, @Param("id") id: string, @Param("planId") planId: string) {
    return { data: await this.events.suggest(req.user.userId, id, planId) };
  }

  @Post(":id/grwm")
  async grwm(@Req() req: any, @Param("id") id: string, @Body() body: { live?: boolean }) {
    return { data: await this.events.setGrwm(req.user.userId, id, body?.live !== false) };
  }
}
