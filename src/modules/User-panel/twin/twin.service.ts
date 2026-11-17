import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { ImageProviderService } from "../../../shared/image-provider/image-provider.service";
import { IStorageProvider, STORAGE_PROVIDER } from "../../../shared/storage/storage.interface";
import { downloadStored } from "../../../shared/storage/r2-objects";
import { IDENTITY_RULE, describeBody } from "../drape/drape-prompt.builder";
import { TwinGenerateDto } from "./dto/twin-generate.dto";

type BodyDetails = { gender?: string; age?: number; heightCm?: number; weightKg?: number; skinTone?: string };

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

const BACKDROP = 'on a plain light-grey seamless studio background with soft, even lighting';

/**
 * The person's selfie, body details and persistent twin. The twin is built once from the selfie
 * (a clean portrait, then a full-body photo), stored like a drape result, and reused by Drape.
 * All image generation goes through ImageProviderService.
 */
@Injectable()
export class TwinService {
  private readonly logger = new Logger(TwinService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageProvider: ImageProviderService,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
  ) {}

  /**
   * Builds the twin from a selfie and saves it on the profile: `avatarUrl` is the portrait,
   * `baseAvatarUrl` the full-body photo. With `both`, the body is drawn from the new portrait.
   */
  async generate(userId: string, dto: TwinGenerateDto) {
    const existing = await this.find(userId);
    const details = {
      gender: dto.gender ?? existing?.gender ?? undefined,
      age: dto.age ?? existing?.age ?? undefined,
      heightCm: dto.heightCm ?? existing?.heightCm ?? undefined,
      weightKg: dto.weightKg ?? existing?.weightKg ?? undefined,
      skinTone: dto.skinTone ?? existing?.skinTone ?? undefined,
    };
    const part = dto.part ?? 'both';
    const stamp = Date.now();
    const saved: { avatarUrl?: string; baseAvatarUrl?: string } = {};
    let source = dto.image;

    if (part !== 'body') {
      const job = this.portraitPrompt(dto.image, details);
      const made = await this.imageProvider.generate({ ...job, aspectRatio: '3:4', engines: ['gemini'] });
      saved.avatarUrl = await this.store(made.url, `portrait-${userId}-${stamp}.png`);
      source = made.url;
    }
    if (part !== 'portrait') {
      const job = this.bodyPrompt(source, details);
      const made = await this.imageProvider.generate({ ...job, aspectRatio: '3:4', engines: ['gemini'] });
      saved.baseAvatarUrl = await this.store(made.url, `body-${userId}-${stamp}.png`);
    }

    return this.upsert(userId, { ...details, ...saved });
  }

  private portraitPrompt(image: string, details: BodyDetails) {
    const prompt = [
      `Image 1 is a casual selfie of ${describeBody({ body: details })}. Create a clean studio portrait of this exact person: head and shoulders, facing the camera with a relaxed, natural expression, wearing a plain neutral crew-neck top, ${BACKDROP}.`,
      IDENTITY_RULE,
      'Do not copy the selfie’s framing, background or clothing. Photorealistic, with no text or watermark.',
    ].join('\n');
    return { prompt, images: [image] };
  }

  private bodyPrompt(image: string, details: BodyDetails) {
    const prompt = [
      `Image 1 shows the face of ${describeBody({ body: details })}. Create a full-body photo of this exact person: head to feet in frame, standing straight and facing the camera with arms relaxed at their sides, ${BACKDROP}.`,
      'Dress them in simple, fitted, plain clothes (a plain white t-shirt and slim grey trousers, plain shoes) so their body shape is clearly readable. Give them natural proportions for the stated height, weight and age, never idealised.',
      IDENTITY_RULE,
      'Do not copy the reference’s framing or background. Photorealistic, high detail, with no text or watermark.',
    ].join('\n');
    return { prompt, images: [image] };
  }

  /** Keeps our own copy of a generated image (a URL or a data URI) and returns its stored URL. */
  private async store(urlOrData: string, filename: string): Promise<string> {
    const buffer = urlOrData.startsWith('data:')
      ? Buffer.from(urlOrData.split(',')[1] ?? '', 'base64')
      : (await downloadStored(urlOrData)).body;
    const result = await this.storage.save({ buffer, filename, folder: 'twins', mimetype: 'image/png' });
    this.logger.log(`Saved ${filename}`);
    return result.url;
  }

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
