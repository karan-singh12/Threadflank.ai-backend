import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { BrandStatus } from '@prisma/client';

export class BrandPortalFilterDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(BrandStatus)
  status?: BrandStatus;

  /** pending = a GSTIN is on file and not yet checked. */
  @IsOptional()
  @IsIn(['pending', 'verified', 'none'])
  gst?: 'pending' | 'verified' | 'none';

  /** The stored plan; a lapsed paid plan still matches its name here. */
  @IsOptional()
  @IsIn(['FREE', 'GROWTH', 'PRO'])
  plan?: 'FREE' | 'GROWTH' | 'PRO';
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

/** Send exactly one of delta (add or remove) or set (exact balance). A reason is always required. */
export class AdjustCreditsDto {
  @IsOptional()
  @IsInt()
  @Min(-100_000)
  @Max(100_000)
  delta?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  set?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
