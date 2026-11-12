import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * GET /brand-posts. Send `cursor` (from the previous page's meta.nextCursor) to walk the whole feed;
 * `page` still works for older clients but is limited to the first pages.
 */
export class FeedQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() brandId?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @MaxLength(300) cursor?: string;
}
