import { IsEmail, IsObject, IsOptional } from 'class-validator';

export class PreviewTemplateDto {
  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}

export class SendTestEmailDto extends PreviewTemplateDto {
  @IsEmail()
  to: string;
}
