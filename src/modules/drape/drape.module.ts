import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CutoutModule } from '../../shared/cutout/cutout.module';
import { ImageProviderModule } from '../../shared/image-provider/image-provider.module';
import { StorageModule } from '../../shared/storage/storage.module';
import { DrapeController } from './drape.controller';
import { DrapeService } from './drape.service';

@Module({
    imports: [
        PrismaModule,
        AuthModule,
        ImageProviderModule,
        StorageModule.register(),
        CutoutModule,
    ],
    controllers: [DrapeController],
    providers: [DrapeService],
    exports: [DrapeService],
})
export class DrapeModule {}
