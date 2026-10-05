import { PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, NotEquals } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class CreateOrderDto {
    @IsString()
    @IsNotEmpty()
    packId: string;
}

/** What Razorpay Checkout hands back on success. */
export class VerifyPaymentDto {
    @IsString()
    @IsNotEmpty()
    orderId: string;

    @IsString()
    @IsNotEmpty()
    paymentId: string;

    @IsString()
    @IsNotEmpty()
    signature: string;
}

export class CreditPackDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(60)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    description?: string;

    /** Price in rupees (₹49 → 49). Razorpay's minimum is ₹1. */
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(1)
    @Max(500000)
    price: number;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100000)
    credits: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsBoolean()
    isFeatured?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    order?: number;
}

export class UpdateCreditPackDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(60)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    description?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(1)
    @Max(500000)
    price?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100000)
    credits?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsBoolean()
    isFeatured?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    order?: number;
}

export class UpdateBillingSettingsDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(1000)
    freeCredits?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(1000)
    videoCost?: number;
}

export class AdjustCreditsDto {
    @IsEmail()
    email: string;

    /** Positive adds credits, negative removes them. */
    @Type(() => Number)
    @IsInt()
    @NotEquals(0)
    @Min(-100000)
    @Max(100000)
    delta: number;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;
}

export class PaymentsFilterDto extends PaginationQueryDto {
    @IsOptional()
    @IsEnum(PaymentStatus)
    status?: PaymentStatus;

    @IsOptional()
    @IsString()
    search?: string;
}
