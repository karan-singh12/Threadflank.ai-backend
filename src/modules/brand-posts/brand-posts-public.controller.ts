import { Controller, Get, Post, Delete, Param, Query, Body, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandPostsService } from './brand-posts.service';
import { BrandPostFilterDto } from './dto/brand-post-filter.dto';
import { AddBrandPostCommentDto } from './dto/add-comment.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { MESSAGES } from '../../common/constants/messages.constant';

/** App-facing Discover/Trending feed read + engagement surface (PRD §4.5). */
@ApiTags('Brand Posts (App)')
@ApiBearerAuth()
@Controller('brand-posts')
export class BrandPostsPublicController {
  constructor(private readonly brandPostsService: BrandPostsService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Discover/Trending feed — published brand posts' })
  async findAll(@Query() filter: BrandPostFilterDto, @Req() req: any) {
    const userId = req.user?.userId;
    const result = await this.brandPostsService.findAllPublic(filter, userId);
    return { message: MESSAGES.brandPosts.listFetched, data: result.posts, meta: result.meta };
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Get a single published brand post (public post page, share links)' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    const post = await this.brandPostsService.findOnePublic(id, req.user?.userId);
    return { message: MESSAGES.brandPosts.fetched, data: post };
  }

  @Post(':id/like')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Toggle like on a brand post' })
  async toggleLike(@Param('id') id: string, @Req() req: any) {
    const result = await this.brandPostsService.toggleLike(id, req.user.userId);
    return { message: MESSAGES.posts.toggled(result.liked), data: result };
  }

  @Post(':id/save')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Save a brand post to the user's Saved looks, or remove it" })
  async toggleSave(@Param('id') id: string, @Req() req: any) {
    const result = await this.brandPostsService.toggleSave(id, req.user.userId);
    return { message: result.saved ? 'Saved to your looks' : 'Removed from your looks', data: result };
  }

  @Post(':id/share')
  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Count a share of a brand post' })
  async share(@Param('id') id: string) {
    return { message: 'Share recorded', data: await this.brandPostsService.recordShare(id) };
  }

  @Get(':id/comments')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'List comments on a brand post' })
  async listComments(@Param('id') id: string) {
    const comments = await this.brandPostsService.listComments(id);
    return { message: MESSAGES.posts.feedFetched, data: comments };
  }

  @Post(':id/comments')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Add a comment to a brand post' })
  async addComment(@Param('id') id: string, @Body() dto: AddBrandPostCommentDto, @Req() req: any) {
    const comment = await this.brandPostsService.addComment(id, req.user.userId, dto.content);
    return { message: MESSAGES.posts.commentAdded, data: comment };
  }

  @Delete(':id/comments/:commentId')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Delete your own comment on a brand post' })
  async deleteComment(@Param('id') id: string, @Param('commentId') commentId: string, @Req() req: any) {
    const result = await this.brandPostsService.deleteComment(id, commentId, req.user.userId);
    return { message: 'Comment deleted', data: result };
  }
}
