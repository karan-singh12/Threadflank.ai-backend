import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStudioBackgroundDto {
  @ApiProperty({ description: 'Name of the background scene' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Category or theme e.g. Studio, Urban, Nature, Luxury, Party', default: 'Studio' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Photo backdrop image URL or uploaded asset path' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Fallback or stylized CSS background gradient' })
  @IsString()
  @IsOptional()
  cssGradient?: string;

  @ApiPropertyOptional({ description: 'Is default studio background', default: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'Active state', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Sort order', default: 0 })
  @IsInt()
  @IsOptional()
  order?: number;
}
