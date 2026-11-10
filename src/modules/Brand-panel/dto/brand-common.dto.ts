import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBrandProfileDto {
  @ApiPropertyOptional({ example: 'Raw Mango Atelier' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Contemporary Indian luxury rooted in indigenous textile craft.' })
  @IsString()
  @IsOptional()
  story?: string;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/photo-1544441893-675973e31985' })
  @IsString()
  @IsOptional()
  logo?: string;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d' })
  @IsString()
  @IsOptional()
  banner?: string;

  @ApiPropertyOptional({ example: '#6342f0' })
  @IsString()
  @IsOptional()
  themeAccent?: string;

  @ApiPropertyOptional({ example: 'Diwali & Shaadi Edit is live for Drape Try-On!' })
  @IsString()
  @IsOptional()
  announcementText?: string;

  @ApiPropertyOptional({ example: 'https://rawmango.com' })
  @IsString()
  @IsOptional()
  websiteUrl?: string;

  @ApiPropertyOptional({ example: 'Lodhi Colony Market, New Delhi, India' })
  @IsString()
  @IsOptional()
  physicalStoreAddress?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isOnlineOnly?: boolean;
}

export class BrandLoginDto {
  @ApiProperty({ example: 'atelier@rawmango.com' })
  @IsString()
  email!: string;

  @ApiProperty({ example: 'luxury2026' })
  @IsString()
  password!: string;
}

export class RegisterBrandDto {
  @ApiProperty({ example: 'Raw Mango Atelier' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'raw-mango' })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiProperty({ example: 'atelier@rawmango.com' })
  @IsString()
  email!: string;

  @ApiProperty({ example: 'luxury2026' })
  @IsString()
  password!: string;

  @ApiPropertyOptional({ example: 'Ethnic Wear' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ example: 'https://rawmango.com' })
  @IsString()
  @IsOptional()
  websiteUrl?: string;

  @ApiPropertyOptional({ example: 'Lodhi Colony Market, New Delhi, India' })
  @IsString()
  @IsOptional()
  physicalStoreAddress?: string;
}

export class CreateGarmentDto {
  @ApiProperty({ example: 'Varanasi Gold Zari Tissue Lehenga' })
  @IsString()
  title!: string;

  @ApiProperty({ example: 'RM-LEH-01' })
  @IsString()
  sku!: string;

  @ApiProperty({ example: 84000 })
  @IsNumber()
  price!: number;

  @ApiPropertyOptional({ example: 95000 })
  @IsNumber()
  @IsOptional()
  originalPrice?: number;

  @ApiProperty({ example: ['https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b'] })
  @IsArray()
  @IsString({ each: true })
  images!: string[];

  @ApiProperty({ example: 'Ethnic Wear' })
  @IsString()
  category!: string;

  @ApiPropertyOptional({ example: ['Shaadi', 'Reception'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  occasions?: string[];

  @ApiPropertyOptional({ example: ['Antique Gold', 'Blush Pink'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  colors?: string[];

  @ApiPropertyOptional({ example: ['XS', 'S', 'M', 'L'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sizes?: string[];

  @ApiPropertyOptional({ example: 14 })
  @IsNumber()
  @IsOptional()
  stock?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isDrapeReady?: boolean;

  @ApiPropertyOptional({ example: 98 })
  @IsNumber()
  @IsOptional()
  drapeScore?: number;

  @ApiProperty({ example: 'https://rawmango.com/shop/lehengas/varanasi-gold' })
  @IsString()
  buyUrl!: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  featured?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  newDrop?: boolean;
}

export class UpdateGarmentDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  price?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  originalPrice?: number;

  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  occasions?: string[];

  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  colors?: string[];

  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sizes?: string[];

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  stock?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isDrapeReady?: boolean;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  drapeScore?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  buyUrl?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  featured?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  newDrop?: boolean;
}

export class PlaceBidDto {
  @ApiProperty({ example: 35000, description: 'Bid amount in INR credits' })
  @IsNumber()
  @Min(1000)
  bidAmount!: number;
}

export class CreateDropDto {
  @ApiProperty({ example: 'Kashi Heritage Wedding Collection 26' })
  @IsString()
  title!: string;

  @ApiProperty({ example: 'The Royal Banaras Chapter' })
  @IsString()
  collectionName!: string;

  @ApiPropertyOptional({ example: 'A hand-woven Banarasi tribute to timeless royal celebrations.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: '2026-11-20T18:00:00Z' })
  @IsString()
  launchDate!: string;

  @ApiProperty({ example: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d' })
  @IsString()
  bannerUrl!: string;

  @ApiPropertyOptional({ example: 12 })
  @IsNumber()
  @IsOptional()
  productsCount?: number;
}

export class SimulateVideoDto {
  @ApiPropertyOptional({ example: 'prod_01' })
  @IsString()
  @IsOptional()
  garmentId?: string;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b' })
  @IsString()
  @IsOptional()
  customImageUrl?: string;

  @ApiProperty({ example: 'red_carpet', enum: ['red_carpet', 'high_street', 'silk_motion', 'velvet_glow'] })
  @IsString()
  motionPreset!: string;

  @ApiProperty({ example: 75, minimum: 10, maximum: 100 })
  @IsNumber()
  @Min(10)
  @Max(100)
  motionIntensity!: number;

  @ApiPropertyOptional({ example: 'A dramatic runway glide in slow motion under warm spotlight' })
  @IsString()
  @IsOptional()
  prompt?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  promptEnhance?: boolean;
}

export class TrackClickDto {
  @ApiProperty({ example: 'prod_01' })
  @IsString()
  productId!: string;

  @ApiPropertyOptional({ example: 'catalog_card' })
  @IsString()
  @IsOptional()
  source?: string;
}

