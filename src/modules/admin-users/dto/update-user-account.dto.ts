import { IsIn } from 'class-validator';

export class UpdateUserAccountDto {
  @IsIn(['NORMAL', 'PURCHASED'])
  accountType!: 'NORMAL' | 'PURCHASED';
}
