import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class MakeupOptions {
    @IsString()
    @IsOptional()
    lipstick?: string;

    @IsString()
    @IsOptional()
    eyeshadow?: string;

    @IsNumber()
    @IsOptional()
    @Min(0)
    @Max(100)
    blush?: number;

    @IsIn(['matte', 'gloss', 'satin'])
    @IsOptional()
    finish?: string;
}

export class LookEditDto {
    @IsString()
    image: string;

    @IsIn(['pose', 'makeup', 'describe'])
    mode: 'pose' | 'makeup' | 'describe';

    @IsString()
    @IsOptional()
    pose?: string;

    @ValidateNested()
    @Type(() => MakeupOptions)
    @IsOptional()
    makeup?: MakeupOptions;

    @IsString()
    @IsOptional()
    prompt?: string;
}
