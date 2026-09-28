import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';
import { AiObservabilityService, type EvalInput, type ExternalUsageInput, type LogFilter } from './ai-observability.service';

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

@ApiTags('Admin Panel — LLM observability')
@ApiBearerAuth()
@Controller('admin-panel/ai')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class AdminAiObservabilityController {
  constructor(private readonly ai: AiObservabilityService) {}

  @Get('overview')
  async overview(@Query('days') days?: string) {
    return { message: 'AI overview fetched', data: await this.ai.overview(days) };
  }

  @Get('status')
  async status() {
    return { message: 'AI status fetched', data: await this.ai.status() };
  }

  @Get('users')
  async users(@Query() query: { days?: string; page?: string; limit?: string; search?: string; sort?: string }) {
    const res = await this.ai.users(query);
    return { message: 'AI usage by user fetched', data: res.data, meta: res.meta };
  }

  @Get('users/:userId')
  async user(@Param('userId') userId: string, @Query('days') days?: string) {
    return { message: 'User AI usage fetched', data: await this.ai.userDetail(userId, days) };
  }

  @Get('logs')
  async logs(@Query() query: LogFilter) {
    const res = await this.ai.logs(query);
    return { message: 'AI logs fetched', data: res.data, meta: res.meta };
  }

  @Get('facets')
  async facets() {
    return { data: await this.ai.facets() };
  }

  @Get('evals/candidates')
  async candidates(@Query() query: { page?: string; limit?: string; garmentKind?: string }) {
    const res = await this.ai.evalCandidates(query);
    return { data: res.data, meta: res.meta };
  }

  @Get('evals/summary')
  async evalSummary() {
    return { data: await this.ai.evalSummary() };
  }

  @Get('evals')
  async evals(@Query() query: { page?: string; limit?: string }) {
    const res = await this.ai.evalList(query);
    return { data: res.data, meta: res.meta };
  }

  @Post('evals')
  async createEval(@Body() body: EvalInput, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Score saved', data: await this.ai.createEval(body, admin.adminUserId) };
  }
}
