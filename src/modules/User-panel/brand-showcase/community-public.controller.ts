import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { OptionalAuthGuard } from '../../../common/guards/optional-auth.guard';
import { CommunityService } from '../../Brand-panel/community/community.service';
import { AskDto, ReplyDto, ReviewDto, SubmitLookDto, VoteDto } from '../../Brand-panel/community/community.controller';

/** The shopper side of brand community: updates and polls, asking a brand, reviews, and sharing a look. */
@ApiTags('Brands (App) — community')
@ApiBearerAuth()
@Controller('brands')
export class CommunityPublicController {
  constructor(private readonly community: CommunityService) {}

  @Get('following/updates')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Updates and polls from brands the shopper follows' })
  async feed(@Req() req: any) {
    return { message: 'Updates fetched', data: await this.community.followingFeed(req.user.userId) };
  }

  @Get(':slug/updates')
  @UseGuards(OptionalAuthGuard)
  async updates(@Param('slug') slug: string, @Req() req: any) {
    return { message: 'Updates fetched', data: await this.community.publicUpdates(slug, req.user?.userId) };
  }

  @Post('updates/:id/vote')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async vote(@Param('id') id: string, @Body() dto: VoteDto, @Req() req: any) {
    return { message: 'Vote counted', data: await this.community.vote(req.user.userId, id, dto.option) };
  }

  @Post(':slug/ask')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ApiOperation({ summary: "Ask a brand a question (it joins the shopper's open conversation with the brand)" })
  async ask(@Param('slug') slug: string, @Body() dto: AskDto, @Req() req: any) {
    return { message: 'Sent', data: await this.community.ask(req.user.userId, slug, dto) };
  }

  @Get('inbox/mine')
  @UseGuards(AuthGuard)
  async myThreads(@Req() req: any) {
    return { message: 'Conversations fetched', data: await this.community.myThreads(req.user.userId) };
  }

  @Get('inbox/:id')
  @UseGuards(AuthGuard)
  async thread(@Param('id') id: string, @Req() req: any) {
    return { message: 'Conversation fetched', data: await this.community.shopperThread(req.user.userId, id) };
  }

  @Post('inbox/:id/reply')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async reply(@Param('id') id: string, @Body() dto: ReplyDto, @Req() req: any) {
    return { message: 'Sent', data: await this.community.replyAsShopper(req.user.userId, id, dto.body) };
  }

  @Get('products/:productId/reviews')
  @UseGuards(OptionalAuthGuard)
  async reviews(@Param('productId') productId: string, @Req() req: any) {
    return { message: 'Reviews fetched', data: await this.community.productReviews(productId, req.user?.userId) };
  }

  @Post('products/:productId/reviews')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async review(@Param('productId') productId: string, @Body() dto: ReviewDto, @Req() req: any) {
    return { message: 'Review saved', data: await this.community.review(req.user.userId, productId, dto) };
  }

  @Get(':slug/looks')
  async looks(@Param('slug') slug: string) {
    return { message: 'Looks fetched', data: await this.community.publicLooks(slug) };
  }

  @Post(':slug/looks')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send one of your saved looks to the brand (it shows only if the brand approves it)' })
  async submit(@Param('slug') slug: string, @Body() dto: SubmitLookDto, @Req() req: any) {
    return { message: 'Sent to the brand', data: await this.community.submitLook(req.user.userId, slug, dto) };
  }
}
