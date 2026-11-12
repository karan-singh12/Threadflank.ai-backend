import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole, TaxonomyKind } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../../common/interfaces/admin-jwt-payload.interface';
import { AuditLogService } from '../../../shared/audit/audit-log.service';
import { TaxonomyService } from '../../Brand-panel/taxonomy/taxonomy.service';

class KindQueryDto {
  @IsOptional()
  @IsEnum(TaxonomyKind)
  kind?: TaxonomyKind;
}

class CreateEntryDto {
  @IsEnum(TaxonomyKind)
  kind!: TaxonomyKind;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  name!: string;
}

class UpdateEntryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class ReorderDto {
  @IsEnum(TaxonomyKind)
  kind!: TaxonomyKind;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}

/** The lists behind Discover and the brand panel's pickers: categories (the pills) and occasions. */
@ApiTags('Admin Panel — Discover categories')
@ApiBearerAuth()
@Controller('admin-panel/discover-categories')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class DiscoverCategoriesController {
  constructor(
    private readonly taxonomy: TaxonomyService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Categories or occasions with how many pieces use each, and values pieces use that are not listed yet' })
  async list(@Query() q: KindQueryDto) {
    return { message: 'Fetched', data: await this.taxonomy.usage(q.kind ?? 'CATEGORY') };
  }

  @Post()
  @ApiOperation({ summary: 'Add a category or occasion (goes to the end of the list)' })
  async create(@Body() dto: CreateEntryDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const row = await this.taxonomy.create(dto.kind, dto.name);
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'TAXONOMY_CREATED', entityType: 'DiscoverCategory', entityId: row.id, metadata: { kind: dto.kind, name: row.name } });
    return { message: 'Added', data: row };
  }

  @Post('reorder')
  @ApiOperation({ summary: 'Set the order of the list' })
  async reorder(@Body() dto: ReorderDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const rows = await this.taxonomy.reorder(dto.kind, dto.ids);
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'TAXONOMY_REORDERED', entityType: 'DiscoverCategory', metadata: { kind: dto.kind } });
    return { message: 'Order saved', data: rows };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename (updates every piece that uses it) or turn on/off' })
  async update(@Param('id') id: string, @Body() dto: UpdateEntryDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const row = await this.taxonomy.update(id, dto);
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'TAXONOMY_UPDATED', entityType: 'DiscoverCategory', entityId: id, metadata: dto as Record<string, unknown> });
    return { message: 'Saved', data: row };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an unused entry (a used one must be turned off instead)' })
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const out = await this.taxonomy.remove(id);
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'TAXONOMY_DELETED', entityType: 'DiscoverCategory', entityId: id });
    return { message: 'Deleted', data: out };
  }
}
