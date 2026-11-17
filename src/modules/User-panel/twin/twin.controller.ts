import { Controller, Get, Put, Post, Body, UseGuards, Req, UsePipes, ValidationPipe } from "@nestjs/common";
import { TwinService, TwinProfileInput } from "./twin.service";
import { TwinGenerateDto } from "./dto/twin-generate.dto";
import { AuthGuard } from "../../../common/guards/auth.guard";
import { CreditsService } from "../payments/credits.service";

/** Your own selfie, body details and persistent twin (circle members keep theirs on the circle). */
@Controller("twin")
@UseGuards(AuthGuard)
export class TwinController {
  constructor(
    private readonly twinService: TwinService,
    private readonly credits: CreditsService,
  ) {}

  /**
   * Builds the twin from a selfie: a clean portrait and a full-body photo, saved on the profile.
   * The first build on an account is free, so it doesn't use up the free try-ons. After that each
   * generated image costs 1 credit, taken first and given back if generation fails.
   */
  @Post("generate")
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async generate(@Req() req: any, @Body() dto: TwinGenerateDto) {
    const userId = req.user.userId;
    const firstBuild = !(await this.credits.hasTransaction(userId, "TWIN"));
    const cost = firstBuild ? 0 : (dto.part ?? "both") === "both" ? 2 : 1;
    const profile = await this.credits.charge(userId, cost, "TWIN", () => this.twinService.generate(userId, dto));
    if (firstBuild) await this.credits.recordFree(userId, "TWIN", "First twin build (free)");
    return { success: true, data: { ...profile, creditsLeft: await this.credits.balance(userId) } };
  }

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
