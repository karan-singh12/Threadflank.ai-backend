import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ImageProviderService } from '../../../../shared/image-provider/image-provider.service';
import { IStorageProvider, STORAGE_PROVIDER } from '../../../../shared/storage/storage.interface';
import { grantBrandCredits, spendBrandCredits } from '../../billing/brand-credits';
import { BrandCatalogService } from '../../catalog/brand-catalog.service';
import { asDataUri, loadSourceImage } from '../source-image';
import { CreateModelShotDto } from './brand-model.dto';
import {
  BACKDROP_PRESETS,
  FRAMING_PRESETS,
  MODEL_PRESETS,
  POSE_PRESETS,
  findBackdrop,
  findFraming,
  findModel,
  findPose,
} from './model-presets';
import { buildShootPrompt } from './model-prompt';
import { PHOTO_TOOL_COST, photoToolPrompt, TOOL_PREFIX, toolLabel } from './photo-tools';
import { PhotoToolDto } from './brand-model.dto';

/** Credits one model shot costs. Taken when it starts, given straight back if the engine fails. */
export const MODEL_SHOT_COST = 6;
/** Shots kept in a brand's gallery. */
const GALLERY_MAX = 120;
/** A single render; the engines usually answer well inside this. */
const RENDER_TIMEOUT_MS = 180_000;

type ShotRow = Awaited<ReturnType<PrismaService['brandModelShot']['findFirstOrThrow']>>;

/**
 * Model shoots for brands: a flat garment photo goes in, the piece worn by a model comes out.
 *
 * Unlike a motion video, an image render answers in one call, so a shoot is done inside the
 * request: credits are taken, the engine is asked, and the result is either stored as a READY row
 * or the credits are given back and the brand is told why. Nothing half-finished is ever left
 * behind for the panel to poll.
 */
@Injectable()
export class BrandModelService {
  private readonly logger = new Logger(BrandModelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: BrandCatalogService,
    private readonly images: ImageProviderService,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
  ) {}

  /** The whole cast and set, for the panel to draw its pickers from. */
  presets() {
    return {
      models: MODEL_PRESETS,
      poses: POSE_PRESETS,
      backdrops: BACKDROP_PRESETS,
      framings: FRAMING_PRESETS,
      cost: MODEL_SHOT_COST,
    };
  }

  /**
   * Whether a shoot can run at all right now. The panel asks before it offers the button, so a
   * brand is told "not connected" instead of being charged and then failed.
   */
  status() {
    return { available: this.images.hasEngine(['gemini']), cost: MODEL_SHOT_COST };
  }

  async create(brandId: string, dto: CreateModelShotDto) {
    const model = findModel(dto.modelId);
    const pose = findPose(dto.poseId);
    const backdrop = findBackdrop(dto.backdropId);
    const framing = findFraming(dto.framingId ?? 'full');
    if (!model || !pose || !backdrop || !framing) throw new BadRequestException('Choose a model, a pose and a backdrop from the studio.');

    // The piece is the brand's own garment, or a photo it uploaded. Never a stand-in.
    const garment = dto.garmentId ? await this.catalog.findOne(brandId, dto.garmentId) : undefined;
    const sourceImageUrl = dto.customImageUrl?.trim() || garment?.images?.[0];
    if (!sourceImageUrl) throw new BadRequestException('Choose a garment that has a photo, or upload one, before shooting.');

    if (!this.images.hasEngine(['gemini'])) {
      throw new ServiceUnavailableException('Model shoots are not connected yet. No credits were charged.');
    }

    const source = await loadSourceImage(sourceImageUrl);
    const prompt = buildShootPrompt({
      model,
      pose,
      backdrop,
      framing,
      garment: garment ? { title: garment.title, category: garment.category, colors: garment.colors } : undefined,
      direction: dto.direction,
    });

    const remaining = await spendBrandCredits(this.prisma, brandId, MODEL_SHOT_COST);
    if (remaining === null) {
      throw new BadRequestException(`A model shot costs ${MODEL_SHOT_COST} AI credits. Buy a credit pack to keep shooting.`);
    }

    let imageUrl: string;
    let provider = 'unknown';
    let engineModel = 'unknown';
    try {
      const result = await this.withTimeout(
        this.images.generate({
          prompt,
          images: [asDataUri(source)],
          // A shoot has to read the garment photo, so it needs an engine that takes a reference image.
          engines: ['gemini'],
          aspectRatio: framing.id === 'detail' ? '1:1' : '3:4',
        }),
      );
      provider = result.provider;
      engineModel = result.model;
      imageUrl = await this.store(result.url, brandId);
    } catch (err) {
      await grantBrandCredits(this.prisma, brandId, MODEL_SHOT_COST);
      this.logger.warn(`Model shoot failed for brand ${brandId}: ${err}`);
      throw new ServiceUnavailableException(
        `The shoot could not be rendered: ${this.reason(err)} No credits were charged.`,
      );
    }

    const shot = await this.prisma.brandModelShot.create({
      data: {
        brandId,
        garmentId: garment?.id ?? null,
        modelId: model.id,
        poseId: pose.id,
        backdropId: backdrop.id,
        framingId: framing.id,
        direction: dto.direction?.trim() || null,
        prompt,
        sourceImageUrl,
        imageUrl,
        provider,
        model: engineModel,
        credits: MODEL_SHOT_COST,
      },
    });
    await this.trim(brandId);
    return { shot: this.toView(shot), remainingCredits: remaining };
  }

  /**
   * A photo tool (background swap, ghost mannequin, ad creative) on one of the brand's garment
   * photos or an upload. Charged like a shoot: taken up front, given back if the render fails.
   */
  async edit(brandId: string, dto: PhotoToolDto) {
    let plan: ReturnType<typeof photoToolPrompt>;
    try {
      plan = photoToolPrompt({ tool: dto.tool, backdropId: dto.backdropId, format: dto.format, headline: dto.headline });
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Choose the tool options.');
    }
    const garment = dto.garmentId ? await this.catalog.findOne(brandId, dto.garmentId) : undefined;
    const sourceImageUrl = dto.customImageUrl?.trim() || garment?.images?.[0];
    if (!sourceImageUrl) throw new BadRequestException('Choose a garment that has a photo, or upload one.');
    if (!this.images.hasEngine(['gemini'])) throw new ServiceUnavailableException('Photo tools are not connected yet. No credits were charged.');

    const source = await loadSourceImage(sourceImageUrl);
    const remaining = await spendBrandCredits(this.prisma, brandId, PHOTO_TOOL_COST);
    if (remaining === null) throw new BadRequestException(`This costs ${PHOTO_TOOL_COST} AI credits. Buy a credit pack to keep going.`);

    let imageUrl: string;
    let provider = 'unknown';
    let engineModel = 'unknown';
    try {
      const result = await this.withTimeout(this.images.generate({ prompt: plan.prompt, images: [asDataUri(source)], engines: ['gemini'], aspectRatio: plan.aspectRatio }));
      provider = result.provider;
      engineModel = result.model;
      imageUrl = await this.store(result.url, brandId);
    } catch (err) {
      await grantBrandCredits(this.prisma, brandId, PHOTO_TOOL_COST);
      this.logger.warn(`Photo tool ${dto.tool} failed for brand ${brandId}: ${err}`);
      throw new ServiceUnavailableException(`It could not be rendered: ${this.reason(err)} No credits were charged.`);
    }

    const shot = await this.prisma.brandModelShot.create({
      data: {
        brandId,
        garmentId: garment?.id ?? null,
        modelId: `${TOOL_PREFIX}${dto.tool}`,
        poseId: '-',
        backdropId: plan.backdropId,
        framingId: plan.aspectRatio === '3:4' ? 'full' : plan.aspectRatio === '1:1' ? 'square' : 'story',
        direction: dto.headline?.trim() || null,
        prompt: plan.prompt,
        sourceImageUrl,
        imageUrl,
        provider,
        model: engineModel,
        credits: PHOTO_TOOL_COST,
      },
    });
    await this.trim(brandId);
    return { shot: this.toView(shot), remainingCredits: remaining };
  }

  async list(brandId: string) {
    const rows = await this.prisma.brandModelShot.findMany({
      where: { brandId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: GALLERY_MAX,
    });
    return rows.map((r) => this.toView(r));
  }

  async get(brandId: string, id: string) {
    const row = await this.prisma.brandModelShot.findFirst({ where: { id, brandId } });
    if (!row) throw new NotFoundException('Model shot not found.');
    return this.toView(row);
  }

  async remove(brandId: string, id: string) {
    const { count } = await this.prisma.brandModelShot.deleteMany({ where: { id, brandId } });
    if (count === 0) throw new NotFoundException('Model shot not found.');
    return { success: true, id };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Puts the finished frame in our own storage, so it survives the engine's temporary URL. */
  private async store(urlOrData: string, brandId: string): Promise<string> {
    const image = await loadSourceImage(urlOrData);
    const saved = await this.storage.save({
      buffer: image.bytes,
      filename: `brand-model-${brandId}-${Date.now()}.png`,
      folder: 'brand-model-shots',
      mimetype: image.mimeType || 'image/png',
    });
    return saved.url;
  }

  /** The oldest shots fall off the end rather than the gallery growing without limit. */
  private async trim(brandId: string) {
    const count = await this.prisma.brandModelShot.count({ where: { brandId } });
    if (count <= GALLERY_MAX) return;
    const stale = await this.prisma.brandModelShot.findMany({
      where: { brandId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: GALLERY_MAX,
      select: { id: true },
    });
    if (stale.length) await this.prisma.brandModelShot.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }

  /** Races the render against the clock, and always clears the timer so nothing is left ticking. */
  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the engine took too long to answer')), RENDER_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Engine errors are long and internal; a brand gets the one sentence that helps. */
  private reason(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (/quota|RESOURCE_EXHAUSTED|rate limit|429/i.test(raw)) return 'the image engine is out of quota right now.';
    if (/safety|blocked|SAFETY/i.test(raw)) return 'the engine would not render this photo. Try another garment photo.';
    if (/too long|timeout/i.test(raw)) return 'the engine took too long to answer.';
    return 'the image engine could not complete it.';
  }

  private toView(s: ShotRow) {
    return {
      id: s.id,
      garmentId: s.garmentId,
      modelId: s.modelId,
      modelLabel: toolLabel(s.modelId) ?? findModel(s.modelId)?.label ?? s.modelId,
      poseId: s.poseId,
      poseLabel: findPose(s.poseId)?.label ?? s.poseId,
      backdropId: s.backdropId,
      backdropLabel: findBackdrop(s.backdropId)?.label ?? s.backdropId,
      framingId: s.framingId,
      framingLabel: findFraming(s.framingId)?.label ?? s.framingId,
      direction: s.direction,
      sourceImageUrl: s.sourceImageUrl,
      imageUrl: s.imageUrl,
      credits: s.credits,
      createdAt: s.createdAt.toISOString(),
    };
  }
}
