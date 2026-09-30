import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export enum GarmentSlot {
    TOP = 'top',
    BOTTOM = 'bottom',
    DRESS = 'dress',
    SHOES = 'shoes',
    EYEWEAR = 'eyewear',
    HEADWEAR = 'headwear',
    BAG = 'bag',
    JEWELRY = 'jewelry',
}

export class SlotItem {
    @IsEnum(GarmentSlot)
    slot: GarmentSlot;

    @IsString()
    garmentUrl: string;
}

export class TryOnRequestDto {
    @IsString()
    modelImageUrl: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SlotItem)
    slots: SlotItem[];

    @IsString()
    @IsOptional()
    @MaxLength(500)
    prompt?: string;

    @IsBoolean()
    @IsOptional()
    removeBackground?: boolean;
}
