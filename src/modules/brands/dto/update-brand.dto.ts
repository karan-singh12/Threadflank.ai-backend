import { PartialType, OmitType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateBrandDto } from './create-brand.dto';
import { BrandStatus } from '@prisma/client';

export class UpdateBrandDto extends PartialType(OmitType(CreateBrandDto, ['slug'] as const)) {
  @IsOptional()
  @IsEnum(BrandStatus)
  status?: BrandStatus;
}
