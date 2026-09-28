import { Controller, Get, Post, Put, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CmsService } from './cms.service';
import { CreateContentBlockDto } from './dto/create-content-block.dto';
import { UpdateContentBlockDto } from './dto/update-content-block.dto';
import { ContentBlockFilterDto } from './dto/content-block-filter.dto';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { MESSAGES } from '../../common/constants/messages.constant';
import { AdminRole } from '@prisma/client';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@ApiTags('Admin Panel — CMS')
@ApiBearerAuth()
@Controller('admin-panel/cms')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class CmsController {
  constructor(private readonly cmsService: CmsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a content block (page/banner/FAQ/legal)' })
  async create(@Body() dto: CreateContentBlockDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const block = await this.cmsService.create(dto, admin);
    return { message: MESSAGES.cms.created, data: block };
  }

  @Get()
  @ApiOperation({ summary: 'List content blocks' })
  async findAll(@Query() filter: ContentBlockFilterDto) {
    const result = await this.cmsService.findAll(filter);
    return { message: MESSAGES.cms.listFetched, data: result.blocks, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a content block' })
  async findOne(@Param('id') id: string) {
    const block = await this.cmsService.findOne(id);
    return { message: MESSAGES.cms.fetched, data: block };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a content block (stays in DRAFT unless separately published)' })
  async update(@Param('id') id: string, @Body() dto: UpdateContentBlockDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const block = await this.cmsService.update(id, dto, admin);
    return { message: MESSAGES.cms.updated, data: block };
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish a content block' })
  async publish(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const block = await this.cmsService.publish(id, admin);
    return { message: MESSAGES.cms.published, data: block };
  }

  @Post(':id/unpublish')
  @ApiOperation({ summary: 'Unpublish a content block (revert to DRAFT)' })
  async unpublish(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const block = await this.cmsService.unpublish(id, admin);
    return { message: 'Content block reverted to draft', data: block };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a content block' })
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    await this.cmsService.remove(id, admin);
    return { message: MESSAGES.cms.deleted };
  }
}
