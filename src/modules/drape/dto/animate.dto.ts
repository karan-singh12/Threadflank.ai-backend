import { IsIn, IsString } from 'class-validator';

export class AnimateDto {
    @IsString()
    image: string;

    @IsIn(['turn', 'walk', 'twirl', 'pose'])
    motion: 'turn' | 'walk' | 'twirl' | 'pose';
}
