import { ArrayMinSize, IsArray, IsDateString, IsObject, IsOptional, IsString } from 'class-validator';

export class TaggedProductDto {
  name: string;
  brand?: string;
  price?: string;
  url?: string;
  thumbnail?: string;
}

export class CreateBrandPostDto {
  @IsString()
  brandId: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  caption: string;

  @IsArray()
  @ArrayMinSize(1)
  images: string[];

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  taggedProducts?: TaggedProductDto[];

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
