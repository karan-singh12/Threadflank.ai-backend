import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../../prisma/prisma.service';
import { downloadStored } from '../../../shared/storage/r2-objects';
import { IStorageProvider, STORAGE_PROVIDER } from '../../../shared/storage/storage.interface';
import { grantBrandCredits, spendBrandCredits } from '../billing/brand-credits';
import { BrandCatalogService } from '../catalog/brand-catalog.service';
import { CreateBrandReelDto } from '../dto/brand-common.dto';
import { composeReel, hasFfmpeg } from './reel-compose';
import { MAX_SHOTS, MIN_SHOTS, REEL_STYLES, findReelStyle, presetForShot } from './reel-styles';
import { VIDEO_NEGATIVE_PROMPT, buildVideoPrompt, findPreset } from './video-presets';
import { VIDEO_ENGINES, engineById, pickVideoEngine, type VideoEngine } from './video-engines';

/** Credits one reel costs, whatever its length: cheaper per clip than rendering them one by one. */
export const REEL_COST = 60;
/** Reels one brand can have going at once. Each one is already several renders. */
const MAX_IN_PROGRESS = 1;
/** A reel still unfinished after this long is treated as failed (and refunded). */
const GIVE_UP_AFTER_MS = 45 * 60_000;

type ReelRow = Awaited<ReturnType<PrismaService['brandReel']['findFirstOrThrow']>>;
type ShotRow = Awaited<ReturnType<PrismaService['brandReelShot']['findFirstOrThrow']>>;
type ReelWithShots = ReelRow & { shots: ShotRow[] };

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * Promo reels. A reel is several garment clips plus the brand's own opening and closing cards,
 * stitched into one vertical film. It follows the same shape as a single motion video: starting
 * one takes the credits and hands every shot to the engine; checking on it (when the studio polls)
 * collects the finished clips, stitches them once they are all in, and refunds exactly once if it
 * cannot be finished.
 */
@Injectable()
export class BrandReelService {
  private readonly logger = new Logger(BrandReelService.name);
  /** Overridable in tests. */
  engines: VideoEngine[] = VIDEO_ENGINES;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: BrandCatalogService,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
  ) {}

  styles() {
    return REEL_STYLES;
  }

  /** Whether reels can be made right now. Needs both a video engine and ffmpeg to stitch. */
  async status() {
    const [picked, ffmpeg] = await Promise.all([pickVideoEngine(this.engines), hasFfmpeg()]);
    return {
      available: Boolean(picked) && ffmpeg,
      engine: picked?.engine.id ?? null,
      /** Set when the engine is there but this host cannot stitch. */
      reason: !picked ? 'engine' : !ffmpeg ? 'ffmpeg' : null,
      minShots: MIN_SHOTS,
      maxShots: MAX_SHOTS,
      shotSeconds: picked?.engine.durationSec ?? 8,
      cost: REEL_COST,
    };
  }

  async create(brandId: string, dto: CreateBrandReelDto) {
    const style = findReelStyle(dto.styleId);
    if (!style) throw new BadRequestException('Choose one of the reel styles.');

    const shots = dto.shots ?? [];
    if (shots.length < MIN_SHOTS || shots.length > MAX_SHOTS) {
      throw new BadRequestException(`A reel needs between ${MIN_SHOTS} and ${MAX_SHOTS} outfits.`);
    }

    const [picked, ffmpeg] = await Promise.all([pickVideoEngine(this.engines), hasFfmpeg()]);
    if (!picked) throw new ServiceUnavailableException('Video rendering is not connected yet. No credits were charged.');
    if (!ffmpeg) throw new ServiceUnavailableException('Reel stitching is not available on this server yet. No credits were charged.');
    const { engine } = picked;

    const going = await this.prisma.brandReel.count({ where: { brandId, status: { in: ['RENDERING', 'COMPOSING'] } } });
    if (going >= MAX_IN_PROGRESS) throw new BadRequestException('A reel is already being made. Wait for it to finish, then start another.');

    const brand = await this.prisma.brand.findUniqueOrThrow({ where: { id: brandId }, select: { name: true } });

    // Resolve every outfit to a real photo before a single credit is taken.
    const resolved = [];
    for (const [i, shot] of shots.entries()) {
      const garment = shot.garmentId ? await this.catalog.findOne(brandId, shot.garmentId) : undefined;
      const sourceImageUrl = shot.customImageUrl?.trim() || garment?.images?.[0];
      if (!sourceImageUrl) throw new BadRequestException(`Outfit ${i + 1} has no photo. Upload one or pick a garment that has one.`);
      // A shot can name its own move; otherwise the style decides what this position gets.
      const preset = (shot.presetId ? findPreset(shot.presetId) : undefined) ?? presetForShot(style, i);
      resolved.push({
        position: i,
        garmentId: garment?.id ?? null,
        label: (shot.label?.trim() || garment?.title || '').slice(0, 60),
        caption: (shot.caption?.trim() || (garment?.price ? money(garment.price) : '')).slice(0, 40),
        presetId: preset.id,
        sourceImageUrl,
        prompt: buildVideoPrompt({
          preset,
          direction: dto.prompt,
          garment: garment ? { title: garment.title, category: garment.category, colors: garment.colors } : undefined,
        }),
      });
    }

    const remaining = await spendBrandCredits(this.prisma, brandId, REEL_COST);
    if (remaining === null) throw new BadRequestException(`A promo reel costs ${REEL_COST} AI credits. Buy a credit pack to keep creating.`);

    // Hand every shot to the engine. If any one refuses, nothing is charged and nothing is kept.
    const started: { position: number; operation: string }[] = [];
    try {
      for (const shot of resolved) {
        const image = await this.loadBytes(shot.sourceImageUrl);
        if (!/^image\//.test(image.mimeType)) throw new Error(`outfit ${shot.position + 1} is not an image`);
        const job = await engine.start({
          image: { bytes: image.bytes, mimeType: image.mimeType },
          imageUrl: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`,
          prompt: shot.prompt,
          negativePrompt: VIDEO_NEGATIVE_PROMPT,
          aspectRatio: engine.aspectRatios.includes('9:16') ? '9:16' : engine.aspectRatios[0] ?? 'auto',
          durationSec: engine.durationSec,
        });
        started.push({ position: shot.position, operation: job.operation });
      }
    } catch (err) {
      await grantBrandCredits(this.prisma, brandId, REEL_COST);
      this.logger.warn(`Reel start failed (${engine.id}): ${err}`);
      throw new ServiceUnavailableException(`The video engine could not start this reel: ${(err as Error).message}. No credits were charged.`);
    }

    const reel = await this.prisma.brandReel.create({
      data: {
        brandId,
        title: (dto.title?.trim() || `${brand.name} — ${style.name}`).slice(0, 80),
        styleId: style.id,
        aspectRatio: '9:16',
        engine: engine.id,
        model: picked.model,
        credits: REEL_COST,
        shots: {
          create: resolved.map((s) => ({
            position: s.position,
            garmentId: s.garmentId,
            label: s.label,
            caption: s.caption,
            presetId: s.presetId,
            sourceImageUrl: s.sourceImageUrl,
            prompt: s.prompt,
            operation: started.find((j) => j.position === s.position)?.operation ?? null,
          })),
        },
      },
      include: { shots: { orderBy: { position: 'asc' } } },
    });
    return { reel: this.toView(reel), remainingCredits: remaining };
  }

  async get(brandId: string, id: string) {
    const row = await this.prisma.brandReel.findFirst({ where: { id, brandId }, include: { shots: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundException('Reel not found.');
    return this.toView(await this.advance(row));
  }

  async list(brandId: string) {
    const rows = await this.prisma.brandReel.findMany({
      where: { brandId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
      include: { shots: { orderBy: { position: 'asc' } } },
    });
    const checked = await Promise.all(rows.map((r) => (r.status === 'RENDERING' || r.status === 'COMPOSING' ? this.advance(r) : r)));
    return checked.map((r) => this.toView(r));
  }

  async remove(brandId: string, id: string) {
    const row = await this.prisma.brandReel.findFirst({ where: { id, brandId } });
    if (!row) throw new NotFoundException('Reel not found.');
    if (row.status === 'RENDERING' || row.status === 'COMPOSING') {
      throw new BadRequestException('This reel is still being made. You can delete it once it finishes.');
    }
    await this.prisma.brandReel.delete({ where: { id } });
    return { success: true, id };
  }

  /** Collects finished shots, then stitches once they are all in. Never throws for engine errors. */
  private async advance(reel: ReelWithShots): Promise<ReelWithShots> {
    if (reel.status === 'READY' || reel.status === 'FAILED') return reel;
    if (Date.now() - reel.createdAt.getTime() > GIVE_UP_AFTER_MS) return this.fail(reel, 'The reel took too long and was stopped.');

    const engine = engineById(reel.engine, this.engines);
    if (!engine) return this.fail(reel, 'This reel can no longer be checked.');

    if (reel.status === 'RENDERING') {
      for (const shot of reel.shots) {
        if (shot.status !== 'RENDERING' || !shot.operation) continue;
        try {
          const result = await engine.check(shot.operation);
          if (result.state === 'running') continue;
          if (result.state === 'failed') return this.fail(reel, `Outfit ${shot.position + 1} could not be rendered: ${result.reason}`);
          const saved = await this.storage.save({
            buffer: result.video,
            filename: `brand-reel-${reel.id}-${shot.position}.mp4`,
            folder: 'brand-reels',
            mimetype: result.mimeType || 'video/mp4',
          });
          await this.prisma.brandReelShot.updateMany({
            where: { id: shot.id, status: 'RENDERING' },
            data: { status: 'READY', clipUrl: saved.url, error: null },
          });
        } catch (err) {
          // A blip is retried on the next poll rather than failing the whole reel.
          this.logger.warn(`Checking reel ${reel.id} shot ${shot.position} failed: ${err}`);
        }
      }

      const fresh = await this.reload(reel.id);
      if (fresh.shots.some((s) => s.status !== 'READY')) return fresh;
      // Every clip is in. Claim the stitching so two polls can't both run ffmpeg.
      const { count } = await this.prisma.brandReel.updateMany({ where: { id: reel.id, status: 'RENDERING' }, data: { status: 'COMPOSING' } });
      if (!count) return fresh;
      return this.compose(await this.reload(reel.id));
    }

    // COMPOSING: a previous attempt claimed it. If it died mid-way the give-up window catches it.
    return reel;
  }

  /** Downloads every clip, stitches the reel and stores it. */
  private async compose(reel: ReelWithShots): Promise<ReelWithShots> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tf-reel-in-'));
    try {
      const style = findReelStyle(reel.styleId);
      if (!style) throw new Error('This reel style no longer exists.');
      const brand = await this.prisma.brand.findUniqueOrThrow({ where: { id: reel.brandId }, select: { name: true, logoUrl: true, websiteUrl: true } });

      const shots = [];
      for (const shot of reel.shots) {
        if (!shot.clipUrl) throw new Error(`outfit ${shot.position + 1} has no clip`);
        const clip = await this.loadBytes(shot.clipUrl);
        const file = path.join(dir, `clip-${shot.position}.mp4`);
        await fs.writeFile(file, clip.bytes);
        shots.push({ file, label: shot.label, caption: shot.caption });
      }

      // The logo is a nicety: a reel is still fine without one.
      let logoFile: string | undefined;
      if (brand.logoUrl) {
        try {
          const logo = await this.loadBytes(brand.logoUrl);
          logoFile = path.join(dir, 'logo.png');
          await fs.writeFile(logoFile, logo.bytes);
        } catch {
          logoFile = undefined;
        }
      }

      const site = this.siteOf(brand.websiteUrl, brand.name);
      const { video, durationSec } = await composeReel({
        shots,
        brandName: brand.name,
        site,
        outroLine: style.outroLine.replace('{brand}', brand.name).replace('{site}', site),
        cardColor: style.cardColor,
        introSec: style.introSec,
        outroSec: style.outroSec,
        shotSeconds: engineById(reel.engine, this.engines)?.durationSec ?? 8,
        logoFile,
      });

      const saved = await this.storage.save({ buffer: video, filename: `brand-reel-${reel.id}.mp4`, folder: 'brand-reels', mimetype: 'video/mp4' });
      await this.prisma.brandReel.updateMany({
        where: { id: reel.id, status: 'COMPOSING' },
        data: { status: 'READY', videoUrl: saved.url, durationSec, finishedAt: new Date(), error: null },
      });
      return this.reload(reel.id);
    } catch (err) {
      this.logger.warn(`Stitching reel ${reel.id} failed: ${err}`);
      // Put it back so the failure path can refund it exactly once.
      await this.prisma.brandReel.updateMany({ where: { id: reel.id, status: 'COMPOSING' }, data: { status: 'RENDERING' } });
      return this.fail(await this.reload(reel.id), `The clips were made but could not be stitched: ${(err as Error).message}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Marks a reel failed and gives the credits back, once. */
  private async fail(reel: ReelWithShots, reason: string): Promise<ReelWithShots> {
    const { count } = await this.prisma.brandReel.updateMany({
      where: { id: reel.id, status: { in: ['RENDERING', 'COMPOSING'] }, refunded: false },
      data: { status: 'FAILED', error: reason.slice(0, 500), refunded: true, finishedAt: new Date() },
    });
    if (count) await grantBrandCredits(this.prisma, reel.brandId, reel.credits);
    return this.reload(reel.id);
  }

  private reload(id: string): Promise<ReelWithShots> {
    return this.prisma.brandReel.findUniqueOrThrow({ where: { id }, include: { shots: { orderBy: { position: 'asc' } } } });
  }

  /** "https://www.rawmango.com/shop" → "rawmango.com"; no site falls back to the brand's name. */
  private siteOf(websiteUrl: string | null | undefined, brandName: string) {
    if (websiteUrl) {
      try {
        return new URL(/^https?:/i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./, '');
      } catch {
        /* fall through */
      }
    }
    return brandName;
  }

  /** Bytes for a stored file: a local `/public/...` path or a stored/remote https URL. */
  private async loadBytes(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
    if (url.startsWith('data:')) {
      const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
      if (!m) throw new Error('bad data URI');
      return { bytes: Buffer.from(m[3], m[2] ? 'base64' : 'utf8'), mimeType: m[1] || 'application/octet-stream' };
    }
    if (url.startsWith('/')) {
      const root = path.resolve(process.cwd(), 'public');
      const file = path.resolve(process.cwd(), url.replace(/^\/+/, ''));
      if (!file.startsWith(root + path.sep)) throw new Error('outside public uploads');
      const ext = path.extname(file).toLowerCase();
      const mimeType = ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { bytes: await fs.readFile(file), mimeType };
    }
    if (/^https?:\/\//i.test(url)) {
      const stored = await downloadStored(url);
      return { bytes: stored.body, mimeType: stored.contentType };
    }
    throw new Error('unsupported URL');
  }

  private toView(reel: ReelWithShots) {
    const style = findReelStyle(reel.styleId);
    const ready = reel.shots.filter((s) => s.status === 'READY').length;
    return {
      id: reel.id,
      status: reel.status as 'RENDERING' | 'COMPOSING' | 'READY' | 'FAILED',
      title: reel.title,
      styleId: reel.styleId,
      styleName: style?.name ?? reel.styleId,
      aspectRatio: reel.aspectRatio,
      videoUrl: reel.videoUrl,
      durationSec: reel.durationSec,
      error: reel.error,
      credits: reel.credits,
      refunded: reel.refunded,
      /** How far along: clips finished out of the total. */
      shotsReady: ready,
      shotsTotal: reel.shots.length,
      shots: reel.shots.map((s) => ({
        id: s.id,
        position: s.position,
        status: s.status as 'RENDERING' | 'READY' | 'FAILED',
        label: s.label,
        caption: s.caption,
        garmentId: s.garmentId,
        sourceImageUrl: s.sourceImageUrl,
        clipUrl: s.clipUrl,
      })),
      createdAt: reel.createdAt.toISOString(),
      finishedAt: reel.finishedAt?.toISOString() ?? null,
    };
  }
}
