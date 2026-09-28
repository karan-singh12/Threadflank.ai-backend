import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ContentBlockType, ContentBlockStatus } from '@prisma/client';

export class ContentBlockFilterDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ContentBlockType)
  type?: ContentBlockType;

  @IsOptional()
  @IsEnum(ContentBlockStatus)
  status?: ContentBlockStatus;

  @IsOptional()
  @IsString()
  search?: string;
}
