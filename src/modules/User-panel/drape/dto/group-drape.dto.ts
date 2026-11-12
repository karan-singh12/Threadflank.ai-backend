import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { GarmentSlot } from './tryon.dto';

/** People in one look: you plus one Twin Circle member. */
export const GROUP_MAX_PEOPLE = 2;
export const MAX_PIECES_PER_PERSON = 8;

/** Group postures the form offers; `auto` derives one from the people's relations. */
export const GROUP_POSTURES = ['auto', 'couple', 'friends', 'family', 'siblings', 'formal', 'walking', 'seated'] as const;
export type GroupPosture = (typeof GROUP_POSTURES)[number];

/** One garment or accessory on one person: a reference image, a description, or both. */
export class OutfitPieceDto {
    @IsEnum(GarmentSlot)
    slot: GarmentSlot;

    /** Data URI or public URL of the product photo. */
    @IsString()
    @IsOptional()
    image?: string;

    /** Text for pieces without a photo ("emerald silk saree with gold zari border"). */
    @IsString()
    @IsOptional()
    @MaxLength(400)
    description?: string;

    @IsString()
    @IsOptional()
    @MaxLength(60)
    label?: string;

    /** Ethnic garment kind (saree, lehenga, sherwani…) for drape-aware rendering. */
    @IsString()
    @IsOptional()
    @MaxLength(40)
    kind?: string;

    /** Drape guidance for `kind`, sent by the client from its garment catalogue. */
    @IsString()
    @IsOptional()
    @MaxLength(400)
    drape?: string;
}

export class BodyDto {
    @IsString()
    @IsOptional()
    @MaxLength(20)
    gender?: string;

    @IsInt()
    @IsOptional()
    @Min(1)
    @Max(120)
    age?: number;

    @IsInt()
    @IsOptional()
    @Min(50)
    @Max(250)
    heightCm?: number;

    @IsInt()
    @IsOptional()
    @Min(10)
    @Max(300)
    weightKg?: number;

    @IsString()
    @IsOptional()
    @MaxLength(60)
    skinTone?: string;
}

export class PersonSpecDto {
    /** Client id for the person ("me" or a circle member id); echoed back in the result. */
    @IsString()
    @MaxLength(64)
    ref: string;

    @IsString()
    @MaxLength(60)
    name: string;

    /** Relation to the owner: "You", "Partner", "Friend", "Sibling", "Parent", "Child", "Family". */
    @IsString()
    @IsOptional()
    @MaxLength(30)
    relation?: string;

    /** The person's persistent twin (or photo): data URI or public URL. */
    @IsString()
    twinImage: string;

    @ValidateNested()
    @Type(() => BodyDto)
    @IsOptional()
    body?: BodyDto;

    @IsArray()
    @ArrayMaxSize(MAX_PIECES_PER_PERSON)
    @ValidateNested({ each: true })
    @Type(() => OutfitPieceDto)
    outfit: OutfitPieceDto[];

    @IsString()
    @IsOptional()
    @MaxLength(300)
    notes?: string;
}

export class SceneSpecDto {
    @IsString()
    @MaxLength(80)
    name: string;

    @IsString()
    @IsOptional()
    @MaxLength(80)
    category?: string;

    /** Backdrop photo to place the group in: data URI or public URL. */
    @IsString()
    @IsOptional()
    imageUrl?: string;
}

export class GroupDrapeDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(GROUP_MAX_PEOPLE)
    @ValidateNested({ each: true })
    @Type(() => PersonSpecDto)
    people: PersonSpecDto[];

    @IsEnum(GROUP_POSTURES)
    @IsOptional()
    posture?: GroupPosture;

    @ValidateNested()
    @Type(() => SceneSpecDto)
    @IsOptional()
    scene?: SceneSpecDto;

    /** Styling notes for the whole render. */
    @IsString()
    @IsOptional()
    @MaxLength(500)
    styling?: string;
}
