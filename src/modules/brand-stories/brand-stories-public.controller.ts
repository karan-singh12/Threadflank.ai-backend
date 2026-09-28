import { Controller, Get, Post, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandStoriesService } from './brand-stories.service';
import { BrandStoryFilterDto } from './dto/brand-story-filter.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { MESSAGES } from '../../common/constants/messages.constant';

/** App-facing brand-stories carousel (PRD §4.5) — active (non-expired) stories only. */
@ApiTags('Brand Stories (App)')
@ApiBearerAuth()
@Controller('brand-stories')
export class BrandStoriesPublicController {
  constructor(private readonly brandStoriesService: BrandStoriesService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Active brand stories carousel' })
  async findAll(@Query() filter: BrandStoryFilterDto) {
    const result = await this.brandStoriesService.findAllPublic(filter);
    return { message: MESSAGES.brandStories.listFetched, data: result.stories };
  }

  @Post(':id/view')
  @ApiOperation({ summary: 'Record a view of a brand story' })
  async view(@Param('id') id: string, @Req() req: any) {
    const story = await this.brandStoriesService.recordView(id, req.user.userId);
    return { message: MESSAGES.brandStories.fetched, data: story };
  }
}
