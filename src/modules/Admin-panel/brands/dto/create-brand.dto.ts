import { IsBoolean, IsObject, IsOptional, IsString, IsUrl, Matches } from 'class-validator';

export class CreateBrandDto {
  @IsString()
  name: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be lowercase, alphanumeric, and hyphen-separated' })
  slug: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;
}
