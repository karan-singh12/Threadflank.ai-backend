import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class BrandStoryFilterDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  brandId?: string;
}
