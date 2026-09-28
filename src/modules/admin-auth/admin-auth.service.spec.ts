import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AdminAuthService } from './admin-auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';
import { MailerService } from '../../shared/mailer/mailer.service';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { AppLogger } from '../../shared/logger/logger.service';
import { AdminRole } from '@prisma/client';

describe('AdminAuthService', () => {
  let service: AdminAuthService;

  const mockPrisma = {
    adminUser: { findUnique: jest.fn(), update: jest.fn() },
    adminRefreshToken: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    adminPasswordReset: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  };

  const mockAdminJwt = {
    signAccessToken: jest.fn().mockResolvedValue('access-token'),
    signRefreshToken: jest.fn().mockResolvedValue('refresh-token'),
    verifyRefreshToken: jest.fn(),
  };

  const mockMailer = { send: jest.fn().mockResolvedValue(undefined) };
  const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AdminJwtStrategy, useValue: mockAdminJwt },
        { provide: MailerService, useValue: mockMailer },
        { provide: AuditLogService, useValue: mockAudit },
        { provide: AppLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AdminAuthService>(AdminAuthService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('login', () => {
    it('throws UnauthorizedException when the admin does not exist', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValueOnce(null);
      await expect(service.login({ email: 'a@b.com', password: 'secret1' }, {})).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException when the account is inactive', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValueOnce({ id: '1', email: 'a@b.com', password: 'hash', isActive: false, role: AdminRole.ADMIN });
      await expect(service.login({ email: 'a@b.com', password: 'secret1' }, {})).rejects.toThrow(ForbiddenException);
    });

    it('throws UnauthorizedException on a wrong password', async () => {
      const hash = await bcrypt.hash('correct-password', 10);
      mockPrisma.adminUser.findUnique.mockResolvedValueOnce({ id: '1', email: 'a@b.com', password: hash, isActive: true, role: AdminRole.ADMIN });
      await expect(service.login({ email: 'a@b.com', password: 'wrong-password' }, {})).rejects.toThrow(UnauthorizedException);
    });

    it('issues an access/refresh token pair on valid credentials', async () => {
      const hash = await bcrypt.hash('correct-password', 10);
      mockPrisma.adminUser.findUnique.mockResolvedValueOnce({ id: '1', email: 'a@b.com', password: hash, isActive: true, role: AdminRole.ADMIN, name: 'Admin' });
      mockPrisma.adminRefreshToken.create.mockResolvedValueOnce({});
      mockPrisma.adminUser.update.mockResolvedValueOnce({});

      const result = await service.login({ email: 'a@b.com', password: 'correct-password' }, { ip: '127.0.0.1' });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ADMIN_LOGIN' }));
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException when the stored refresh token row is missing', async () => {
      mockAdminJwt.verifyRefreshToken.mockResolvedValueOnce({ adminUserId: '1', email: 'a@b.com', role: AdminRole.ADMIN });
      mockPrisma.adminRefreshToken.findFirst.mockResolvedValueOnce(null);

      await expect(service.refresh('some-token', {})).rejects.toThrow(UnauthorizedException);
    });
  });
});
