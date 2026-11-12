import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateBrandStoryDto {
  @IsString()
  brandId: string;

  @IsString()
  mediaUrl: string;

  @IsIn(['IMAGE', 'VIDEO'])
  mediaType: string;

  @IsOptional()
  @IsString()
  caption?: string;

  /** Overrides the default 24h TTL if provided. */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
