import { Controller, Get, Post, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandStoriesService } from './brand-stories.service';
import { CreateBrandStoryDto } from './dto/create-brand-story.dto';
import { BrandStoryFilterDto } from './dto/brand-story-filter.dto';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { MESSAGES } from '../../common/constants/messages.constant';
import { AdminRole } from '@prisma/client';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@ApiTags('Admin Panel — Brand Stories')
@ApiBearerAuth()
@Controller('admin-panel/brand-stories')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.BRAND_MANAGER)
export class BrandStoriesController {
  constructor(private readonly brandStoriesService: BrandStoriesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a brand story (defaults to 24h TTL)' })
  async create(@Body() dto: CreateBrandStoryDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const story = await this.brandStoriesService.create(dto, admin);
    return { message: MESSAGES.brandStories.created, data: story };
  }

  @Get()
  @ApiOperation({ summary: 'List brand stories (including expired, for admin review)' })
  async findAll(@Query() filter: BrandStoryFilterDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const result = await this.brandStoriesService.findAll(filter, admin);
    return { message: MESSAGES.brandStories.listFetched, data: result.stories, meta: result.meta };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a brand story' })
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    await this.brandStoriesService.remove(id, admin);
    return { message: MESSAGES.brandStories.deleted };
  }
}
