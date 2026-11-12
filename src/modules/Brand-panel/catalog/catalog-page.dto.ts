import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined);

/**
 * GET /brand/catalog (and the admin's view of a brand's catalog). With no paging parameters the list
 * still comes back whole (up to 1000), as older clients expect; send `limit` or `cursor` for pages.
 */
export class CatalogPageQueryDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number) limit?: number;
  @IsOptional() @IsString() @MaxLength(300) cursor?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsIn(['PUBLISHED', 'DRAFT']) status?: 'PUBLISHED' | 'DRAFT';
  @IsOptional() @Transform(toBool) @IsBoolean() featured?: boolean;
  @IsOptional() @Transform(toBool) @IsBoolean() outOfStock?: boolean;
}
