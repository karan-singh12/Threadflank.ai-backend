import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CutoutService } from '../../shared/cutout/cutout.service';
import { ImageProviderService } from '../../shared/image-provider/image-provider.service';
import { IStorageProvider, STORAGE_PROVIDER } from '../../shared/storage/storage.interface';
import { AnimateDto } from './dto/animate.dto';
import { LookEditDto, MakeupOptions } from './dto/look-edit.dto';
import { GarmentSlot, SlotItem, TryOnRequestDto } from './dto/tryon.dto';

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
        const res = await fetch(urlOrData);
        if (!res.ok) {
            throw new Error(`Failed to download image from ${urlOrData} (HTTP ${res.status})`);
        }
        return Buffer.from(await res.arrayBuffer());
    }
}
