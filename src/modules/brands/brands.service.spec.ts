import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BrandAccessService } from './brand-access.service';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { AdminRole } from '@prisma/client';

describe('BrandsService', () => {
  let service: BrandsService;

  const mockPrisma = {
    brand: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const mockBrandAccess = { assertAccess: jest.fn().mockResolvedValue(undefined), scopedBrandIds: jest.fn().mockResolvedValue(undefined) };
  const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

  const admin = { adminUserId: 'admin-1', email: 'a@b.com', role: AdminRole.ADMIN };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BrandAccessService, useValue: mockBrandAccess },
        { provide: AuditLogService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<BrandsService>(BrandsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('throws BadRequestException when the slug is already taken', async () => {
      mockPrisma.brand.findUnique.mockResolvedValueOnce({ id: 'existing' });
      await expect(service.create({ name: 'Zara', slug: 'zara' } as any, admin)).rejects.toThrow(BadRequestException);
    });

    it('creates a brand and writes an audit log', async () => {
      mockPrisma.brand.findUnique.mockResolvedValueOnce(null);
      mockPrisma.brand.create.mockResolvedValueOnce({ id: 'brand-1', name: 'Zara', slug: 'zara' });

      const result = await service.create({ name: 'Zara', slug: 'zara' } as any, admin);

      expect(result.id).toBe('brand-1');
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BRAND_CREATED', entityId: 'brand-1' }));
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the brand does not exist (or is soft-deleted)', async () => {
      mockPrisma.brand.findFirst.mockResolvedValueOnce(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('checks brand access before updating', async () => {
      mockPrisma.brand.findFirst.mockResolvedValueOnce({ id: 'brand-1' });
      mockPrisma.brand.update.mockResolvedValueOnce({ id: 'brand-1', name: 'Updated' });

      await service.update('brand-1', { name: 'Updated' } as any, admin);

      expect(mockBrandAccess.assertAccess).toHaveBeenCalledWith(admin, 'brand-1');
    });
  });
});
