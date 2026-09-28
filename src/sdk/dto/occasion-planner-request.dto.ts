import { IsNumber, IsOptional, IsString } from 'class-validator';

export class OccasionPlannerRequestDto {
  @IsString()
  eventType: string;

  @IsOptional()
  @IsString()
  dressCode?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  budget?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
