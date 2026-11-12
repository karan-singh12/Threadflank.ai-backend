import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateBrandPostDto } from './create-brand-post.dto';

export class UpdateBrandPostDto extends PartialType(OmitType(CreateBrandPostDto, ['brandId'] as const)) {}
