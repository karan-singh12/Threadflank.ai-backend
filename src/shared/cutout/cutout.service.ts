import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

/** Where the person sits in the image, as fractions of width/height (for the floor shadow). */
export type SubjectBox = { x: number; y: number; w: number; h: number };
export type Cutout = { png: Buffer; box: SubjectBox | null };

type Segmenter = (image: unknown) => Promise<unknown>;

/**
 * Removes the studio backdrop from a twin or render so the person can stand
 * directly in a Drape scene. Runs MODNet (Apache-2.0, ~6.6 MB at 8-bit) through
 * transformers.js on the server: no API key, no per-image cost.
 */
@Injectable()
export class CutoutService {
    private readonly logger = new Logger(CutoutService.name);
    private segmenterPromise: Promise<Segmenter> | null = null;
    private readonly cache = new Map<string, Cutout>();
    private readonly CACHE_MAX = 60;

    private getSegmenter(): Promise<Segmenter> {
        this.segmenterPromise ??= import('@huggingface/transformers')
            .then(({ pipeline }) => pipeline('background-removal', 'Xenova/modnet', { dtype: 'q8' }) as unknown as Promise<Segmenter>)
            .catch((err) => {
                this.segmenterPromise = null;
                this.logger.error('Failed to load MODNet segmentation model', err);
                throw err;
            });
        return this.segmenterPromise;
    }

    /** Bounding box of pixels that are at least half opaque. */
    private subjectBox(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): SubjectBox | null {
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < height; y += 2) {
            const row = y * width * 4;
            for (let x = 0; x < width; x += 2) {
                if (rgba[row + x * 4 + 3] > 128) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (maxX < 0) return null;
        return {
            x: minX / width,
            y: minY / height,
            w: (maxX - minX) / width,
            h: (maxY - minY) / height,
        };
    }

    /**
     * Removes background from input image buffer and returns PNG cutout with subject box.
     */
    async removeBackground(input: Buffer): Promise<Cutout> {
        const key = createHash('sha1').update(input).digest('hex');
        const hit = this.cache.get(key);
        if (hit) return hit;

        try {
            const sharpModule = await import('sharp');
            const sharp = sharpModule.default || sharpModule;
            const [{ RawImage }, segment] = await Promise.all([
                import('@huggingface/transformers'),
                this.getSegmenter(),
            ]);

            const image = await RawImage.fromBlob(new Blob([new Uint8Array(input)]));
            const result = await segment(image);
            const out = (Array.isArray(result) ? result[0] : result) as {
                data: Uint8ClampedArray;
                width: number;
                height: number;
                channels: number;
            };

            if (out.channels !== 4) {
                throw new Error(`Expected an RGBA cut-out, got ${out.channels} channels`);
            }

            const png = await sharp(Buffer.from(out.data), {
                raw: { width: out.width, height: out.height, channels: 4 },
            })
                .png({ compressionLevel: 8 })
                .toBuffer();

            const cutout: Cutout = {
                png,
                box: this.subjectBox(out.data, out.width, out.height),
            };

            if (this.cache.size >= this.CACHE_MAX) {
                const oldestKey = this.cache.keys().next().value;
                if (oldestKey) this.cache.delete(oldestKey);
            }
            this.cache.set(key, cutout);

            return cutout;
        } catch (err: any) {
            this.logger.warn(`MODNet background cutout encountered issue: ${err?.message || err}. Falling back to original image.`);
            return { png: input, box: null };
        }
    }
}
