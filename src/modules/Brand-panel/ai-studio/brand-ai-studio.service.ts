import { Injectable, BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GenerateContentDto, SimulateVideoDto } from '../dto/brand-common.dto';
import { SdkService } from '../../../sdk';
import { BrandCatalogService } from '../catalog/brand-catalog.service';

export interface MotionPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  cameraMovement: string;
  lighting: string;
  promptSuggestion: string;
  estimatedSeconds: number;
}

@Injectable()
export class BrandAiStudioService {
  private readonly presets: MotionPreset[] = [
    {
      id: 'red_carpet',
      name: 'Red Carpet Glow',
      badge: 'Cannes / Gala',
      description: 'Slow, majestic dolly-in with warm volumetric spotlights and subtle fabric breeze.',
      cameraMovement: 'Cinematic Dolly-In (0.5x)',
      lighting: '3200K Tungsten Warm + Rim Highlight',
      promptSuggestion: 'Slow elegant glide towards the camera, luxury evening gala, rich fabric texture shimmer',
      estimatedSeconds: 6,
    },
    {
      id: 'high_street',
      name: 'High-Street Stride',
      badge: 'Runway / Editorial',
      description: 'Dynamic tracking shot with crisp natural daylight and realistic garment momentum.',
      cameraMovement: 'Parallel Tracking Pan (1.2x)',
      lighting: '5600K Clean Daylight with Crisp Soft Shadow',
      promptSuggestion: 'Confident modern runway stride, crisp natural daylight, natural fabric drape momentum',
      estimatedSeconds: 5,
    },
    {
      id: 'silk_motion',
      name: 'Silk Motion',
      badge: 'Micro Detail / 120fps',
      description: 'Ultra slow-motion close-up emphasizing zari sheen, embroidery depth and flowing edges.',
      cameraMovement: 'Macro Arc Orbit (0.25x)',
      lighting: 'Softbox Diffused Studio Shimmer',
      promptSuggestion: 'Ultra slow-motion 120fps close up of handwoven brocade, subtle airflow revealing gold threads',
      estimatedSeconds: 8,
    },
    {
      id: 'velvet_glow',
      name: 'Velvet Glow',
      badge: 'Royal Nocturne',
      description: 'Moody chiaroscuro with 360-degree rotation highlighting deep pile and jewel tones.',
      cameraMovement: 'Full 360 Degree Slow Swivel',
      lighting: 'Low-Key Chiaroscuro with Specular Highlights',
      promptSuggestion: 'Royal nighttime ambiance, 360 rotation, dramatic specular highlights on rich velvet',
      estimatedSeconds: 7,
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: BrandCatalogService,
    private readonly sdk: SdkService,
  ) {}

  getPresets(): MotionPreset[] {
    return this.presets;
  }

  /**
   * Writes copy with the GenAI router. Credits are charged only after copy was actually produced,
   * so a provider outage never costs the brand anything.
   */
  async generateContent(brandId: string, dto: GenerateContentDto) {
    const COST_PER_CONTENT = 2;
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand || brand.isDeleted) throw new NotFoundException('Brand not found.');
    const social = (brand.socialLinks as Record<string, any> | null) ?? {};
    const credits: number = social.aiCredits ?? 0;
    if (credits < COST_PER_CONTENT) {
      throw new BadRequestException(`Insufficient AI Credits (${credits} available). Writing copy costs ${COST_PER_CONTENT} credits.`);
    }

    // Only this brand's own garment can be used as a source.
    const garment = dto.garmentId ? await this.catalogService.findOne(brandId, dto.garmentId) : undefined;
    const variants = dto.variants ?? 3;

    let options: string[];
    try {
      options = await this.sdk.generateBrandContent(
        {
          contentType: dto.contentType,
          brand: { name: brand.name, category: brand.category ?? undefined, story: brand.description ?? undefined },
          product: garment
            ? { title: garment.title, category: garment.category, price: garment.price, occasions: garment.occasions, colors: garment.colors, sizes: garment.sizes }
            : undefined,
          tone: dto.tone,
          language: dto.language,
          length: dto.length,
          keywords: (dto.keywords ?? []).map((k) => k.trim()).filter(Boolean),
          notes: dto.notes?.trim() || undefined,
          variants,
        },
        { requestedBy: `brand:${brandId}` },
      );
    } catch {
      throw new ServiceUnavailableException('The writing assistant is busy right now. No credits were charged. Please try again in a minute.');
    }
    if (options.length === 0) {
      throw new ServiceUnavailableException('We could not produce usable copy this time. No credits were charged. Please try again.');
    }

    const remainingCredits = await this.spendCredits(brandId, COST_PER_CONTENT);
    return {
      contentType: dto.contentType,
      garmentId: garment?.id ?? null,
      variants: options.map((text, i) => ({ id: `v${i + 1}`, text })),
      creditsDeducted: COST_PER_CONTENT,
      remainingCredits,
      createdAt: new Date().toISOString(),
    };
  }

  async simulateVideo(brandId: string, dto: SimulateVideoDto) {
    const COST_PER_SIMULATION = 15;

    // The source image is the uploaded photo or one of THIS brand's garments; never a made-up default.
    let sourceImageUrl = dto.customImageUrl;
    if (!sourceImageUrl && dto.garmentId) {
      sourceImageUrl = (await this.catalogService.findOne(brandId, dto.garmentId)).images[0];
    }
    if (!sourceImageUrl) {
      throw new BadRequestException('Choose a garment that has a photo, or upload one, before rendering.');
    }

    // The Veo-2 integration is not wired yet, so there is no real video to deliver. Never charge for,
    // or return, a placeholder clip. Set BRAND_VIDEO_PLACEHOLDER=true in dev to exercise the old flow.
    if (process.env.BRAND_VIDEO_PLACEHOLDER !== 'true') {
      throw new ServiceUnavailableException('Motion video rendering is not available yet. No credits were charged.');
    }

    const remainingCredits = await this.spendCredits(brandId, COST_PER_SIMULATION);
    const preset = this.presets.find((p) => p.id === dto.motionPreset) || this.presets[0];

    return {
      simulationId: `sim_${Date.now()}`,
      status: 'completed',
      modelUsed: 'Veo-2 Motion Cinema (1080p)',
      presetUsed: preset.name,
      intensity: dto.motionIntensity,
      prompt: dto.prompt || preset.promptSuggestion,
      enhancedPrompt: dto.promptEnhance
        ? `${dto.prompt || preset.promptSuggestion}, 8k photorealistic, 60fps cinematic lighting, ultra-realistic cloth physics`
        : dto.prompt,
      sourceImageUrl,
      previewVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      thumbnailUrl: sourceImageUrl,
      creditsDeducted: COST_PER_SIMULATION,
      remainingCredits,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Deducts credits stored on the brand row. Guarded by updatedAt so two renders racing on the
   * same balance can't both spend the same credits.
   */
  private async spendCredits(brandId: string, cost: number): Promise<number> {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand || brand.isDeleted) throw new NotFoundException('Brand not found.');

    const social = (brand.socialLinks as Record<string, any> | null) ?? {};
    const credits: number = social.aiCredits ?? 0;
    if (credits < cost) {
      throw new BadRequestException(
        `Insufficient AI Credits (${credits} available). You need at least ${cost} credits to run a motion simulation.`,
      );
    }

    const remaining = credits - cost;
    const { count } = await this.prisma.brand.updateMany({
      where: { id: brandId, updatedAt: brand.updatedAt },
      data: { socialLinks: { ...social, aiCredits: remaining } },
    });
    if (count === 0) throw new ConflictException('Your credits changed while rendering. Please try again.');
    return remaining;
  }
}
