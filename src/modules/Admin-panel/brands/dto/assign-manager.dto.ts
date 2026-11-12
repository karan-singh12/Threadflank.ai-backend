import { IsString } from 'class-validator';

export class AssignManagerDto {
  @IsString()
  adminUserId: string;
}
