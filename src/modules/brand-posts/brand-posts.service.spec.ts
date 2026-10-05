import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
    brandPostLike: { findUnique: jest.fn(), create: jest.fn(), createMany: jest.fn(), delete: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    brandPostComment: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn(), count: jest.fn() },
    look: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
    user: { findMany: jest.fn() },
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

  // ─── Discover engagement ────────────────────────────────────────────────

  const published = {
    id: 'p1',
    title: 'Jacquard-weave shirt',
    caption: 'New in',
    images: ['https://cdn.example/p1.jpg'],
    category: 'Formal',
    taggedProducts: [{ name: 'Shirt', price: '49' }],
    brand: { name: 'H&M' },
  };

  describe('toggleLike', () => {
    it('likes a published post and returns the fresh count', async () => {
      mockPrisma.brandPost.findFirst.mockResolvedValueOnce(published);
      mockPrisma.brandPostLike.findUnique.mockResolvedValueOnce(null);
      mockPrisma.brandPostLike.count.mockResolvedValueOnce(7);

      await expect(service.toggleLike('p1', 'u1')).resolves.toEqual({ liked: true, likesCount: 7 });
      expect(mockPrisma.brandPostLike.createMany).toHaveBeenCalledWith({ data: [{ postId: 'p1', userId: 'u1' }], skipDuplicates: true });
    });

    it('unlikes when the user already liked it', async () => {
      mockPrisma.brandPost.findFirst.mockResolvedValueOnce(published);
      mockPrisma.brandPostLike.findUnique.mockResolvedValueOnce({ id: 'l1' });
      mockPrisma.brandPostLike.count.mockResolvedValueOnce(6);

      await expect(service.toggleLike('p1', 'u1')).resolves.toEqual({ liked: false, likesCount: 6 });
      expect(mockPrisma.brandPostLike.delete).toHaveBeenCalled();
    });

    it('refuses posts that are not published', async () => {
      mockPrisma.brandPost.findFirst.mockResolvedValueOnce(null);
      await expect(service.toggleLike('draft', 'u1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.brandPost.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: ContentStatus.PUBLISHED }) }));
    });
  });

  describe('comments', () => {
    it('returns new comments with a public author and never the email', async () => {
      mockPrisma.brandPost.findFirst.mockResolvedValueOnce(published);
      mockPrisma.brandPostComment.create.mockResolvedValueOnce({ id: 'c1', postId: 'p1', userId: 'u1', content: 'Love it', createdAt: new Date() });
      mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'u1', username: null, email: 'karan@example.com', avatar: null }]);

      const comment = await service.addComment('p1', 'u1', '  Love it ');

      expect(mockPrisma.brandPostComment.create).toHaveBeenCalledWith({ data: { postId: 'p1', userId: 'u1', content: 'Love it' } });
      expect(comment.user).toEqual({ id: 'u1', username: 'ka•••', avatar: null });
      expect(JSON.stringify(comment)).not.toContain('example.com');
    });

    it("won't delete someone else's comment", async () => {
      mockPrisma.brandPostComment.findFirst.mockResolvedValueOnce({ id: 'c1', postId: 'p1', userId: 'someone-else' });
      await expect(service.deleteComment('p1', 'c1', 'u1')).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.brandPostComment.delete).not.toHaveBeenCalled();
    });

    it('deletes your own comment and returns the new count', async () => {
      mockPrisma.brandPostComment.findFirst.mockResolvedValueOnce({ id: 'c1', postId: 'p1', userId: 'u1' });
      mockPrisma.brandPostComment.count.mockResolvedValueOnce(2);
      await expect(service.deleteComment('p1', 'c1', 'u1')).resolves.toEqual({ deleted: true, commentsCount: 2 });
    });
  });

  describe('toggleSave', () => {
    it("saves the post into the user's looks", async () => {
      mockPrisma.brandPost.findFirst.mockResolvedValueOnce(published);
      mockPrisma.look.findFirst.mockResolvedValueOnce(null);
      mockPrisma.look.create.mockResolvedValueOnce({ id: 'look-1' });

      await expect(service.toggleSave('p1', 'u1')).resolves.toEqual({ saved: true, lookId: 'look-1' });
      expect(mockPrisma.look.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u1', image: 'https://cdn.example/p1.jpg', occasion: 'formal', pieces: ['Shirt'], name: 'H&M: Jacquard-weave shirt' }),
      });
    });

    it('removes it when it is already saved', async () => {
      mockPrisma.brandPost.findFirst.mockResolvedValueOnce(published);
      mockPrisma.look.findFirst.mockResolvedValueOnce({ id: 'look-1' });

      await expect(service.toggleSave('p1', 'u1')).resolves.toEqual({ saved: false });
      expect(mockPrisma.look.delete).toHaveBeenCalledWith({ where: { id: 'look-1' } });
    });
  });
});
