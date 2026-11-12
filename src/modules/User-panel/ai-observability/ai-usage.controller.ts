import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminAuthGuard } from '../../Admin-panel/admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../../Admin-panel/admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../../common/interfaces/admin-jwt-payload.interface';
import { AiObservabilityService, type EvalInput, type ExternalUsageInput, type LogFilter } from '../../Admin-panel/ai-observability/ai-observability.service';

@ApiTags('AI usage')
@ApiBearerAuth()
@Controller('ai/usage')
@UseGuards(AuthGuard)
export class AiUsageController {
  constructor(private readonly ai: AiObservabilityService) {}

  @Post()
  @ApiOperation({ summary: 'Web app reports an AI run it made (Replicate try-on, twin, poses, video…) for the signed-in user' })
  async report(@Req() req: any, @Body() body: ExternalUsageInput) {
    return { data: await this.ai.report(req.user.userId, body) };
  }

  @Get('me')
  async mine(@Req() req: any, @Query('days') days?: string) {
    return { data: await this.ai.userDetail(req.user.userId, days) };
  }
}
