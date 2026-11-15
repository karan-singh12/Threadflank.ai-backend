import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BrandEventsService } from './brand-events.service';

/** Global so any controller or service can record a shopper action without wiring a module import. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [BrandEventsService],
  exports: [BrandEventsService],
})
export class BrandEventsModule {}
