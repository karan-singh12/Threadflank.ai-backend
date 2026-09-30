import { Module } from '@nestjs/common';
import { CutoutService } from './cutout.service';

@Module({
    providers: [CutoutService],
    exports: [CutoutService],
})
export class CutoutModule {}
