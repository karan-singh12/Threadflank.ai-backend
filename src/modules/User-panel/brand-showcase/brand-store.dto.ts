import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined);

/** GET /brands/directory: the brands page. */
export class DirectoryQueryDto {
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) page?: number;
  @IsOptional() @IsInt() @Min(1) @Max(48) @Type(() => Number) limit?: number;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsIn(['featured', 'new', 'az']) sort?: 'featured' | 'new' | 'az';
  /** Default true: hide brands that have nothing live to shop yet. */
  @IsOptional() @Transform(toBool) @IsBoolean() withPieces?: boolean;
}

export const STORE_SORTS = ['new', 'price_asc', 'price_desc', 'featured'] as const;
export type StoreSort = (typeof STORE_SORTS)[number];

/** GET /brands/:slug/catalog: a brand store's pieces, filtered and cursor-paginated. */
export class StoreCatalogQueryDto {
  @IsOptional() @IsInt() @Min(1) @Max(48) @Type(() => Number) limit?: number;
  @IsOptional() @IsString() @MaxLength(300) cursor?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsString() @MaxLength(60) occasion?: string;
  @IsOptional() @IsIn(STORE_SORTS as unknown as string[]) sort?: StoreSort;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) minPrice?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) maxPrice?: number;
  @IsOptional() @Transform(toBool) @IsBoolean() inStock?: boolean;
}
