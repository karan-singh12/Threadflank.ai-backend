import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** One size/colour row. Checked again in the service (duplicates, row numbers in messages). */
export class VariantDto {
  @ApiPropertyOptional({ example: 'M' }) @IsOptional() @IsString() @MaxLength(40) size?: string;
  @ApiPropertyOptional({ example: 'Emerald' }) @IsOptional() @IsString() @MaxLength(40) color?: string;
  @ApiPropertyOptional({ example: '#1F7A4D' }) @IsOptional() @IsString() @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: 'Colour codes look like #A1B2C3.' }) colorHex?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) sku?: string;
  @ApiPropertyOptional({ description: 'Rupees; leave out to use the piece price' }) @IsOptional() @IsNumber() @Min(0) price?: number;
  @ApiProperty({ example: 4 }) @IsInt() @Min(0) @Max(100_000) stock!: number;
}

export class AutoTagDto {
  @ApiProperty({ description: 'The photo to read: an uploaded image URL or a data URI' })
  @IsString()
  @MaxLength(14_000_000)
  imageUrl!: string;

  @ApiPropertyOptional({ description: 'What the brand calls the piece, if it has a name yet' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

export const DESCRIBE_TONES = ['elegant', 'playful', 'minimal', 'festive'] as const;
export const DESCRIBE_LANGUAGES = ['english', 'hinglish'] as const;

export class DescribeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(14_000_000) imageUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) fabric?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) pattern?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(30, { each: true }) colors?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(40, { each: true }) occasions?: string[];
  @ApiPropertyOptional({ description: 'Anything the brand wants said, e.g. "hand-block printed in Jaipur"' }) @IsOptional() @IsString() @MaxLength(400) notes?: string;
  @ApiProperty({ enum: DESCRIBE_TONES }) @IsIn(DESCRIBE_TONES as unknown as string[]) tone!: (typeof DESCRIBE_TONES)[number];
  @ApiProperty({ enum: DESCRIBE_LANGUAGES }) @IsIn(DESCRIBE_LANGUAGES as unknown as string[]) language!: (typeof DESCRIBE_LANGUAGES)[number];
}

export class CheckPhotosDto {
  @ApiProperty({ description: 'Up to 25 pieces to check' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @IsString({ each: true })
  ids!: string[];
}
