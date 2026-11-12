import { PartialType, OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum } from 'class-validator';
import { ContentBlockStatus } from '@prisma/client';
import { CreateContentBlockDto } from './create-content-block.dto';

export class UpdateContentBlockDto extends PartialType(OmitType(CreateContentBlockDto, ['key'] as const)) {
  @ApiPropertyOptional({ enum: ContentBlockStatus })
  @IsOptional()
  @IsEnum(ContentBlockStatus)
  status?: ContentBlockStatus;
}
