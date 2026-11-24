import { Injectable, BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GenerateContentDto, SaveContentDto } from '../dto/brand-common.dto';
import { SdkService } from '../../../sdk';
import { BrandCatalogService } from '../catalog/brand-catalog.service';

const LIBRARY_MAX = 500;

@Injectable()
export class BrandAiStudioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: BrandCatalogService,
    private readonly sdk: SdkService,
  ) {}

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

  // ── Saved copy (the content library) ──────────────────────────────────

  async listLibrary(brandId: string, type?: string) {
    return this.prisma.brandContentItem.findMany({
      where: { brandId, ...(type ? { contentType: type } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIBRARY_MAX,
    });
  }

  async saveToLibrary(brandId: string, dto: SaveContentDto) {
    if ((await this.prisma.brandContentItem.count({ where: { brandId } })) >= LIBRARY_MAX) {
      throw new BadRequestException(`Your library is full (${LIBRARY_MAX} items). Delete some older copy first.`);
    }
    if (dto.garmentId) await this.catalogService.findOne(brandId, dto.garmentId);
    const text = dto.text.trim();
    return this.prisma.brandContentItem.create({
      data: { brandId, contentType: dto.contentType, body: text, garmentId: dto.garmentId ?? null, title: (dto.title?.trim() || text.replace(/\s+/g, " ")).slice(0, 80) },
    });
  }

  async removeFromLibrary(brandId: string, id: string) {
    const { count } = await this.prisma.brandContentItem.deleteMany({ where: { id, brandId } });
    if (count === 0) throw new NotFoundException("Saved copy not found.");
    return { success: true, id };
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
        `Insufficient AI Credits (${credits} available). You need at least ${cost} credits.`,
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
