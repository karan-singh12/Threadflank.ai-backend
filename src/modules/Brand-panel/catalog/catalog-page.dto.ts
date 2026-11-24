import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined);

export const CATALOG_SORTS = ['newest', 'oldest', 'price_low', 'price_high', 'popular', 'stock_low'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** Ceiling for one bulk action, so a single request cannot lock a huge slice of the table. */
export const BULK_MAX = 500;

/**
 * GET /brand/catalog (and the admin's view of a brand's catalog). With no paging parameters the list
 * still comes back whole (up to 1000), as older clients expect; send `limit` or `cursor` for pages.
 */
export class CatalogPageQueryDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number) limit?: number;
  @IsOptional() @IsString() @MaxLength(300) cursor?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  /** A brand collection by name. The word "none" lists the pieces that are in no collection. */
  @IsOptional() @IsString() @MaxLength(80) collection?: string;
  @IsOptional() @IsIn(['PUBLISHED', 'DRAFT']) status?: 'PUBLISHED' | 'DRAFT';
  @IsOptional() @Transform(toBool) @IsBoolean() featured?: boolean;
  @IsOptional() @Transform(toBool) @IsBoolean() outOfStock?: boolean;
  /** Pieces with 1–3 left. */
  @IsOptional() @Transform(toBool) @IsBoolean() lowStock?: boolean;
  /** Pieces with no image, so cannot be tried on. */
  @IsOptional() @Transform(toBool) @IsBoolean() notReady?: boolean;
  /** needs_work = the try-on photo check found problems; unchecked = has a photo that has not been checked yet. */
  @IsOptional() @IsIn(['needs_work', 'unchecked']) photo?: 'needs_work' | 'unchecked';
  @IsOptional() @IsIn(CATALOG_SORTS as unknown as string[]) sort?: CatalogSort;
}

/** Rows are validated one by one in the service so a single bad row never rejects the whole file. */
export class ImportCatalogDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_MAX) items!: Record<string, unknown>[];
  /** When true, a row whose SKU already exists updates that piece instead of being skipped. */
  @IsOptional() @IsBoolean() updateExisting?: boolean;
}

/** Import or re-sync from a Shopify or WooCommerce store. */
export class StoreSyncDto {
  /** The store address: yourbrand.com, yourbrand.myshopify.com or a full https:// link. */
  @IsString() @MaxLength(300) url!: string;
  /** Used for pieces whose store type is not one of the admin categories. */
  @IsString() @MaxLength(60) category!: string;
  /** New pieces come in as drafts unless PUBLISHED is asked for. */
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
}

export class BulkCatalogDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_MAX) @IsString({ each: true }) ids!: string[];
  @IsIn(['publish', 'draft', 'delete', 'collection', 'category']) action!: 'publish' | 'draft' | 'delete' | 'collection' | 'category';
  /** For action "collection": the target name, or an empty string to take the pieces out of their collection. */
  @ValidateIf((o: BulkCatalogDto) => o.action === 'collection') @IsString() @MaxLength(80) collection?: string;
  /** For action "category": must be one of the admin-managed categories. */
  @ValidateIf((o: BulkCatalogDto) => o.action === 'category') @IsString() @MaxLength(60) category?: string;
}
