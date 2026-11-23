import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { IStorageProvider, STORAGE_PROVIDER } from '../../../shared/storage/storage.interface';
import { asDataUri, loadSourceImage } from './source-image';
import { grantBrandCredits, spendBrandCredits } from '../billing/brand-credits';
import { BrandCatalogService } from '../catalog/brand-catalog.service';
import { CreateBrandVideoDto } from '../dto/brand-common.dto';
import { MOTION_PRESETS, VIDEO_NEGATIVE_PROMPT, buildVideoPrompt, findPreset } from './video-presets';
import { VIDEO_ENGINES, engineById, pickVideoEngine, type VideoEngine } from './video-engines';

/** Credits one motion video costs. Taken when the render starts, given back if it fails. */
export const VIDEO_COST = 15;
/** Renders one brand can have going at once. */
const MAX_IN_PROGRESS = 2;
/** A render still unfinished after this long is treated as failed (and refunded). */
const GIVE_UP_AFTER_MS = 20 * 60_000;

type VideoRow = Awaited<ReturnType<PrismaService['brandVideo']['findFirstOrThrow']>>;

/**
 * AI motion videos for brands. A render takes minutes, so it is a job stored in `BrandVideo`:
 * starting one takes the credits and hands the photo to the engine; checking on it (when the studio
 * polls, or lists the brand's videos) asks the engine how it is going, stores the finished clip in
 * our own storage, or marks it failed and gives the credits back exactly once.
 */
@Injectable()
export class BrandVideoService {
  private readonly logger = new Logger(BrandVideoService.name);
  /** Overridable in tests. */
  engines: VideoEngine[] = VIDEO_ENGINES;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: BrandCatalogService,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
  ) {}

  presets() {
    return MOTION_PRESETS;
  }

  /** Whether videos can be rendered right now, and with what. The studio uses this to set itself up. */
  async status() {
    const picked = await pickVideoEngine(this.engines);
    return {
      available: Boolean(picked),
      engine: picked?.engine.id ?? null,
      model: picked?.model ?? null,
      aspectRatios: picked?.engine.aspectRatios ?? [],
      durationSec: picked?.engine.durationSec ?? null,
      cost: VIDEO_COST,
    };
  }

  async create(brandId: string, dto: CreateBrandVideoDto) {
    const preset = findPreset(dto.presetId);
    if (!preset) throw new BadRequestException('Choose one of the motion looks.');

    // The photo is the brand's own garment, or a photo it uploaded; never a made-up default.
    const garment = dto.garmentId ? await this.catalog.findOne(brandId, dto.garmentId) : undefined;
    const sourceImageUrl = dto.customImageUrl?.trim() || garment?.images?.[0];
    if (!sourceImageUrl) throw new BadRequestException('Choose a garment that has a photo, or upload one, before rendering.');

    const picked = await pickVideoEngine(this.engines);
    if (!picked) throw new ServiceUnavailableException('Video rendering is not connected yet. No credits were charged.');
    const { engine } = picked;

    const rendering = await this.prisma.brandVideo.count({ where: { brandId, status: 'RENDERING' } });
    if (rendering >= MAX_IN_PROGRESS) {
      throw new BadRequestException(`You already have ${rendering} videos rendering. Wait for one to finish, then start another.`);
    }

    const image = await loadSourceImage(sourceImageUrl);
    const aspectRatio = engine.aspectRatios.length ? (dto.aspectRatio && engine.aspectRatios.includes(dto.aspectRatio) ? dto.aspectRatio : engine.aspectRatios[0]) : 'auto';
    const prompt = buildVideoPrompt({ preset, direction: dto.prompt, garment: garment ? { title: garment.title, category: garment.category, colors: garment.colors } : undefined });

    const remaining = await spendBrandCredits(this.prisma, brandId, VIDEO_COST);
    if (remaining === null) {
      throw new BadRequestException(`A motion video costs ${VIDEO_COST} AI credits. Buy a credit pack to keep creating.`);
    }

    let started: { operation: string; model: string };
    try {
      started = await engine.start({
        image,
        imageUrl: asDataUri(image),
        prompt,
        negativePrompt: VIDEO_NEGATIVE_PROMPT,
        aspectRatio,
        durationSec: engine.durationSec,
      });
    } catch (err) {
      await grantBrandCredits(this.prisma, brandId, VIDEO_COST);
      this.logger.warn(`Video start failed (${engine.id}): ${err}`);
      throw new ServiceUnavailableException(`The video engine could not start this render: ${(err as Error).message}. No credits were charged.`);
    }

    const video = await this.prisma.brandVideo.create({
      data: {
        brandId,
        garmentId: garment?.id ?? null,
        engine: engine.id,
        model: started.model,
        operation: started.operation,
        presetId: preset.id,
        aspectRatio,
        durationSec: engine.durationSec,
        prompt,
        sourceImageUrl,
        credits: VIDEO_COST,
      },
    });
    return { video: this.toView(video), remainingCredits: remaining };
  }

  /** One video, after checking on it if it is still rendering. */
  async get(brandId: string, id: string) {
    const row = await this.prisma.brandVideo.findFirst({ where: { id, brandId } });
    if (!row) throw new NotFoundException('Video not found.');
    return this.toView(await this.advance(row));
  }

  /** The brand's videos, newest first. Renders still going are checked on the way. */
  async list(brandId: string) {
    const rows = await this.prisma.brandVideo.findMany({ where: { brandId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 60 });
    const checked = await Promise.all(rows.map((r) => (r.status === 'RENDERING' ? this.advance(r) : r)));
    return checked.map((r) => this.toView(r));
  }

  async remove(brandId: string, id: string) {
    const row = await this.prisma.brandVideo.findFirst({ where: { id, brandId } });
    if (!row) throw new NotFoundException('Video not found.');
    if (row.status === 'RENDERING') throw new BadRequestException('This video is still rendering. You can delete it once it finishes.');
    await this.prisma.brandVideo.delete({ where: { id } });
    return { success: true, id };
  }

  /** Asks the engine how a render is going and records the outcome. Never throws for engine errors. */
  private async advance(row: VideoRow): Promise<VideoRow> {
    if (row.status !== 'RENDERING') return row;
    if (Date.now() - row.createdAt.getTime() > GIVE_UP_AFTER_MS) return this.fail(row, 'The render took too long and was stopped.');
    const engine = engineById(row.engine, this.engines);
    if (!engine || !row.operation) return this.fail(row, 'This render can no longer be checked.');

    try {
      const result = await engine.check(row.operation);
      if (result.state === 'running') return row;
      if (result.state === 'failed') return this.fail(row, result.reason);

      const saved = await this.storage.save({ buffer: result.video, filename: `brand-video-${row.id}.mp4`, folder: 'brand-videos', mimetype: result.mimeType || 'video/mp4' });
      // Only the request that flips it from RENDERING stores the result; a parallel check just reads it.
      const { count } = await this.prisma.brandVideo.updateMany({
        where: { id: row.id, status: 'RENDERING' },
        data: { status: 'READY', videoUrl: saved.url, finishedAt: new Date(), error: null },
      });
      if (!count) this.logger.debug(`Video ${row.id} was finished by another request`);
      return this.prisma.brandVideo.findUniqueOrThrow({ where: { id: row.id } });
    } catch (err) {
      // A network blip or storage hiccup is retried on the next check, not counted as a failure.
      this.logger.warn(`Checking video ${row.id} failed: ${err}`);
      return row;
    }
  }

  /** Marks a render failed and gives the credits back, once. */
  private async fail(row: VideoRow, reason: string): Promise<VideoRow> {
    const { count } = await this.prisma.brandVideo.updateMany({
      where: { id: row.id, status: 'RENDERING', refunded: false },
      data: { status: 'FAILED', error: reason.slice(0, 500), refunded: true, finishedAt: new Date() },
    });
    if (count) await grantBrandCredits(this.prisma, row.brandId, row.credits);
    return this.prisma.brandVideo.findUniqueOrThrow({ where: { id: row.id } });
  }

  private toView(v: VideoRow) {
    const preset = findPreset(v.presetId);
    return {
      id: v.id,
      status: v.status as 'RENDERING' | 'READY' | 'FAILED',
      garmentId: v.garmentId,
      presetId: v.presetId,
      presetName: preset?.name ?? v.presetId,
      aspectRatio: v.aspectRatio,
      durationSec: v.durationSec,
      sourceImageUrl: v.sourceImageUrl,
      videoUrl: v.videoUrl,
      error: v.error,
      credits: v.credits,
      refunded: v.refunded,
      engine: v.engine,
      createdAt: v.createdAt.toISOString(),
      finishedAt: v.finishedAt?.toISOString() ?? null,
    };
  }
}
