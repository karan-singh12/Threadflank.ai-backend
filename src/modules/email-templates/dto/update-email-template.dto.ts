import { PartialType, OmitType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateEmailTemplateDto } from './create-email-template.dto';

export class UpdateEmailTemplateDto extends PartialType(OmitType(CreateEmailTemplateDto, ['key'] as const)) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
