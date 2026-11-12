import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { BrandStatus } from '@prisma/client';

export class BrandPortalFilterDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(BrandStatus)
  status?: BrandStatus;
}

export enum VerificationAction {
  APPROVE = 'approve',
  REJECT = 'reject',
  SUSPEND = 'suspend',
}

export class VerificationDecisionDto {
  @IsEnum(VerificationAction)
  action!: VerificationAction;

  /** Required for reject and suspend; shown to the brand in the email. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SetAccountActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
