import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { VisionService, VisionUnavailableError } from '../../../shared/vision/vision.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { spendBrandCredits } from '../billing/brand-credits';
import { asDataUri, loadSourceImage } from '../ai-studio/source-image';
import {
  DESCRIBE_SCHEMA,
  DRAPE_PROMPT,
  DRAPE_SCHEMA,
  DescribeAnswer,
  DescribeLanguage,
  DescribeTone,
  DrapeVision,
  PhotoIssue,
  TagAnswer,
  TagSuggestion,
  cleanDescribeAnswer,
  cleanTagAnswer,
  describePrompt,
  imageDimensions,
  localPhotoIssues,
  photoStatus,
  scoreDrape,
  tagPrompt,
  tagSchema,
} from './catalog-ai';

export const TAG_COST = 1;
export const DESCRIBE_COST = 2;
/** How many photo checks run at once in the background, so a burst of edits can't flood the engine. */
const BACKGROUND_CONCURRENCY = 2;
/** The most pieces one "check photos" request will look at. */
export const CHECK_BATCH_MAX = 25;

export interface DrapeCheckResult {
  productId: string;
  status: ReturnType<typeof photoStatus>;
  score: number;
  issues: string[];
  checkedAt: string | null;
  /** False when the visual check could not run (engine busy or out of quota); only the file was checked. */
  checked: boolean;
}

/**
 * The AI help inside the catalog: fill a piece's tags from its photo, write its listing, and check
 * that its photo will work for try-on. Tagging and writing cost credits, charged only after the
 * engine actually answered; the photo check is free, because a good try-on helps everyone.
 */
@Injectable()
export class CatalogAiService {
  private readonly logger = new Logger(CatalogAiService.name);
  private readonly queue: { brandId: string; productId: string }[] = [];
  private readonly queued = new Set<string>();
  private running = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxonomy: TaxonomyService,
    private readonly vision: VisionService,
  ) {}

  // ── Credits ────────────────────────────────────────────────────────────

  private async assertCredits(brandId: string, cost: number) {
    const brand = await this.prisma.brand.findFirst({ where: { id: brandId, isDeleted: false }, select: { socialLinks: true } });
    if (!brand) throw new NotFoundException('Brand not found.');
    const credits = Number((brand.socialLinks as Record<string, unknown> | null)?.aiCredits ?? 0);
    if (credits < cost) throw new BadRequestException(`This costs ${cost} AI credit${cost === 1 ? '' : 's'} and you have ${credits}. Top up in Billing.`);
  }

  private async charge(brandId: string, cost: number): Promise<number> {
    const left = await spendBrandCredits(this.prisma, brandId, cost);
    if (left === null) throw new BadRequestException(`Your credits ran out while this was running. It costs ${cost}; top up in Billing and try again.`);
    return left;
  }

  private unavailable(e: unknown): never {
    if (e instanceof VisionUnavailableError && e.quota) {
      throw new ServiceUnavailableException('The AI assistant is out of quota right now. No credits were charged. Please try again later.');
    }
    throw new ServiceUnavailableException('The AI assistant is busy right now. No credits were charged. Please try again in a minute.');
  }

  private async photo(url: string) {
    const source = await loadSourceImage(url);
    return { dataUri: asDataUri(source), bytes: source.bytes };
  }

  // ── Auto-tagging ───────────────────────────────────────────────────────

  /** Suggests category, occasions, colours, fabric, pattern and style tags from a photo. The brand reviews them before saving. */
  async autoTag(brandId: string, input: { imageUrl: string; title?: string }): Promise<TagSuggestion & { creditsDeducted: number; remainingCredits: number }> {
    await this.assertCredits(brandId, TAG_COST);
    const [{ dataUri }, cats, occs] = await Promise.all([this.photo(input.imageUrl), this.taxonomy.list('CATEGORY'), this.taxonomy.list('OCCASION')]);
    const lists = { categories: cats.map((c) => c.name), occasions: occs.map((o) => o.name) };

    let answer: TagAnswer;
    try {
      answer = await this.vision.json<TagAnswer>({
        prompt: tagPrompt(input.title),
        image: dataUri,
        schema: tagSchema(lists.categories, lists.occasions),
        requestedBy: `brand:${brandId}`,
        taskType: 'catalog_auto_tag',
      });
    } catch (e) {
      this.unavailable(e);
    }
    const suggestion = cleanTagAnswer(answer, lists);
    if (!suggestion.category && suggestion.colors.length === 0 && !suggestion.fabric) {
      throw new ServiceUnavailableException("We couldn't make out this piece from the photo. No credits were charged. Try a clearer photo.");
    }
    const remainingCredits = await this.charge(brandId, TAG_COST);
    return { ...suggestion, creditsDeducted: TAG_COST, remainingCredits };
  }

  // ── Listing copy ───────────────────────────────────────────────────────

  async describe(
    brandId: string,
    input: { imageUrl?: string; title?: string; category?: string; fabric?: string; pattern?: string; colors?: string[]; occasions?: string[]; notes?: string; tone: DescribeTone; language: DescribeLanguage },
  ) {
    await this.assertCredits(brandId, DESCRIBE_COST);
    const brand = await this.prisma.brand.findUniqueOrThrow({ where: { id: brandId }, select: { name: true } });
    const image = input.imageUrl ? (await this.photo(input.imageUrl)).dataUri : undefined;
    if (!image && !input.title?.trim() && !input.category?.trim()) {
      throw new BadRequestException('Add a photo, a title or a category first, so there is something to describe.');
    }

    let answer: DescribeAnswer;
    try {
      answer = await this.vision.json<DescribeAnswer>({
        prompt: describePrompt({ ...input, brand: brand.name, withPhoto: Boolean(image) }),
        image,
        schema: DESCRIBE_SCHEMA,
        requestedBy: `brand:${brandId}`,
        taskType: 'catalog_describe',
      });
    } catch (e) {
      this.unavailable(e);
    }
    const listing = cleanDescribeAnswer(answer);
    if (!listing) throw new ServiceUnavailableException('The listing came back too thin to use. No credits were charged. Please try again.');
    const remainingCredits = await this.charge(brandId, DESCRIBE_COST);
    return { ...listing, creditsDeducted: DESCRIBE_COST, remainingCredits };
  }

  // ── Drape-ready photo check ────────────────────────────────────────────

  /**
   * Looks at a piece's main photo and saves what it found. When the engine can't answer, the file
   * is still checked for size, and an earlier full result is kept rather than overwritten.
   */
  async drapeCheck(brandId: string, productId: string): Promise<DrapeCheckResult> {
    const piece = await this.prisma.brandProduct.findFirst({ where: { id: productId, brandId }, select: { id: true, images: true, drapeCheckedAt: true, drapeScore: true, drapeIssues: true } });
    if (!piece) throw new NotFoundException('That piece is not in your catalog.');
    const main = piece.images[0];
    if (!main) {
      await this.prisma.brandProduct.update({ where: { id: piece.id }, data: { drapeScore: 0, drapeIssues: ['Add a photo of the piece.'], drapeCheckedAt: null } });
      return { productId, status: 'missing', score: 0, issues: ['Add a photo of the piece.'], checkedAt: null, checked: false };
    }

    let local: PhotoIssue[] = [];
    let dataUri: string;
    try {
      const p = await this.photo(main);
      dataUri = p.dataUri;
      local = localPhotoIssues(imageDimensions(p.bytes));
    } catch {
      const issues = ["We couldn't open the main photo. Upload it again."];
      await this.prisma.brandProduct.update({ where: { id: piece.id }, data: { drapeScore: 0, drapeIssues: issues, drapeCheckedAt: new Date() } });
      return { productId, status: 'needs_work', score: 0, issues, checkedAt: new Date().toISOString(), checked: true };
    }

    let seen: DrapeVision | null = null;
    try {
      seen = await this.vision.json<DrapeVision>({ prompt: DRAPE_PROMPT, image: dataUri, schema: DRAPE_SCHEMA, requestedBy: `brand:${brandId}`, taskType: 'catalog_drape_check' });
    } catch {
      seen = null;
    }

    if (!seen) {
      // Keep a previous full check; only the file-level findings are new.
      const issues = [...local.map((i) => i.message), 'The full photo check could not run right now. It will run again when you edit the piece, or use Check photo.'];
      if (!piece.drapeCheckedAt) await this.prisma.brandProduct.update({ where: { id: piece.id }, data: { drapeIssues: issues } });
      const status = photoStatus({ images: piece.images, drapeCheckedAt: piece.drapeCheckedAt, drapeScore: piece.drapeScore });
      return { productId, status, score: piece.drapeScore, issues: piece.drapeCheckedAt ? piece.drapeIssues : issues, checkedAt: piece.drapeCheckedAt?.toISOString() ?? null, checked: false };
    }

    const result = scoreDrape(seen, local);
    const checkedAt = new Date();
    await this.prisma.brandProduct.update({ where: { id: piece.id }, data: { drapeScore: result.score, drapeIssues: result.issues, drapeCheckedAt: checkedAt } });
    return { productId, status: result.ready ? 'good' : 'needs_work', score: result.score, issues: result.issues, checkedAt: checkedAt.toISOString(), checked: true };
  }

  /** Checks up to CHECK_BATCH_MAX pieces, one after another. Pieces that aren't this brand's are skipped. */
  async checkMany(brandId: string, ids: string[]) {
    const own = await this.prisma.brandProduct.findMany({ where: { brandId, id: { in: [...new Set(ids)].slice(0, CHECK_BATCH_MAX) } }, select: { id: true } });
    const results: DrapeCheckResult[] = [];
    for (const { id } of own) results.push(await this.drapeCheck(brandId, id));
    return { requested: ids.length, checked: results.filter((r) => r.checked).length, good: results.filter((r) => r.status === 'good').length, results };
  }

  /** After a save: check the photo without making the brand wait. Never throws. */
  checkInBackground(brandId: string, productId: string): void {
    if (!this.vision.isConfigured() || this.queued.has(productId)) return;
    this.queued.add(productId);
    this.queue.push({ brandId, productId });
    this.pump();
  }

  private pump() {
    while (this.running < BACKGROUND_CONCURRENCY && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      this.drapeCheck(job.brandId, job.productId)
        .catch((e) => this.logger.debug(`background photo check skipped: ${e instanceof Error ? e.message : e}`))
        .finally(() => {
          this.running--;
          this.queued.delete(job.productId);
          this.pump();
        });
    }
  }
}
