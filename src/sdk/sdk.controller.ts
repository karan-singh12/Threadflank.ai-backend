import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SdkService } from './sdk.service';
import { OccasionPlannerRequestDto } from './dto/occasion-planner-request.dto';
import { RagQueryRequestDto } from './dto/rag-query-request.dto';
import { WardrobeCombosRequestDto } from './dto/wardrobe-combos-request.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { MESSAGES } from '../common/constants/messages.constant';

/**
 * Thin demo/production surface for the GenAI SDK, guarded by the EXISTING
 * end-user AuthGuard (these are end-user-facing features — Occasion Planner
 * is PRD §4.4). Other backend modules call SdkService directly via DI instead
 * of going through HTTP.
 */
@ApiTags('GenAI SDK')
@ApiBearerAuth()
@Controller('sdk')
@UseGuards(AuthGuard)
export class SdkController {
  constructor(private readonly sdk: SdkService) {}

  @Post('occasion-planner')
  @ApiOperation({ summary: 'Tool-calling agent: builds outfit recommendations from the user\'s own wardrobe' })
  async occasionPlanner(@Body() dto: OccasionPlannerRequestDto, @Req() req: any) {
    const result = await this.sdk.runOccasionPlanner(req.user.userId, dto);
    return { message: MESSAGES.sdk.occasionPlanned, data: result };
  }

  @Post('wardrobe-combos')
  @ApiOperation({ summary: "Proposes new outfits built only from the user's own wardrobe (favours under-used items on request)" })
  async wardrobeCombos(@Body() dto: WardrobeCombosRequestDto, @Req() req: any) {
    const result = await this.sdk.generateWardrobeCombos(req.user.userId, dto);
    return { message: 'Combinations generated', data: result };
  }

  @Post('rag-query')
  @ApiOperation({ summary: 'RAG pipeline: retrieve + answer from ingested content (CMS/brand docs)' })
  async ragQuery(@Body() dto: RagQueryRequestDto, @Req() req: any) {
    const result = await this.sdk.ragQuery(dto.question, {
      namespace: dto.namespace,
      topK: dto.topK,
      requestedBy: req.user.userId,
    });
    return { message: MESSAGES.sdk.ragAnswered, data: result };
  }
}
