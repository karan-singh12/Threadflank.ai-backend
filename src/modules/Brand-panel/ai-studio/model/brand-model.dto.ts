import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BACKDROP_PRESET_IDS, FRAMING_PRESET_IDS, MODEL_PRESET_IDS, POSE_PRESET_IDS } from './model-presets';
import { PHOTO_TOOL_IDS, type PhotoToolId } from './photo-tools';

/**
 * One model shoot: whose garment, on which model, held how, against what.
 *
 * Every preset is validated against the lists in `model-presets.ts`, so the prompt the engine is
 * given is always words we wrote — a brand can pick from the cast, it cannot write the cast.
 */
export class CreateModelShotDto {
  @ApiPropertyOptional({ example: 'prod_01', description: "One of the brand's garments; its first photo is the piece" })
  @IsString()
  @MaxLength(40)
  @IsOptional()
  garmentId?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/kurta-flat.jpg', description: 'A photo the brand uploaded instead' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  customImageUrl?: string;

  @ApiProperty({ example: 'regular', enum: MODEL_PRESET_IDS })
  @IsIn(MODEL_PRESET_IDS)
  modelId!: string;

  @ApiProperty({ example: 'front', enum: POSE_PRESET_IDS })
  @IsIn(POSE_PRESET_IDS)
  poseId!: string;

  @ApiProperty({ example: 'studio-grey', enum: BACKDROP_PRESET_IDS })
  @IsIn(BACKDROP_PRESET_IDS)
  backdropId!: string;

  @ApiPropertyOptional({ example: 'full', enum: FRAMING_PRESET_IDS, default: 'full' })
  @IsIn(FRAMING_PRESET_IDS)
  @IsOptional()
  framingId?: string;

  @ApiPropertyOptional({ example: 'Styled with gold jhumkas and a soft centre parting' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  direction?: string;
}

/** One photo tool run (see photo-tools.ts). */
export class PhotoToolDto {
  @ApiProperty({ enum: PHOTO_TOOL_IDS })
  @IsIn(PHOTO_TOOL_IDS)
  tool!: PhotoToolId;

  @ApiPropertyOptional({ description: "One of the brand's garments; its first photo is used" })
  @IsString()
  @MaxLength(40)
  @IsOptional()
  garmentId?: string;

  @ApiPropertyOptional({ description: 'A photo the brand uploaded instead' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  customImageUrl?: string;

  @ApiPropertyOptional({ enum: BACKDROP_PRESET_IDS, description: 'Background swap and ad creative' })
  @IsIn(BACKDROP_PRESET_IDS)
  @IsOptional()
  backdropId?: string;

  @ApiPropertyOptional({ enum: ['square', 'story'], description: 'Ad creative only' })
  @IsIn(['square', 'story'])
  @IsOptional()
  format?: 'square' | 'story';

  @ApiPropertyOptional({ example: 'The Diwali Edit is here', description: 'Ad creative only: printed on the image' })
  @IsString()
  @MaxLength(60)
  @IsOptional()
  headline?: string;
}
