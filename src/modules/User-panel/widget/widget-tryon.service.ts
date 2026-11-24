import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { fetchPublic, isPublicHttpsUrl } from '../../../common/utils/public-url';
import { ImageProviderService } from '../../../shared/image-provider/image-provider.service';
import { IStorageProvider, STORAGE_PROVIDER } from '../../../shared/storage/storage.interface';
import { WidgetService } from '../../Admin-panel/widget/widget.service';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SLOTS = ['upper_body', 'lower_body', 'dresses'] as const;
type Slot = (typeof SLOTS)[number];
const SLOT_TEXT: Record<Slot, string> = { upper_body: 'top', lower_body: 'bottom', dresses: 'full-length outfit' };

/** Try-ons a brand's widget may run per day (UTC), so a leaked key can't run up the image bill. */
const dailyLimit = () => Math.max(1, Number(process.env.WIDGET_DAILY_LIMIT) || 300);

export { isPublicHttpsUrl };

const asDataUri = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString('base64')}`;

/**
 * The try-on behind the embeddable widget on a brand's own store. Anonymous shoppers, so: the
 * widget key and the page's origin are checked, the selfie is never stored (it only lives in
 * memory for the render), and each brand has a daily cap. Free for the shopper, as before.
 */
@Injectable()
export class WidgetTryOnService {
  private readonly logger = new Logger(WidgetTryOnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly widget: WidgetService,
    private readonly images: ImageProviderService,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
  ) {}

  /** Fetches the garment photo with a size cap and an image-only check. */
  private async garment(url: string): Promise<string> {
    if (!isPublicHttpsUrl(url)) throw new BadRequestException('The product photo must be a public https:// image.');
    let res: Response;
    try {
      res = await fetchPublic(url, { signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new BadRequestException("We couldn't load the product photo.");
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!res.ok || !type.startsWith('image/')) throw new BadRequestException("We couldn't load the product photo.");
    if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new BadRequestException('The product photo is too large.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new BadRequestException('The product photo is too large.');
    return asDataUri(buf, type);
  }

  async tryOn(input: { key: string; origin?: string; selfie: Buffer; selfieType: string; garmentUrl: string; category?: string; productUrl?: string }) {
    const brand = await this.widget.config(input.key, input.origin);
    if (!input.selfie.length) throw new BadRequestException('Add a photo of yourself.');
    if (input.selfie.length > MAX_IMAGE_BYTES) throw new BadRequestException('Your photo is too large. Use one under 10 MB.');
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(input.selfieType)) throw new BadRequestException('Use a JPG, PNG or WebP photo.');

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const today = await this.prisma.brandWidgetSession.count({ where: { brandId: brand.brand.id, createdAt: { gte: since } } });
    if (today >= dailyLimit()) throw new HttpException('Try-ons are busy on this store today. Please try again tomorrow.', HttpStatus.TOO_MANY_REQUESTS);

    const slot: Slot = (SLOTS as readonly string[]).includes(input.category ?? '') ? (input.category as Slot) : 'upper_body';
    const garment = await this.garment(input.garmentUrl);
    const started = Date.now();
    const session = (success: boolean, extra: { model?: string; errorMessage?: string; outputUrl?: string } = {}) =>
      this.widget
        .recordSession({ key: input.key, origin: input.origin, productUrl: input.productUrl, success, latencyMs: Date.now() - started, ...extra })
        .catch((e) => this.logger.warn(`Widget session not recorded: ${e}`));

    try {
      const result = await this.images.generate({
        prompt:
          `Virtual try-on. Dress the person in image 1 in the ${SLOT_TEXT[slot]} shown in image 2. ` +
          'Keep their face, hairstyle, skin tone, body shape, pose, framing and background identical to image 1. ' +
          "Reproduce the garment's colour, pattern, texture, neckline, sleeves and length faithfully, fitted naturally with realistic folds, shadows and lighting. " +
          'Full body in frame, natural photograph.',
        images: [asDataUri(input.selfie, input.selfieType), garment],
        aspectRatio: '3:4',
      });
      // Keep only the result (never the selfie), so the shopper's link keeps working.
      const buf = result.url.startsWith('data:') ? Buffer.from(result.url.split(',')[1] ?? '', 'base64') : Buffer.from(await (await fetch(result.url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
      const saved = await this.storage.save({ buffer: buf, filename: `widget-${brand.brand.id}-${Date.now()}.png`, folder: 'widget-results', mimetype: 'image/png' });
      void session(true, { model: result.model, outputUrl: saved.url });
      return { resultImageUrl: saved.url };
    } catch (err) {
      void session(false, { errorMessage: err instanceof Error ? err.message : String(err) });
      if (err instanceof HttpException) throw err;
      this.logger.error(`Widget try-on failed for ${brand.brand.name}: ${err}`);
      throw new ServiceUnavailableException("We couldn't create your try-on right now. Please try again in a moment.");
    }
  }
}
