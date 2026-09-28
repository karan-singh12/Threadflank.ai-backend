import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactInquiryDto } from './dto/create-contact.dto';
import { UpdateContactInquiryDto } from './dto/update-contact.dto';
import { ContactFilterDto } from './dto/contact-filter.dto';
import { APP_CONSTANTS } from '../../common/constants/app.constant';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';
import { ContactStatus } from '@prisma/client';

@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async create(dto: CreateContactInquiryDto) {
    const inquiry = await this.prisma.contactInquiry.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        topic: dto.topic,
        message: dto.message,
        userId: dto.userId || null,
        status: ContactStatus.PENDING,
      },
    });

    return inquiry;
  }

  async findAll(filter: ContactFilterDto) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? APP_CONSTANTS.pagination.adminLimit, APP_CONSTANTS.pagination.maxLimit);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
        { topic: { contains: filter.search, mode: 'insensitive' } },
        { message: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const [inquiries, total] = await Promise.all([
      this.prisma.contactInquiry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contactInquiry.count({ where }),
    ]);

    return { inquiries, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const inquiry = await this.prisma.contactInquiry.findUnique({ where: { id } });
    if (!inquiry) throw new NotFoundException('Contact inquiry not found');
    return inquiry;
  }

  async update(id: string, dto: UpdateContactInquiryDto, admin: AuthenticatedAdmin) {
    await this.findOne(id);
    const updated = await this.prisma.contactInquiry.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });

    await this.audit.log({
      adminUserId: admin.adminUserId,
      action: 'CONTACT_INQUIRY_UPDATED',
      entityType: 'ContactInquiry',
      entityId: id,
    });

    return updated;
  }

  async remove(id: string, admin: AuthenticatedAdmin) {
    await this.findOne(id);
    await this.prisma.contactInquiry.delete({ where: { id } });

    await this.audit.log({
      adminUserId: admin.adminUserId,
      action: 'CONTACT_INQUIRY_DELETED',
      entityType: 'ContactInquiry',
      entityId: id,
    });
  }
}
