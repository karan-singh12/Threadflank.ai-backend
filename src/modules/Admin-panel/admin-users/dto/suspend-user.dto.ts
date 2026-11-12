import { IsOptional, IsString } from 'class-validator';

export class SuspendUserDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
