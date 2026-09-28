import { Controller, Get, Post, Put, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { BrandFilterDto } from './dto/brand-filter.dto';
import { AssignManagerDto } from './dto/assign-manager.dto';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { MESSAGES } from '../../common/constants/messages.constant';
import { AdminRole } from '@prisma/client';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@ApiTags('Admin Panel — Brands')
@ApiBearerAuth()
@Controller('admin-panel/brands')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.BRAND_MANAGER)
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Post()
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Create a partner brand' })
  async create(@Body() dto: CreateBrandDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const brand = await this.brandsService.create(dto, admin);
    return { message: MESSAGES.brands.created, data: brand };
  }

  @Get()
  @ApiOperation({ summary: 'List brands (BRAND_MANAGER sees only assigned brands)' })
  async findAll(@Query() filter: BrandFilterDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const result = await this.brandsService.findAll(filter, admin);
    return { message: MESSAGES.brands.listFetched, data: result.brands, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single brand' })
  async findOne(@Param('id') id: string) {
    const brand = await this.brandsService.findOne(id);
    return { message: MESSAGES.brands.fetched, data: brand };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a brand' })
  async update(@Param('id') id: string, @Body() dto: UpdateBrandDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const brand = await this.brandsService.update(id, dto, admin);
    return { message: MESSAGES.brands.updated, data: brand };
  }

  @Delete(':id')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Soft-delete a brand' })
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    await this.brandsService.remove(id, admin);
    return { message: MESSAGES.brands.deleted };
  }

  @Post(':id/managers')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Assign a BRAND_MANAGER admin to this brand' })
  async assignManager(@Param('id') id: string, @Body() dto: AssignManagerDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const assignment = await this.brandsService.assignManager(id, dto.adminUserId, admin);
    return { message: MESSAGES.brands.managerAssigned, data: assignment };
  }

  @Delete(':id/managers/:adminUserId')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Unassign a BRAND_MANAGER admin from this brand' })
  async unassignManager(@Param('id') id: string, @Param('adminUserId') adminUserId: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    await this.brandsService.unassignManager(id, adminUserId, admin);
    return { message: MESSAGES.brands.managerUnassigned };
  }

  @Get(':id/managers')
  @ApiOperation({ summary: 'List admins assigned to manage this brand' })
  async listManagers(@Param('id') id: string) {
    const managers = await this.brandsService.listManagers(id);
    return { message: MESSAGES.brands.listFetched, data: managers };
  }
}
