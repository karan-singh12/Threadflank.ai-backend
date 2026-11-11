import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SimulateVideoDto } from '../dto/brand-common.dto';
import { BrandAuthService } from '../auth/brand-auth.service';
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
    private readonly authService: BrandAuthService,
    private readonly catalogService: BrandCatalogService,
  ) {}

  getPresets(): MotionPreset[] {
    return this.presets;
  }

  async simulateVideo(dto: SimulateVideoDto) {
    const brand = await this.authService.getMe();
    const COST_PER_SIMULATION = 15;

    if (brand.aiCredits < COST_PER_SIMULATION) {
      throw new BadRequestException(
        `Insufficient AI Credits (${brand.aiCredits} available). You need at least ${COST_PER_SIMULATION} credits to run a Veo-2 motion simulation.`,
      );
    }

    // Determine target garment image
    let targetImageUrl = dto.customImageUrl;
    if (!targetImageUrl && dto.garmentId) {
      try {
        const garment = await this.catalogService.findOne(dto.garmentId);
        targetImageUrl = garment.images[0];
      } catch {
        targetImageUrl = 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b';
      }
    }

    if (!targetImageUrl) {
      targetImageUrl = 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b';
    }

    // Deduct credits from brand profile
    const remainingCredits = brand.aiCredits - COST_PER_SIMULATION;
    try {
      const dbBrand = await this.prisma.brand.findUnique({ where: { slug: 'raw-mango' } });
      if (dbBrand) {
        const social = ((dbBrand.socialLinks as any) || {});
        social.aiCredits = remainingCredits;
        await this.prisma.brand.update({
          where: { slug: 'raw-mango' },
          data: { socialLinks: social },
        });
      }
    } catch {
      // Non-blocking
    }

    const preset = this.presets.find((p) => p.id === dto.motionPreset) || this.presets[0];
    const simulationId = `sim_${Date.now()}`;

    // Return high-definition simulation result
    return {
      simulationId,
      status: 'completed',
      modelUsed: 'Veo-2 Motion Cinema (1080p)',
      presetUsed: preset.name,
      intensity: dto.motionIntensity,
      prompt: dto.prompt || preset.promptSuggestion,
      enhancedPrompt: dto.promptEnhance
        ? `${dto.prompt || preset.promptSuggestion}, 8k photorealistic, 60fps cinematic lighting, ultra-realistic cloth physics`
        : dto.prompt,
      sourceImageUrl: targetImageUrl,
      // Sample high-quality fashion movement video link
      previewVideoUrl:
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      thumbnailUrl: targetImageUrl,
      creditsDeducted: COST_PER_SIMULATION,
      remainingCredits,
      createdAt: new Date().toISOString(),
    };
  }
}

