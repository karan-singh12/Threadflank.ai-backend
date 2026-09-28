import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class WardrobeCombosRequestDto {
  @IsOptional()
  @IsString()
  occasion?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  count?: number;

  @IsOptional()
  @IsBoolean()
  focusUnderused?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
