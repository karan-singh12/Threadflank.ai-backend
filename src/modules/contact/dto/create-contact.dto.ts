import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateContactInquiryDto {
  @ApiProperty({ example: 'Karan Singh' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'karan@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'support' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  topic: string;

  @ApiProperty({ example: 'I need help with my account digital twin generation.' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(3000)
  message: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}
