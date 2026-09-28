import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateEmailTemplateDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, { message: 'key must be lowercase, alphanumeric, hyphen/underscore-separated' })
  key: string;

  @IsString()
  name: string;

  @IsString()
  subject: string;

  @IsString()
  htmlBody: string;

  @IsOptional()
  @IsString({ each: true })
  variables?: string[];
}
