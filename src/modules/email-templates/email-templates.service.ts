import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { EmailTemplateFilterDto } from './dto/email-template-filter.dto';
import { MESSAGES } from '../../common/constants/messages.constant';
import { APP_CONSTANTS } from '../../common/constants/app.constant';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { MailerService } from '../../shared/mailer/mailer.service';
import { renderTemplate, extractTemplateVariables } from '../../common/utils/template.util';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@Injectable()
export class EmailTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly mailer: MailerService,
  ) {}

  async create(dto: CreateEmailTemplateDto, admin: AuthenticatedAdmin) {
    const existing = await this.prisma.emailTemplate.findUnique({ where: { key: dto.key } });
    if (existing) throw new BadRequestException(MESSAGES.emailTemplates.keyTaken);

    const variables = dto.variables ?? extractTemplateVariables(`${dto.subject}\n${dto.htmlBody}`);

    const template = await this.prisma.emailTemplate.create({
      data: { ...dto, variables: variables as any, createdByAdminId: admin.adminUserId },
    });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'EMAIL_TEMPLATE_CREATED', entityType: 'EmailTemplate', entityId: template.id });
    return template;
  }

  async findAll(filter: EmailTemplateFilterDto) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? APP_CONSTANTS.pagination.adminLimit, APP_CONSTANTS.pagination.maxLimit);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.search) {
      where.OR = [
        { key: { contains: filter.search, mode: 'insensitive' } },
        { name: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const [templates, total] = await Promise.all([
      this.prisma.emailTemplate.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.emailTemplate.count({ where }),
    ]);

    return { templates, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const template = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException(MESSAGES.emailTemplates.notFound);
    return template;
  }

  async update(id: string, dto: UpdateEmailTemplateDto, admin: AuthenticatedAdmin) {
    await this.findOne(id);
    const updated = await this.prisma.emailTemplate.update({ where: { id }, data: dto as any });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'EMAIL_TEMPLATE_UPDATED', entityType: 'EmailTemplate', entityId: id });
    return updated;
  }

  async remove(id: string, admin: AuthenticatedAdmin) {
    await this.findOne(id);
    await this.prisma.emailTemplate.delete({ where: { id } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'EMAIL_TEMPLATE_DELETED', entityType: 'EmailTemplate', entityId: id });
  }

  async preview(id: string, variables: Record<string, string> = {}) {
    const template = await this.findOne(id);
    return {
      subject: renderTemplate(template.subject, variables),
      html: renderTemplate(template.htmlBody, variables),
    };
  }

  async sendTest(id: string, to: string, variables: Record<string, string> = {}, admin: AuthenticatedAdmin) {
    const rendered = await this.preview(id, variables);
    await this.mailer.send({ to, subject: `[TEST] ${rendered.subject}`, html: rendered.html });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'EMAIL_TEMPLATE_TEST_SENT', entityType: 'EmailTemplate', entityId: id, metadata: { to } });
  }
}
