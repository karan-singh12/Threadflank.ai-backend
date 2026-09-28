import { Controller, Get, Post, Put, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EmailTemplatesService } from './email-templates.service';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { EmailTemplateFilterDto } from './dto/email-template-filter.dto';
import { PreviewTemplateDto, SendTestEmailDto } from './dto/preview-template.dto';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { MESSAGES } from '../../common/constants/messages.constant';
import { AdminRole } from '@prisma/client';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@ApiTags('Admin Panel — Email Templates')
@ApiBearerAuth()
@Controller('admin-panel/email-templates')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class EmailTemplatesController {
  constructor(private readonly emailTemplatesService: EmailTemplatesService) {}

  @Post()
  @ApiOperation({ summary: 'Create an email template' })
  async create(@Body() dto: CreateEmailTemplateDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const template = await this.emailTemplatesService.create(dto, admin);
    return { message: MESSAGES.emailTemplates.created, data: template };
  }

  @Get()
  @ApiOperation({ summary: 'List email templates' })
  async findAll(@Query() filter: EmailTemplateFilterDto) {
    const result = await this.emailTemplatesService.findAll(filter);
    return { message: MESSAGES.emailTemplates.listFetched, data: result.templates, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an email template' })
  async findOne(@Param('id') id: string) {
    const template = await this.emailTemplatesService.findOne(id);
    return { message: MESSAGES.emailTemplates.fetched, data: template };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an email template' })
  async update(@Param('id') id: string, @Body() dto: UpdateEmailTemplateDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const template = await this.emailTemplatesService.update(id, dto, admin);
    return { message: MESSAGES.emailTemplates.updated, data: template };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an email template' })
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    await this.emailTemplatesService.remove(id, admin);
    return { message: MESSAGES.emailTemplates.deleted };
  }

  @Post(':id/preview')
  @ApiOperation({ summary: 'Render the template with sample variables (no send)' })
  async preview(@Param('id') id: string, @Body() dto: PreviewTemplateDto) {
    const rendered = await this.emailTemplatesService.preview(id, dto.variables);
    return { message: MESSAGES.emailTemplates.previewed, data: rendered };
  }

  @Post(':id/send-test')
  @ApiOperation({ summary: 'Send a test email using this template' })
  async sendTest(@Param('id') id: string, @Body() dto: SendTestEmailDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    await this.emailTemplatesService.sendTest(id, dto.to, dto.variables, admin);
    return { message: MESSAGES.emailTemplates.testSent };
  }
}
