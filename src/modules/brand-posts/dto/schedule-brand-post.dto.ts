import { IsDateString } from 'class-validator';

export class ScheduleBrandPostDto {
  @IsDateString()
  scheduledAt: string;
}
