import { IsDefined, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { ContentBlockType } from '@prisma/client';

export class CreateContentBlockDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, { message: 'key must be lowercase, alphanumeric, hyphen/underscore-separated' })
  key: string;

  @IsEnum(ContentBlockType)
  type: ContentBlockType;

  @IsOptional()
  @IsString()
  title?: string;

  /** Flexible JSON payload — shape depends on `type` (rich blocks, FAQ Q&A, plain legal text, etc). */
  @IsDefined()
  body: unknown;
}
