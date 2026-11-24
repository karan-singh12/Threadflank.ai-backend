import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { CommunityService, MAX_POLL_OPTIONS } from './community.service';

export class CreateUpdateDto {
  @IsString() @MinLength(1) @MaxLength(1000) body!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) media?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) productIds?: string[];
  @ApiPropertyOptional({ description: `2 to ${MAX_POLL_OPTIONS} options makes it a poll` }) @IsOptional() @IsArray() @ArrayMaxSize(MAX_POLL_OPTIONS) @IsString({ each: true }) @MaxLength(60, { each: true }) pollOptions?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(14) pollDays?: number;
}
export class ReplyDto {
  @IsString() @MaxLength(2000) body!: string;
}
export class SavedReplyDto {
  @IsString() @MinLength(1) @MaxLength(60) title!: string;
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
}
export class ThreadStatusDto {
  @IsIn(['OPEN', 'CLOSED']) status!: 'OPEN' | 'CLOSED';
}
export class DecideLookDto {
  @IsIn(['APPROVED', 'DECLINED']) decision!: 'APPROVED' | 'DECLINED';
}
export class AskDto {
  @IsString() @MinLength(2) @MaxLength(2000) body!: string;
  @IsOptional() @IsString() productId?: string;
}
export class VoteDto {
  @IsInt() @Min(0) @Max(MAX_POLL_OPTIONS - 1) option!: number;
}
export class ReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1500) body?: string;
}
export class SubmitLookDto {
  @IsString() lookId!: string;
  @IsOptional() @IsString() @MaxLength(200) caption?: string;
  @IsOptional() @IsBoolean() showName?: boolean;
}

@ApiTags('Brand Panel — Community')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/community')
export class BrandCommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get('followers')
  @ApiOperation({ summary: 'Follower count, weekly growth and milestones (followers are counted, never listed)' })
  async followers(@CurrentBrand() b: AuthenticatedBrand) {
    return { message: 'Followers fetched', data: await this.community.followers(b.brandId) };
  }

  @Get('updates')
  async updates(@CurrentBrand() b: AuthenticatedBrand) {
    return { message: 'Updates fetched', data: await this.community.listUpdates(b.brandId) };
  }

  @Post('updates')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Post an update or a poll to followers' })
  async createUpdate(@CurrentBrand() b: AuthenticatedBrand, @Body() dto: CreateUpdateDto) {
    return { message: 'Posted', data: await this.community.createUpdate(b.brandId, dto) };
  }

  @Delete('updates/:id')
  async deleteUpdate(@CurrentBrand() b: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Removed', data: await this.community.deleteUpdate(b.brandId, id) };
  }

  @Get('inbox')
  async inbox(@CurrentBrand() b: AuthenticatedBrand, @Query('status') status?: string) {
    const s = status === 'CLOSED' || status === 'ALL' ? status : 'OPEN';
    return { message: 'Inbox fetched', data: await this.community.inbox(b.brandId, s) };
  }

  @Get('inbox/:id')
  async thread(@CurrentBrand() b: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Conversation fetched', data: await this.community.brandThread(b.brandId, id) };
  }

  @Post('inbox/:id/reply')
  @HttpCode(HttpStatus.OK)
  async reply(@CurrentBrand() b: AuthenticatedBrand, @Param('id') id: string, @Body() dto: ReplyDto) {
    return { message: 'Reply sent', data: await this.community.replyAsBrand(b.brandId, b.brandAccountId, id, dto.body) };
  }

  @Patch('inbox/:id')
  async status(@CurrentBrand() b: AuthenticatedBrand, @Param('id') id: string, @Body() dto: ThreadStatusDto) {
    return { message: 'Conversation updated', data: await this.community.setThreadStatus(b.brandId, id, dto.status) };
  }

  @Get('saved-replies')
  async savedReplies(@CurrentBrand() b: AuthenticatedBrand) {
    return { message: 'Saved replies fetched', data: await this.community.savedReplies(b.brandId) };
  }

  @Post('saved-replies')
  async addSavedReply(@CurrentBrand() b: AuthenticatedBrand, @Body() dto: SavedReplyDto) {
    return { message: 'Saved', data: await this.community.addSavedReply(b.brandId, dto) };
  }

  @Delete('saved-replies/:id')
  async deleteSavedReply(@CurrentBrand() b: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Removed', data: await this.community.deleteSavedReply(b.brandId, id) };
  }

  @Get('reviews')
  async reviews(@CurrentBrand() b: AuthenticatedBrand, @Query('filter') filter?: string) {
    return { message: 'Reviews fetched', data: await this.community.brandReviews(b.brandId, filter === 'unanswered' ? 'unanswered' : 'all') };
  }

  @Post('reviews/:id/reply')
  @HttpCode(HttpStatus.OK)
  async replyReview(@CurrentBrand() b: AuthenticatedBrand, @Param('id') id: string, @Body() dto: ReplyDto) {
    return { message: 'Reply saved', data: await this.community.replyToReview(b.brandId, id, dto.body) };
  }

  @Get('questions')
  async questions(@CurrentBrand() b: AuthenticatedBrand, @Query('filter') filter?: string) {
    return { message: 'Questions fetched', data: await this.community.questions(b.brandId, filter === 'all' ? 'all' : 'unanswered') };
  }

  @Post('questions/:id/answer')
  @HttpCode(HttpStatus.OK)
  async answer(@CurrentBrand() b: AuthenticatedBrand, @Param('id') id: string, @Body() dto: ReplyDto) {
    return { message: 'Answer saved', data: await this.community.answerQuestion(b.brandId, id, dto.body) };
  }

  @Get('looks')
  async looks(@CurrentBrand() b: AuthenticatedBrand, @Query('status') status?: string) {
    const s = status === 'APPROVED' || status === 'DECLINED' ? status : 'PENDING';
    return { message: 'Looks fetched', data: await this.community.brandLooks(b.brandId, s) };
  }

  @Patch('looks/:id')
  async decide(@CurrentBrand() b: AuthenticatedBrand, @Param('id') id: string, @Body() dto: DecideLookDto) {
    return { message: 'Look updated', data: await this.community.decideLook(b.brandId, id, dto.decision) };
  }
}
