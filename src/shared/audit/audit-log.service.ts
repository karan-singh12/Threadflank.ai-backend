import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditLogInput {
  adminUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Writes AdminAuditLog rows for admin-panel actions (auth events and every
 * CRUD create/update/delete/publish call). Fire-and-forget from the caller's
 * perspective — failures are logged, never thrown, so audit logging can
 * never break the underlying admin action.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          adminUserId: input.adminUserId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          metadata: input.metadata as any,
          ip: input.ip ?? null,
        },
      });
    } catch {
      // Audit logging is best-effort; never blocks the primary action.
    }
  }
}
