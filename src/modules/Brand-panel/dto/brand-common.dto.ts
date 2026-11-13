import { ArrayMaxSize, IsIn, IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsEmail, IsInt, IsISO8601, Matches, ValidateIf, MinLength, MaxLength, Min, Max } from 'class-validator';
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
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'luxury2026' })
  @IsString()
  password!: string;
}

export class BrandRefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class BrandVerifyEmailDto {
  @ApiProperty()
  @IsString()
  token!: string;
}

export class BrandEmailDto {
  @ApiProperty({ example: 'atelier@rawmango.com' })
  @IsEmail()
  email!: string;
}

export class BrandResetPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ example: 'luxury2026' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}

export class RegisterBrandDto {
  @ApiProperty({ example: 'Raw Mango Atelier' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: 'raw-mango' })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiProperty({ example: 'atelier@rawmango.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'luxury2026' })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt ignores everything past 72 bytes
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
  @Matches(/^https:\/\//i, { message: 'Links must start with https://' })
  buyUrl!: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  featured?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  newDrop?: boolean;

  @ApiPropertyOptional({ example: 'Wedding Edit 2026' })
  @IsString()
  @MaxLength(80)
  @IsOptional()
  collection?: string;

  @ApiPropertyOptional({ example: 'Hand-woven silk with zari border, made for festive evenings.' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED'], default: 'PUBLISHED', description: 'DRAFT hides the piece from shoppers' })
  @IsIn(['DRAFT', 'PUBLISHED'])
  @IsOptional()
  status?: 'DRAFT' | 'PUBLISHED';
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
  @Matches(/^https:\/\//i, { message: 'Links must start with https://' })
  buyUrl?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  featured?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  newDrop?: boolean;

  @ApiPropertyOptional({ description: 'Empty string removes the piece from its collection' })
  @IsString()
  @MaxLength(80)
  @IsOptional()
  collection?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED'] })
  @IsIn(['DRAFT', 'PUBLISHED'])
  @IsOptional()
  status?: 'DRAFT' | 'PUBLISHED';
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
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: 'The Royal Banaras Chapter' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  collectionName!: string;

  @ApiPropertyOptional({ example: 'A hand-woven Banarasi tribute to timeless royal celebrations.' })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string;

  @ApiProperty({ example: '2026-11-20T18:00:00Z', description: 'ISO date; must not be in the past' })
  @IsISO8601()
  launchDate!: string;

  @ApiProperty({ example: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d', description: 'Optional: empty or an https link' })
  @IsString()
  @ValidateIf((o) => !!o.bannerUrl)
  @Matches(/^https:\/\//i, { message: 'Links must start with https://' })
  bannerUrl!: string;

  @ApiPropertyOptional({ example: 12, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  productsCount?: number;
}

export class UpdateDropDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @IsOptional()
  collectionName?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsISO8601()
  @IsOptional()
  launchDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @ValidateIf((o) => !!o.bannerUrl)
  @Matches(/^https:\/\//i, { message: 'Links must start with https://' })
  @IsOptional()
  bannerUrl?: string;

  @ApiPropertyOptional({ maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
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
  @MaxLength(300)
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

export class GenerateContentDto {
  @ApiProperty({ enum: ['product_description', 'instagram_caption', 'launch_announcement', 'email_blurb', 'seo_meta'] })
  @IsIn(['product_description', 'instagram_caption', 'launch_announcement', 'email_blurb', 'seo_meta'])
  contentType!: 'product_description' | 'instagram_caption' | 'launch_announcement' | 'email_blurb' | 'seo_meta';

  @ApiPropertyOptional({ description: "One of this brand's garments; leave out for brand-level copy" })
  @IsString()
  @IsOptional()
  garmentId?: string;

  @ApiProperty({ enum: ['luxe', 'playful', 'minimal', 'festive', 'bold'] })
  @IsIn(['luxe', 'playful', 'minimal', 'festive', 'bold'])
  tone!: 'luxe' | 'playful' | 'minimal' | 'festive' | 'bold';

  @ApiProperty({ enum: ['english', 'hindi', 'hinglish'] })
  @IsIn(['english', 'hindi', 'hinglish'])
  language!: 'english' | 'hindi' | 'hinglish';

  @ApiProperty({ enum: ['short', 'medium', 'long'] })
  @IsIn(['short', 'medium', 'long'])
  length!: 'short' | 'medium' | 'long';

  @ApiPropertyOptional({ type: [String], maxItems: 8 })
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @IsOptional()
  keywords?: string[];

  @ApiPropertyOptional({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 3, default: 3 })
  @IsInt()
  @Min(1)
  @Max(3)
  @IsOptional()
  variants?: number;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword!: string;

  @ApiProperty({ example: 'luxury2026' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}

export class InviteMemberDto {
  @ApiProperty({ example: 'stylist@rawmango.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Asha Verma' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}

export class SetMemberActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export class WidgetDomainsDto {
  @ApiProperty({ type: [String], example: ['https://shop.rawmango.com'], description: 'Storefront origins allowed to load the widget; empty means anywhere' })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  domains!: string[];
}
