import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface TwinProfileInput {
  gender?: string;
  age?: number;
  heightCm?: number;
  weightKg?: number;
  skinTone?: string;
  hairColor?: string;
  selfieUrl?: string;
  baseAvatarUrl?: string;
  /** Preferred Drape scene (StudioBackground id). */
  backgroundId?: string;
}

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
