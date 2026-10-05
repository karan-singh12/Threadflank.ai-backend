import { Injectable, Logger } from '@nestjs/common';
import { ImageJob, ImageProvider, ImageResult } from './image-provider.interface';
import { downloadStored } from '../storage/r2-objects';

type Inline = { mimeType: string; data: string };

/**
 * Gemini image generation provider.
 *
 * Uses the Gemini generateContent API with responseModalities=["IMAGE"].
 * Accepts data URIs or public HTTPS URLs as reference images.
 * Optimized for fashion model photography & virtual try-on.
 */
@Injectable()
export class GeminiImageProvider implements ImageProvider {
    private readonly logger = new Logger(GeminiImageProvider.name);

    private get apiKey(): string {
        return process.env.GEMINI_API_KEY?.trim() ?? '';
    }

    private get model(): string {
        const configured = process.env.GEMINI_IMAGE_MODEL?.trim();
        // Discard deprecated experimental models that return 404
        if (!configured || configured === 'gemini-2.0-flash-exp') {
            return 'gemini-2.5-flash-image';
        }
        return configured;
    }

    isConfigured(): boolean {
        return Boolean(this.apiKey);
    }

    async generate(job: ImageJob): Promise<ImageResult> {
        if (!this.apiKey) {
            throw new Error('GEMINI_API_KEY is not configured.');
        }

        const parts: unknown[] = [];

        // Prepend reference images as inlineData parts
        for (const src of job.images ?? []) {
            const inline = await this.toInline(src);
            parts.push({ inlineData: inline });
        }

        // Format prompt for high-fidelity fashion generation if needed
        let promptText = job.prompt;
        if (job.images && job.images.length > 1 && !promptText.toLowerCase().includes('image 1')) {
            promptText = `Reference images: Image 1 is the base subject/person, and subsequent images are the target garments/items. ${promptText}`;
        }

        parts.push({ text: promptText });

        const candidateModels = [job.geminiModel, this.model, 'gemini-2.5-flash-image', 'gemini-3.1-flash-image'].filter(
            (m): m is string => Boolean(m),
        );
        const uniqueModels = Array.from(new Set(candidateModels));

        let lastError: any = null;

        for (const modelToTry of uniqueModels) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToTry}:generateContent`;

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': this.apiKey,
                    },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts }],
                        generationConfig: {
                            responseModalities: ['IMAGE'],
                            imageConfig: { aspectRatio: job.aspectRatio ?? '3:4' },
                        },
                        safetySettings: [
                            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
                            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
                            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
                            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
                        ],
                    }),
                });

                if (!res.ok) {
                    const body = await res.text().catch(() => '');
                    const isQuota =
                        res.status === 402 ||
                        res.status === 429 ||
                        /RESOURCE_EXHAUSTED|insufficient_quota/.test(body);

                    // If 404, try next candidate model
                    if (res.status === 404 && modelToTry !== uniqueModels[uniqueModels.length - 1]) {
                        this.logger.warn(`Model ${modelToTry} returned 404, attempting fallback model...`);
                        continue;
                    }

                    throw Object.assign(
                        new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`),
                        { quota: isQuota, model: modelToTry },
                    );
                }

                type GeminiPart = { text?: string; inlineData?: Inline };
                const data = (await res.json()) as {
                    candidates?: {
                        content?: { parts?: GeminiPart[] };
                        finishReason?: string;
                    }[];
                    promptFeedback?: { blockReason?: string };
                };

                const candidate = data.candidates?.[0];
                const image = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;

                if (image) {
                    const dataUri = `data:${image.mimeType || 'image/png'};base64,${image.data}`;
                    return { url: dataUri, provider: 'gemini', model: modelToTry };
                }

                const reason =
                    data.promptFeedback?.blockReason ??
                    candidate?.finishReason ??
                    'no image returned';
                throw new Error(`Gemini returned no image (${reason})`);
            } catch (err: any) {
                lastError = err;
                if (err?.status === 404 && modelToTry !== uniqueModels[uniqueModels.length - 1]) {
                    continue;
                }
                break;
            }
        }

        throw lastError;
    }

    // ── Input helpers ──────────────────────────────────────────────────────────

    private async toInline(src: string): Promise<Inline> {
        const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(src);
        if (match) return { mimeType: match[1], data: match[2] };

        // URL — download (our own R2 files with the bucket credentials) and encode
        try {
            const file = await downloadStored(src, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OutfitChecker/1.0)' },
                signal: AbortSignal.timeout(15_000),
            });
            return { mimeType: file.contentType, data: file.body.toString('base64') };
        } catch (err) {
            throw new Error(`Gemini: could not download input image: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
