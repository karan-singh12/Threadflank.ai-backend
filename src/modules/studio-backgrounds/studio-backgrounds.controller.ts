import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StudioBackgroundsService } from './studio-backgrounds.service';
import { CreateStudioBackgroundDto } from './dto/create-studio-background.dto';
import { UpdateStudioBackgroundDto } from './dto/update-studio-background.dto';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { AdminRole } from '@prisma/client';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@ApiTags('Admin Panel — Studio Backgrounds')
@ApiBearerAuth()
@Controller('admin-panel/backgrounds')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class StudioBackgroundsController {
  constructor(private readonly service: StudioBackgroundsService) {}

  @Get()
  @ApiOperation({ summary: 'List all studio scene backgrounds (Admin)' })
  async findAll() {
    const list = await this.service.findAllAdmin();
    return {
      message: 'Backgrounds fetched successfully',
      data: list,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a studio background by ID' })
  async findOne(@Param('id') id: string) {
    const bg = await this.service.findOne(id);
    return {
      message: 'Background fetched successfully',
      data: bg,
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new studio scene background' })
  async create(
    @Body() dto: CreateStudioBackgroundDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const created = await this.service.create(dto, admin);
    return {
      message: 'Studio background created successfully',
      data: created,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a studio scene background' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStudioBackgroundDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const updated = await this.service.update(id, dto, admin);
    return {
      message: 'Studio background updated successfully',
      data: updated,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a studio scene background' })
  async remove(
    @Param('id') id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.service.remove(id, admin);
    return {
      message: 'Studio background deleted successfully',
    };
  }
}
