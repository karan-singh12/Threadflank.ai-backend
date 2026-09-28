import { Controller, Get, Post, Put, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandPostsService } from './brand-posts.service';
import { CreateBrandPostDto } from './dto/create-brand-post.dto';
import { UpdateBrandPostDto } from './dto/update-brand-post.dto';
import { BrandPostFilterDto } from './dto/brand-post-filter.dto';
import { ScheduleBrandPostDto } from './dto/schedule-brand-post.dto';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { MESSAGES } from '../../common/constants/messages.constant';
import { AdminRole } from '@prisma/client';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@ApiTags('Admin Panel — Brand Posts')
@ApiBearerAuth()
@Controller('admin-panel/brand-posts')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.BRAND_MANAGER)
export class BrandPostsController {
  constructor(private readonly brandPostsService: BrandPostsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a brand post (Discover feed editorial drop)' })
  async create(@Body() dto: CreateBrandPostDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const post = await this.brandPostsService.create(dto, admin);
    return { message: MESSAGES.brandPosts.created, data: post };
  }

  @Get()
  @ApiOperation({ summary: 'List brand posts' })
  async findAll(@Query() filter: BrandPostFilterDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const result = await this.brandPostsService.findAll(filter, admin);
    return { message: MESSAGES.brandPosts.listFetched, data: result.posts, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single brand post' })
  async findOne(@Param('id') id: string) {
    const post = await this.brandPostsService.findOne(id);
    return { message: MESSAGES.brandPosts.fetched, data: post };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a brand post' })
  async update(@Param('id') id: string, @Body() dto: UpdateBrandPostDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const post = await this.brandPostsService.update(id, dto, admin);
    return { message: MESSAGES.brandPosts.updated, data: post };
  }

  @Post(':id/schedule')
  @ApiOperation({ summary: 'Schedule a DRAFT post for future publish' })
  async schedule(@Param('id') id: string, @Body() dto: ScheduleBrandPostDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const post = await this.brandPostsService.schedule(id, dto.scheduledAt, admin);
    return { message: MESSAGES.brandPosts.scheduled, data: post };
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish a post immediately' })
  async publish(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const post = await this.brandPostsService.publish(id, admin);
    return { message: MESSAGES.brandPosts.published, data: post };
  }

  @Post(':id/generate-caption')
  @ApiOperation({ summary: 'SDK-assisted caption generation for this post' })
  async generateCaption(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const post = await this.brandPostsService.generateCaption(id, admin);
    return { message: MESSAGES.brandPosts.captionGenerated, data: post };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a brand post' })
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    await this.brandPostsService.remove(id, admin);
    return { message: MESSAGES.brandPosts.deleted };
  }
}
