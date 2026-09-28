import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BrandPostsService } from './brand-posts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BrandAccessService } from '../brands/brand-access.service';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { SdkService } from '../../sdk';
import { AdminRole, ContentStatus } from '@prisma/client';

describe('BrandPostsService', () => {
  let service: BrandPostsService;

  const mockPrisma = {
    brandPost: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    brand: { findFirst: jest.fn() },
    brandPostLike: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    brandPostComment: { create: jest.fn(), findMany: jest.fn() },
  };
  const mockBrandAccess = { assertAccess: jest.fn().mockResolvedValue(undefined), scopedBrandIds: jest.fn().mockResolvedValue(undefined) };
  const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
  const mockSdk = { generateCaption: jest.fn() };

  const admin = { adminUserId: 'admin-1', email: 'a@b.com', role: AdminRole.ADMIN };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandPostsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BrandAccessService, useValue: mockBrandAccess },
        { provide: AuditLogService, useValue: mockAudit },
        { provide: SdkService, useValue: mockSdk },
      ],
    }).compile();

    service = module.get<BrandPostsService>(BrandPostsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('publish', () => {
    it('rejects publishing a post that is already PUBLISHED', async () => {
      mockPrisma.brandPost.findFirst.mockResolvedValueOnce({ id: 'p1', brandId: 'b1', status: ContentStatus.PUBLISHED, brand: {} });

      await expect(service.publish('p1', admin)).rejects.toThrow(BadRequestException);
    });

    it('publishes a DRAFT post', async () => {
      mockPrisma.brandPost.findFirst.mockResolvedValueOnce({ id: 'p1', brandId: 'b1', status: ContentStatus.DRAFT, brand: {} });
      mockPrisma.brandPost.update.mockResolvedValueOnce({ id: 'p1', status: ContentStatus.PUBLISHED });

      const result = await service.publish('p1', admin);

      expect(result.status).toBe(ContentStatus.PUBLISHED);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BRAND_POST_PUBLISHED' }));
    });
  });

  describe('schedule', () => {
    it('rejects scheduling a post that is not DRAFT', async () => {
      mockPrisma.brandPost.findFirst.mockResolvedValueOnce({ id: 'p1', brandId: 'b1', status: ContentStatus.PUBLISHED, brand: {} });

      await expect(service.schedule('p1', new Date().toISOString(), admin)).rejects.toThrow(BadRequestException);
    });
  });

  describe('publishDueScheduledPosts', () => {
    it('publishes every SCHEDULED post whose scheduledAt has passed', async () => {
      mockPrisma.brandPost.findMany.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]);
      mockPrisma.brandPost.updateMany.mockResolvedValueOnce({ count: 2 });

      const count = await service.publishDueScheduledPosts();

      expect(count).toBe(2);
      expect(mockPrisma.brandPost.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ContentStatus.PUBLISHED, publishedAt: expect.any(Date) } }),
      );
    });

    it('does nothing when there are no due posts', async () => {
      mockPrisma.brandPost.findMany.mockResolvedValueOnce([]);
      const count = await service.publishDueScheduledPosts();
      expect(count).toBe(0);
      expect(mockPrisma.brandPost.updateMany).not.toHaveBeenCalled();
    });
  });
});
