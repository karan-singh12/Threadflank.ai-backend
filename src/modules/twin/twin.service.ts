import { Injectable, BadRequestException, InternalServerErrorException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { LocalStorageProvider } from "../../shared/storage/local-storage.provider";
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
  baseAvatarUrl?: string;

  @IsOptional()
  @IsString()
  backgroundId?: string;
}

export class GenerateTwinDto {
  @IsOptional()
  @IsString()
  mode?: "photo" | "synthetic";

  @IsOptional()
  @IsString()
  photo?: string;

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
  look?: string;
}

const BASE_SHOT_3D =
  "full-body 3D digital character avatar, Unreal Engine 5 Metahuman style, 3D character render, octane lighting, " +
  "standing straight facing the camera, arms relaxed at the sides, full body visible from head to feet, " +
  "wearing a plain fitted white t-shirt and slim dark trousers with simple white sneakers, " +
  "soft clean 3D studio lighting, smooth 3D skin shading, octane render, 3D character design, " +
  "directly isolated character with no background from the AI itself, solid plain neutral backdrop with absolutely no background elements or environment, sharp focus, 8k resolution 3D model";

@Injectable()
export class TwinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStorage: LocalStorageProvider
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
   * Generates a 3D digital twin without background directly on the backend,
   * saves the generated image file into cloud/local storage, and persists the twin profile in PostgreSQL.
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
        `Create a full-body 3D stylized digital human character avatar of this exact person without any background, transforming their face, facial features, hairstyle and skin tone into a sleek 3D Metahuman digital twin character. ` +
        `They are a ${bodyParts}${look ? `, ${look}` : ""}. Show them ${BASE_SHOT_3D}.`;
    } else {
      prompt = `Full-body 3D stylized digital human character avatar of a ${bodyParts}${look ? `, ${look}` : ""} without any background, ${BASE_SHOT_3D}.`;
    }

    // Resolve photo data URL if provided (supporting data URI, remote URL, or local storage upload)
    let photoDataUrl: string | undefined;
    if (input.mode === "photo" && input.photo) {
      if (input.photo.startsWith("data:")) {
        photoDataUrl = input.photo;
      } else if (input.photo.startsWith("http://") || input.photo.startsWith("https://")) {
        try {
          const fetched = await fetch(input.photo);
          if (fetched.ok) {
            const buf = Buffer.from(await fetched.arrayBuffer());
            const mime = fetched.headers.get("content-type") || "image/jpeg";
            photoDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
          }
        } catch (e) {
          console.warn("[twin-service] Failed to fetch photo URL:", e);
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
    try {
      imageBuffer = await this.callAiGeneration(prompt, photoDataUrl);
    } catch (aiErr: any) {
      console.warn("[twin-service] Live AI provider call failed, falling back to 3D avatar template:", aiErr?.message || aiErr);
      imageBuffer = await this.getFallback3DAvatarBuffer(input.gender, input.photo);
    }

    // Save directly to backend storage
    const saved = await this.localStorage.save({
      buffer: imageBuffer,
      filename: `twin-${userId}-${Date.now()}.png`,
      imagePath: "twins",
      fieldname: "avatar",
      mimetype: "image/png",
      encoding: "7bit",
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
    };
  }

  /**
   * Calls AI providers (Gemini, OpenAI, Replicate, OpenRouter) with fallback.
   */
  private async callAiGeneration(prompt: string, photoDataUrl?: string): Promise<Buffer> {
    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    const openrouterKey = process.env.OPENROUTER_API_KEY;

    // 1. Try Replicate if token available
    if (replicateToken) {
      try {
        const model = photoDataUrl ? "black-forest-labs/flux-kontext-pro" : "black-forest-labs/flux-schnell";
        const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${replicateToken}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          body: JSON.stringify({
            input: photoDataUrl ? { prompt, input_image: photoDataUrl, aspect_ratio: "3:4" } : { prompt, aspect_ratio: "3:4" },
          }),
        });
        if (res.ok) {
          const pred = await res.json();
          const output = Array.isArray(pred.output) ? pred.output[0] : pred.output;
          if (output && typeof output === "string") {
            const imgRes = await fetch(output);
            if (imgRes.ok) return Buffer.from(await imgRes.arrayBuffer());
          }
        }
      } catch (e) {
        console.warn("[twin-backend] Replicate call failed, trying next provider:", e);
      }
    }

    // 2. Try Gemini
    if (geminiKey) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`;
        const parts: any[] = [{ text: prompt }];
        if (photoDataUrl && photoDataUrl.includes(",")) {
          const [header, b64] = photoDataUrl.split(",");
          const mime = header.split(";")[0]?.replace("data:", "") || "image/jpeg";
          parts.unshift({ inlineData: { mimeType: mime, data: b64 } });
        }

        const res = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const imgData = data?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data)?.inlineData?.data;
          if (imgData) return Buffer.from(imgData, "base64");
        }
      } catch (e) {
        console.warn("[twin-backend] Gemini image call failed, trying next provider:", e);
      }
    }

    // 3. Try OpenAI
    if (openaiKey) {
      try {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "dall-e-3",
            prompt,
            size: "1024x1024",
            quality: "standard",
            n: 1,
            response_format: "b64_json",
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const b64 = data?.data?.[0]?.b64_json;
          if (b64) return Buffer.from(b64, "base64");
          const url = data?.data?.[0]?.url;
          if (url) {
            const imgRes = await fetch(url);
            if (imgRes.ok) return Buffer.from(await imgRes.arrayBuffer());
          }
        }
      } catch (e) {
        console.warn("[twin-backend] OpenAI image call failed, trying next provider:", e);
      }
    }

    // 4. Try OpenRouter
    if (openrouterKey) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openrouterKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-image",
            modalities: ["image", "text"],
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const choice = data?.choices?.[0]?.message;
          const imgUrl = choice?.content?.find?.((c: any) => c.type === "image_url")?.image_url?.url || choice?.image_url?.url;
          if (imgUrl) {
            if (imgUrl.startsWith("data:")) {
              return Buffer.from(imgUrl.split(",")[1], "base64");
            }
            const imgRes = await fetch(imgUrl);
            if (imgRes.ok) return Buffer.from(await imgRes.arrayBuffer());
          }
        }
      } catch (e) {
        console.warn("[twin-backend] OpenRouter image call failed:", e);
      }
    }

    throw new InternalServerErrorException("Could not generate 3D twin avatar. All backend AI providers failed or were not configured.");
  }

  private async getFallback3DAvatarBuffer(gender?: string, photo?: string): Promise<Buffer> {
    const isMale = gender === "male";
    const prefix = isMale ? "male_" : "female_";
    const randomIdx = Math.floor(Math.random() * 4) + 1; // 1 to 4
    const avatarFilename = `${prefix}${randomIdx}.png`;
    const avatarPath = path.join(process.cwd(), "public", "avatars", avatarFilename);

    if (fs.existsSync(avatarPath)) {
      return fs.readFileSync(avatarPath);
    }

    const avatarsDir = path.join(process.cwd(), "public", "avatars");
    if (fs.existsSync(avatarsDir)) {
      const files = fs.readdirSync(avatarsDir).filter((f) => f.endsWith(".png"));
      if (files.length > 0) {
        return fs.readFileSync(path.join(avatarsDir, files[0]));
      }
    }

    throw new InternalServerErrorException("Could not generate 3D twin avatar: no template or AI provider available.");
  }
}
