import { Controller, Get, Put, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ContactService } from './contact.service';
import { UpdateContactInquiryDto } from './dto/update-contact.dto';
import { ContactFilterDto } from './dto/contact-filter.dto';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { AdminRole } from '@prisma/client';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@ApiTags('Admin Panel — Contact Inquiries')
@ApiBearerAuth()
@Controller('admin-panel/contact')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Get()
  @ApiOperation({ summary: 'List contact / support inquiries' })
  async findAll(@Query() filter: ContactFilterDto) {
    const result = await this.contactService.findAll(filter);
    return {
      message: 'Inquiries fetched successfully',
      data: result.inquiries,
      meta: result.meta,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a contact inquiry' })
  async findOne(@Param('id') id: string) {
    const inquiry = await this.contactService.findOne(id);
    return { message: 'Inquiry fetched successfully', data: inquiry };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update inquiry status or internal notes' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateContactInquiryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const inquiry = await this.contactService.update(id, dto, admin);
    return { message: 'Inquiry updated successfully', data: inquiry };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a contact inquiry' })
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    await this.contactService.remove(id, admin);
    return { message: 'Inquiry deleted successfully' };
  }
}
