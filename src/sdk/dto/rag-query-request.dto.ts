import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RagQueryRequestDto {
  @IsString()
  question: string;

  @IsOptional()
  @IsString()
  namespace?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  topK?: number;
}
