import { Module } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactPublicController } from './contact-public.controller';
import { ContactController } from './contact.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogModule } from '../../shared/audit/audit-log.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [PrismaModule, AuditLogModule, AdminAuthModule],
  controllers: [ContactPublicController, ContactController],
  providers: [ContactService],
  exports: [ContactService],
})
export class ContactModule {}
