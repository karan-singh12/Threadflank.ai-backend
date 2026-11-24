import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ContentStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class SetPlanDto {
  @IsIn(['FREE', 'GROWTH', 'PRO'])
  plan!: 'FREE' | 'GROWTH' | 'PRO';

  /** How long a paid plan runs from today. Ignored for Free. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  days?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class GstDecisionDto {
  @IsBoolean()
  verified!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class InviteOwnerDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}

export class LookDecisionDto {
  @IsIn(['APPROVED', 'DECLINED'])
  status!: 'APPROVED' | 'DECLINED';
}

export class ModerationReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class AdminCatalogQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(40) brandId?: string;
  @IsOptional() @IsIn(Object.values(ContentStatus)) status?: ContentStatus;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsIn(['yes', 'no']) drapeReady?: 'yes' | 'no';
  @IsOptional() @IsIn(['out', 'low']) stock?: 'out' | 'low';
  @IsOptional() @IsIn(['newest', 'drapes', 'clicks', 'price']) sort?: 'newest' | 'drapes' | 'clicks' | 'price';
}

export class AdminCatalogStatusDto {
  @IsIn(['DRAFT', 'PUBLISHED'])
  status!: 'DRAFT' | 'PUBLISHED';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class RankingsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(7)
  month?: string;
}
