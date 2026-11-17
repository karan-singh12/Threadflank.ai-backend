import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const TWIN_PARTS = ['both', 'portrait', 'body'] as const;
export type TwinPart = (typeof TWIN_PARTS)[number];

/** Builds the persistent twin from a selfie: a clean portrait and/or a full-body photo. */
export class TwinGenerateDto {
    /** The selfie to build from: data URI or public URL. */
    @IsString()
    image: string;

    /** What to generate. `both` (default) makes the portrait first, then the body from it. */
    @IsIn(TWIN_PARTS)
    @IsOptional()
    part?: TwinPart;

    @IsString()
    @IsOptional()
    @MaxLength(20)
    gender?: string;

    @Type(() => Number)
    @IsInt()
    @IsOptional()
    @Min(1)
    @Max(120)
    age?: number;

    @Type(() => Number)
    @IsInt()
    @IsOptional()
    @Min(50)
    @Max(250)
    heightCm?: number;

    @Type(() => Number)
    @IsInt()
    @IsOptional()
    @Min(10)
    @Max(300)
    weightKg?: number;

    @IsString()
    @IsOptional()
    @MaxLength(60)
    skinTone?: string;
}
