import { IsString, MinLength } from 'class-validator';

export class AddBrandPostCommentDto {
  @IsString()
  @MinLength(1)
  content: string;
}
