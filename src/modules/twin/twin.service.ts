import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

import { IsOptional, IsString, IsNumber } from "class-validator";
import { Type } from "class-transformer";

export class TwinProfileInput {
  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  age?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  heightCm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weightKg?: number;

  @IsOptional()
  @IsString()
  skinTone?: string;

  @IsOptional()
  @IsString()
  hairColor?: string;

  @IsOptional()
  @IsString()
  selfieUrl?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  baseAvatarUrl?: string;
}

/**
 * The person's selfie and body details. Drape renders them straight from these (face from
 * the selfie, build from the details), so no AI twin is generated or stored any more.
 */
@Injectable()
export class TwinService {
  constructor(private readonly prisma: PrismaService) {}

  async find(userId: string) {
    return this.prisma.twinProfile.findUnique({ where: { userId } });
  }

  async upsert(userId: string, data: TwinProfileInput) {
    return this.prisma.twinProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data },
    });
  }
}
