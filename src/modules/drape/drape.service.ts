import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CutoutService } from '../../shared/cutout/cutout.service';
import { ImageProviderService } from '../../shared/image-provider/image-provider.service';
import { IStorageProvider, STORAGE_PROVIDER } from '../../shared/storage/storage.interface';
import { downloadStored } from '../../shared/storage/r2-objects';
import { AspectRatio, ImageResult } from '../../shared/image-provider/image-provider.interface';
import { buildGroupPrompt, buildPersonPrompt, normalisePieces, resolvePosture } from './drape-prompt.builder';
import { AnimateDto } from './dto/animate.dto';
import { GroupDrapeDto } from './dto/group-drape.dto';
import { LookEditDto, MakeupOptions } from './dto/look-edit.dto';
import { GarmentSlot, SlotItem, TryOnRequestDto } from './dto/tryon.dto';

export type GroupPersonResult = {
    ref: string;
    name: string;
    /** This person's own render, or their twin when they had no outfit or their render failed. */
    imageUrl: string;
    dressed: boolean;
    error?: string;
};

export type GroupDrapeResult = {
    /** The final photo: the composed group, or the single person's render. Null if composing failed. */
    imageUrl: string | null;
    composed: boolean;
    posture: string | null;
    people: GroupPersonResult[];
    provider?: string;
    model?: string;
    resultId?: string;
    composeError?: string;
};

/** Wider frames as the group grows, so everyone fits head to toe. */
function groupAspect(count: number): AspectRatio {
    if (count <= 2) return '3:4';
    if (count <= 4) return '4:3';
    return '16:9';
}

const POSE_PROMPTS: Record<string, string> = {
    front: 'standing straight and facing the camera, arms relaxed',
    'three-quarter': 'standing turned about 45 degrees to their left in a three-quarter view, looking at the camera',
    side: 'standing in full side profile facing left',
    back: 'standing with their back to the camera so the back of the outfit is visible, head turned slightly over the shoulder',
    walk: 'mid-stride walking towards the camera like on a runway',
    seated: 'sitting elegantly on a simple stool, full outfit visible',
};

const MOTIONS: Record<string, string> = {
    turn: 'The person slowly turns a little to the left and back to face the camera, showing how the outfit moves.',
    walk: 'The person takes a few confident steps towards the camera like on a runway; the fabric sways naturally.',
    twirl: 'The person does a gentle half twirl so the garment flares and settles, then faces the camera again.',
    pose: 'The person shifts their weight and changes hand position, like posing for a fashion shoot.',
};

const SLOT_CONFIG: Record<GarmentSlot, { description: string }> = {
    [GarmentSlot.TOP]: { description: 'Wear this top on the upper body' },
    [GarmentSlot.BOTTOM]: { description: 'Wear this bottom on the lower body' },
    [GarmentSlot.DRESS]: { description: 'Wear this full dress across the entire body' },
    [GarmentSlot.SHOES]: { description: 'Wear these shoes on the feet' },
    [GarmentSlot.EYEWEAR]: { description: 'Wear these glasses/eyewear on the face' },
    [GarmentSlot.HEADWEAR]: { description: 'Wear this hat/headwear on the head' },
    [GarmentSlot.BAG]: { description: 'Hold or carry this bag naturally' },
    [GarmentSlot.JEWELRY]: { description: 'Wear this jewelry/accessory naturally' },
};

@Injectable()
export class DrapeService {
    private readonly logger = new Logger(DrapeService.name);

    constructor(
        private readonly imageProvider: ImageProviderService,
        @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
        private readonly cutout: CutoutService,
        private readonly prisma: PrismaService,
    ) {}

    /**
     * If a dress is included, remove top and bottom slots as they conflict.
     */
    normaliseSlots(slots: SlotItem[]): SlotItem[] {
        const hasDress = slots.some((s) => s.slot === GarmentSlot.DRESS);
        if (hasDress) {
            return slots.filter((s) => s.slot !== GarmentSlot.TOP && s.slot !== GarmentSlot.BOTTOM);
        }
        return slots;
    }

    /**
     * Executes the virtual try-on slot pipeline.
     */
    async processTryOn(
        userId: string,
        dto: TryOnRequestDto,
    ): Promise<{ imageUrl: string; provider: string; model: string; resultId: string }> {
        const activeSlots = this.normaliseSlots(dto.slots);
        if (activeSlots.length === 0) {
            throw new BadRequestException('At least one garment slot must be provided.');
        }

        const garmentInstructions = activeSlots
            .map((item, idx) => `Garment ${idx + 1} (${item.slot}): ${SLOT_CONFIG[item.slot]?.description || item.slot}`)
            .join('. ');

        const basePrompt =
            dto.prompt?.trim() ||
            'Editorial fashion studio try-on photograph. The person in Image 1 is wearing the exact garments shown in the reference images. Seamlessly dress the person while faithfully preserving their exact face, facial features, hair, skin tone, and body proportions. Full body in frame with high photographic detail.';

        const prompt = `${basePrompt} Garments to apply: ${garmentInstructions}.`;

        const images = [dto.modelImageUrl, ...activeSlots.map((s) => s.garmentUrl)];

        // Generate image through backend ImageProviderService (Gemini / Replicate)
        const genResult = await this.imageProvider.generate({
            prompt,
            images,
            aspectRatio: '3:4',
        });

        // Convert generated image URL/data URI to Buffer
        let imageBuffer = await this.urlOrDataToBuffer(genResult.url);

        // Optional background removal via CutoutService (MODNet)
        let noBackground = false;
        if (dto.removeBackground) {
            try {
                const cutoutResult = await this.cutout.removeBackground(imageBuffer);
                imageBuffer = cutoutResult.png;
                noBackground = true;
            } catch (err) {
                this.logger.warn(`Cutout processing failed: ${err}`);
            }
        }

        // Upload to Cloudflare R2 / Storage
        const filename = `drape-${userId}-${Date.now()}.png`;
        const saved = await this.storage.save({
            buffer: imageBuffer,
            filename,
            folder: 'drape-results',
            mimetype: 'image/png',
        });

        // Save DrapedResult record in database
        const record = await this.prisma.drapedResult.create({
            data: {
                userId,
                imageUrl: saved.url,
                slots: activeSlots.map((s) => s.slot),
                provider: genResult.provider,
                model: genResult.model,
                noBackground,
            },
        });

        return {
            imageUrl: saved.url,
            provider: genResult.provider,
            model: genResult.model,
            resultId: record.id,
        };
    }

    /**
     * Drape for one or more people. Pass 1 dresses each person's twin in all of their pieces
     * (in parallel); a single person is placed straight into the scene in this pass. For a group,
     * pass 2 composes everyone into one photo, posed for their relation and placed in the scene. Both passes use Gemini, the engine that reads every
     * reference image. If composing fails, each person's render is still returned
     * so the client can fall back to its side-by-side collage.
     */
    async processGroup(userId: string, dto: GroupDrapeDto): Promise<GroupDrapeResult> {
        if (!dto.people.some((p) => normalisePieces(p.outfit).length > 0)) {
            throw new BadRequestException('Give at least one person an outfit.');
        }

        const stamp = Date.now();
        const renders = await Promise.allSettled(
            dto.people.map(async (person) => {
                if (normalisePieces(person.outfit).length === 0) return null;
                const single = dto.people.length === 1;
                const job = single ? buildPersonPrompt(person, dto.styling, dto.scene) : buildPersonPrompt(person);
                return this.imageProvider.generate({ ...job, aspectRatio: '3:4', engines: ['gemini'] });
            }),
        );

        const failures = renders.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        const attempted = dto.people.filter((p) => normalisePieces(p.outfit).length > 0).length;
        if (failures.length === attempted) {
            const reason = failures[0].reason;
            throw new BadRequestException(reason instanceof Error ? reason.message : String(reason));
        }

        // In-memory images feed pass 2; stored URLs go back to the client.
        const dressed = dto.people.map((p, i) => {
            const r = renders[i];
            return r.status === 'fulfilled' && r.value ? r.value.url : p.twinImage;
        });
        const people: GroupPersonResult[] = await Promise.all(
            dto.people.map(async (p, i) => {
                const r = renders[i];
                if (r.status === 'rejected') {
                    return { ref: p.ref, name: p.name, imageUrl: p.twinImage, dressed: false, error: String(r.reason?.message ?? r.reason) };
                }
                if (!r.value) return { ref: p.ref, name: p.name, imageUrl: p.twinImage, dressed: false };
                const imageUrl = await this.saveImage(r.value.url, `drape-${userId}-${stamp}-${i}.png`);
                return { ref: p.ref, name: p.name, imageUrl, dressed: true };
            }),
        );

        const firstRender = renders
            .map((r) => (r.status === 'fulfilled' ? r.value : null))
            .find((v): v is ImageResult => Boolean(v));
        const slots = Array.from(new Set(dto.people.flatMap((p) => normalisePieces(p.outfit).map((o) => o.slot))));

        if (dto.people.length === 1) {
            const record = await this.recordResult(userId, people[0].imageUrl, slots, firstRender!.provider, firstRender!.model);
            return { imageUrl: people[0].imageUrl, composed: false, posture: null, people, provider: firstRender!.provider, model: firstRender!.model, resultId: record.id };
        }

        const posture = resolvePosture(dto.people, dto.posture ?? 'auto');
        try {
            const job = buildGroupPrompt(dto, dressed);
            const group = await this.imageProvider.generate({
                ...job,
                aspectRatio: groupAspect(dto.people.length),
                engines: ['gemini'],
                geminiModel: process.env.GEMINI_GROUP_MODEL?.trim() || undefined,
            });
            const imageUrl = await this.saveImage(group.url, `drape-group-${userId}-${stamp}.png`);
            const record = await this.recordResult(userId, imageUrl, slots, group.provider, group.model);
            return { imageUrl, composed: true, posture, people, provider: group.provider, model: group.model, resultId: record.id };
        } catch (err) {
            this.logger.warn(`Group composition failed, returning individual renders: ${err}`);
            return { imageUrl: null, composed: false, posture, people, composeError: err instanceof Error ? err.message : String(err) };
        }
    }

    /**
     * Executes look edits (re-posing, cosmetics/makeup, or text describing).
     */
    async processLookEdit(
        userId: string,
        dto: LookEditDto,
    ): Promise<{ imageUrl: string; provider: string; model: string }> {
        let prompt: string;

        if (dto.mode === 'pose') {
            const poseDesc = POSE_PROMPTS[dto.pose ?? ''] || POSE_PROMPTS.front;
            prompt = `Show this exact same person wearing exactly the same outfit, ${poseDesc}. Keep their face, hairstyle, skin tone, body shape, every garment, colour, print and accessory identical. Studio fashion lighting, full body, photorealistic.`;
        } else if (dto.mode === 'makeup') {
            const makeupParts = this.buildMakeupPrompt(dto.makeup);
            prompt = `Close-up or portrait fashion photograph of the exact same person with modified makeup: ${makeupParts.join(', ')}. Keep their face, features, skin tone, hair and outfit identical. High-end beauty editorial photograph.`;
        } else {
            prompt = dto.prompt || 'High-end editorial fashion photograph of this exact person with updated styling.';
        }

        const genResult = await this.imageProvider.generate({
            prompt,
            images: [dto.image],
            aspectRatio: '3:4',
        });

        const imageBuffer = await this.urlOrDataToBuffer(genResult.url);
        const filename = `look-edit-${userId}-${Date.now()}.png`;
        const saved = await this.storage.save({
            buffer: imageBuffer,
            filename,
            folder: 'drape-results',
            mimetype: 'image/png',
        });

        return {
            imageUrl: saved.url,
            provider: genResult.provider,
            model: genResult.model,
        };
    }

    /**
     * Executes video animation of a look.
     */
    async processAnimate(dto: AnimateDto): Promise<{ videoUrl: string }> {
        const motionDesc = MOTIONS[dto.motion] || MOTIONS.turn;
        const prompt = `${motionDesc} Keep the person's face, body and every detail of the outfit exactly the same. Steady camera, photorealistic, smooth motion.`;

        // Video models run via Replicate official video model or fallback
        const model = process.env.LIVENESS_MODEL || 'wan-video/wan-2.2-i2v-fast';
        const res = await this.imageProvider.generate({
            prompt,
            images: [dto.image],
            replicate: {
                model,
                run: async () => {
                    const token = process.env.REPLICATE_API_TOKEN;
                    if (!token) throw new Error('REPLICATE_API_TOKEN required for video animation');
                    const response = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                            Prefer: 'wait',
                        },
                        body: JSON.stringify({
                            input: {
                                image: dto.image,
                                prompt,
                            },
                        }),
                    });
                    const data = await response.json();
                    return Array.isArray(data.output) ? data.output[0] : data.output;
                },
            },
        });

        return { videoUrl: res.url };
    }

    /**
     * Removes background from a raw image buffer and returns PNG bytes with subject bounding box.
     */
    async processCutout(buffer: Buffer) {
        return this.cutout.removeBackground(buffer);
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private async saveImage(urlOrData: string, filename: string): Promise<string> {
        const buffer = await this.urlOrDataToBuffer(urlOrData);
        const saved = await this.storage.save({ buffer, filename, folder: 'drape-results', mimetype: 'image/png' });
        return saved.url;
    }

    private recordResult(userId: string, imageUrl: string, slots: string[], provider: string, model: string) {
        return this.prisma.drapedResult.create({ data: { userId, imageUrl, slots, provider, model } });
    }

    private buildMakeupPrompt(makeup?: MakeupOptions): string[] {
        if (!makeup) return ['natural clean beauty makeup'];
        const parts: string[] = [];
        if (makeup.lipstick) {
            const finish = makeup.finish === 'gloss' ? 'glossy' : makeup.finish === 'matte' ? 'matte' : 'satin';
            parts.push(`${finish} lipstick in ${makeup.lipstick}`);
        }
        if (makeup.eyeshadow) {
            parts.push(`soft blended eyeshadow in ${makeup.eyeshadow}`);
        }
        if (typeof makeup.blush === 'number' && makeup.blush > 0) {
            const intensity = makeup.blush < 35 ? 'a subtle' : makeup.blush < 70 ? 'a natural' : 'a pronounced';
            parts.push(`${intensity} flush of blush on cheeks`);
        }
        return parts.length ? parts : ['natural clean beauty makeup'];
    }

    private async urlOrDataToBuffer(urlOrData: string): Promise<Buffer> {
        if (urlOrData.startsWith('data:')) {
            const base64Data = urlOrData.split(',')[1] || urlOrData;
            return Buffer.from(base64Data, 'base64');
        }
        return (await downloadStored(urlOrData)).body;
    }
}
