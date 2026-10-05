import { Inject, Injectable, BadRequestException, InternalServerErrorException, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { IStorageProvider, STORAGE_PROVIDER } from "../../shared/storage/storage.interface";
import { ImageProviderService } from "../../shared/image-provider/image-provider.service";
import { downloadStored } from "../../shared/storage/r2-objects";
import * as fs from "fs";
import * as path from "path";

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

export class GenerateTwinDto {
  @IsString()
  mode: "photo" | "avatar";

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  photo?: string;

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
  look?: string;
}

const BASE_SHOT =
  "professional fashion model photograph, full-body shot from head to toe, " +
  "standing straight facing the camera with arms relaxed naturally at the sides, " +
  "wearing a plain fitted white crew-neck t-shirt and slim dark charcoal trousers with simple white sneakers, " +
  "studio photography, soft diffused lighting, sharp focus, " +
  "plain solid light grey background, completely clean background with no objects no shadows no environment, " +
  "high-resolution realistic photograph, editorial fashion style, natural skin texture";

@Injectable()
export class TwinService {
  private readonly logger = new Logger(TwinService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageProvider: ImageProviderService,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
  ) {}

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

  /**
   * Generates a realistic model twin without background directly on the backend,
   * saves the generated image file into Cloudflare R2 / storage, and persists the twin profile in PostgreSQL.
   */
  async generateAndPersist(userId: string, input: GenerateTwinDto) {
    const gender = input.gender === "male" ? "man" : input.gender === "female" ? "woman" : "person";
    const bodyParts = [
      input.age ? `${Math.round(input.age)}-year-old ${gender}` : gender,
      input.heightCm ? `${Math.round(input.heightCm)} cm tall` : "",
      input.weightKg ? `weighing about ${Math.round(input.weightKg)} kg` : "",
      input.skinTone ? `${input.skinTone} skin tone` : "",
    ].filter(Boolean).join(", ");

    const look = input.look ? input.look.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : "";

    let prompt: string;
    if (input.mode === "photo" && input.photo) {
      prompt =
        `Create a realistic full-body fashion model photograph of this exact person, preserving their exact face, facial features, hairstyle and skin tone faithfully. ` +
        `They are a ${bodyParts}${look ? `, ${look}` : ""}. ` +
        `Show them as a ${BASE_SHOT}.`;
    } else {
      prompt = `Realistic full-body fashion model photograph of a ${bodyParts}${look ? `, ${look}` : ""}, ${BASE_SHOT}.`;
    }

    // Resolve photo data URL if provided (supporting data URI, remote URL, or local storage upload)
    let photoDataUrl: string | undefined;
    if (input.mode === "photo" && input.photo) {
      if (input.photo.startsWith("data:")) {
        photoDataUrl = input.photo;
      } else if (input.photo.startsWith("http://") || input.photo.startsWith("https://")) {
        try {
          const file = await downloadStored(input.photo);
          photoDataUrl = `data:${file.contentType};base64,${file.body.toString("base64")}`;
        } catch (e) {
          this.logger.warn(`Failed to fetch photo URL: ${e}`);
        }
      } else {
        const cleanPath = input.photo.replace(/^\/+/, "");
        const diskPath = path.join(process.cwd(), cleanPath);
        if (fs.existsSync(diskPath)) {
          const buf = fs.readFileSync(diskPath);
          const ext = path.extname(diskPath).toLowerCase().replace(".", "") || "jpeg";
          const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
          photoDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
        }
      }
    }

    let imageBuffer: Buffer;
    let providerName = "gemini";
    let modelName = "gemini-2.5-flash-image";

    try {
      // Delegate generation directly to ImageProviderService (Gemini / Replicate)
      const genResult = await this.imageProvider.generate({
        prompt,
        images: photoDataUrl ? [photoDataUrl] : [],
        aspectRatio: "3:4",
      });

      providerName = genResult.provider;
      modelName = genResult.model;

      if (genResult.url.startsWith("data:")) {
        const base64 = genResult.url.split(",")[1] || genResult.url;
        imageBuffer = Buffer.from(base64, "base64");
      } else {
        const res = await fetch(genResult.url);
        if (!res.ok) {
          throw new Error(`Failed to fetch generated twin image from ${genResult.url} (HTTP ${res.status})`);
        }
        imageBuffer = Buffer.from(await res.arrayBuffer());
      }
    } catch (aiErr: any) {
      this.logger.warn(
        `AI Twin Generation provider failed (${aiErr?.message || aiErr}). Using studio model template.`,
      );
      // Gracefully fall back to pre-rendered template avatar matching user's gender
      const isMale = input.gender === "male";
      const prefix = isMale ? "male_" : "female_";
      const randomIdx = Math.floor(Math.random() * 4) + 1;
      const avatarPath = path.join(process.cwd(), "public", "avatars", `${prefix}${randomIdx}.png`);
      if (fs.existsSync(avatarPath)) {
        imageBuffer = fs.readFileSync(avatarPath);
        providerName = "studio-template";
        modelName = `${prefix}${randomIdx}.png`;
      } else {
        throw aiErr;
      }
    }

    // Save directly to Cloudflare R2 / storage
    const filename = `twin-${userId}-${Date.now()}.png`;
    const saved = await this.storage.save({
      buffer: imageBuffer,
      filename,
      folder: "twin-images",
      mimetype: "image/png",
    });

    // Persist twin profile in PostgreSQL
    const profile = await this.prisma.twinProfile.upsert({
      where: { userId },
      create: {
        userId,
        baseAvatarUrl: saved.url,
        gender: input.gender,
        age: input.age,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
        skinTone: input.skinTone,
        selfieUrl: input.photo,
      },
      update: {
        baseAvatarUrl: saved.url,
        gender: input.gender ?? undefined,
        age: input.age ?? undefined,
        heightCm: input.heightCm ?? undefined,
        weightKg: input.weightKg ?? undefined,
        skinTone: input.skinTone ?? undefined,
        selfieUrl: input.photo ?? undefined,
      },
    });

    return {
      profile,
      imageUrl: saved.url,
      provider: providerName,
      model: modelName,
    };
  }
}
