import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContentBlockDto } from './dto/create-content-block.dto';
import { UpdateContentBlockDto } from './dto/update-content-block.dto';
import { ContentBlockFilterDto } from './dto/content-block-filter.dto';
import { MESSAGES } from '../../common/constants/messages.constant';
import { APP_CONSTANTS } from '../../common/constants/app.constant';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { SdkService } from '../../sdk';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';
import { AppLogger } from '../../shared/logger/logger.service';
import { ContentBlockStatus } from '@prisma/client';

@Injectable()
export class CmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly sdk: SdkService,
    private readonly logger: AppLogger,
  ) {}

  async create(dto: CreateContentBlockDto, admin: AuthenticatedAdmin) {
    const existing = await this.prisma.contentBlock.findUnique({ where: { key: dto.key } });
    if (existing) throw new BadRequestException(MESSAGES.cms.keyTaken);

    const block = await this.prisma.contentBlock.create({
      data: { ...dto, body: dto.body as any, createdByAdminId: admin.adminUserId },
    });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'CONTENT_BLOCK_CREATED', entityType: 'ContentBlock', entityId: block.id });
    return block;
  }

  async findAll(filter: ContentBlockFilterDto) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? APP_CONSTANTS.pagination.adminLimit, APP_CONSTANTS.pagination.maxLimit);
    const skip = (page - 1) * limit;

    const where: any = { isDeleted: false };
    if (filter.type) where.type = filter.type;
    if (filter.status) where.status = filter.status;
    if (filter.search) {
      where.OR = [
        { key: { contains: filter.search, mode: 'insensitive' } },
        { title: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const [blocks, total] = await Promise.all([
      this.prisma.contentBlock.findMany({ where, skip, take: limit, orderBy: { updatedAt: 'desc' } }),
      this.prisma.contentBlock.count({ where }),
    ]);

    return { blocks, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const block = await this.prisma.contentBlock.findFirst({ where: { id, isDeleted: false } });
    if (!block) throw new NotFoundException(MESSAGES.cms.notFound);
    return block;
  }

  async findByKeyPublic(key: string) {
    const block = await this.prisma.contentBlock.findFirst({
      where: { key, isDeleted: false, status: ContentBlockStatus.PUBLISHED },
    });
    if (!block) throw new NotFoundException(MESSAGES.cms.notFound);
    return block;
  }

  async update(id: string, dto: UpdateContentBlockDto, admin: AuthenticatedAdmin) {
    await this.findOne(id);
    const updated = await this.prisma.contentBlock.update({
      where: { id },
      data: { ...dto, body: dto.body !== undefined ? (dto.body as any) : undefined },
    });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'CONTENT_BLOCK_UPDATED', entityType: 'ContentBlock', entityId: id });
    return updated;
  }

  async publish(id: string, admin: AuthenticatedAdmin) {
    const block = await this.findOne(id);
    const updated = await this.prisma.contentBlock.update({
      where: { id },
      data: { status: ContentBlockStatus.PUBLISHED, publishedAt: new Date() },
    });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'CONTENT_BLOCK_PUBLISHED', entityType: 'ContentBlock', entityId: id });

    // Best-effort RAG ingestion so published CMS content becomes queryable via
    // sdk.ragQuery() (e.g. an FAQ assistant). Never blocks publishing.
    try {
      const text = typeof block.body === 'string' ? block.body : JSON.stringify(block.body);
      await this.sdk.ingestDocument(
        { sourceType: 'content-block', sourceId: block.id, text, metadata: { key: block.key, type: block.type } },
        'cms',
      );
    } catch (error) {
      this.logger.warn('CmsService', 'RAG ingestion skipped for published content block', { id, error: String(error) });
    }

    return updated;
  }

  async unpublish(id: string, admin: AuthenticatedAdmin) {
    await this.findOne(id);
    const updated = await this.prisma.contentBlock.update({
      where: { id },
      data: { status: ContentBlockStatus.DRAFT, publishedAt: null },
    });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'CONTENT_BLOCK_UNPUBLISHED', entityType: 'ContentBlock', entityId: id });
    await this.dropFromRag(id);
    return updated;
  }

  /** Best-effort: unpublished or deleted content must stop showing up in RAG answers. */
  private async dropFromRag(id: string) {
    try {
      await this.sdk.removeDocument('content-block', id, 'cms');
    } catch (error) {
      this.logger.warn('CmsService', 'RAG removal skipped for content block', { id, error: String(error) });
    }
  }

  async listPublic(type?: string) {
    const where: any = { isDeleted: false, status: ContentBlockStatus.PUBLISHED };
    if (type) where.type = type as any;
    return this.prisma.contentBlock.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
  }

  async remove(id: string, admin: AuthenticatedAdmin) {
    await this.findOne(id);
    await this.prisma.contentBlock.update({ where: { id }, data: { isDeleted: true } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'CONTENT_BLOCK_DELETED', entityType: 'ContentBlock', entityId: id });
    await this.dropFromRag(id);
  }
}
