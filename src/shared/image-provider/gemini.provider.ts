import { Injectable, Logger } from '@nestjs/common';
import { ImageJob, ImageProvider, ImageResult } from './image-provider.interface';

type Inline = { mimeType: string; data: string };

/**
 * Gemini image generation provider.
 *
 * Uses the Gemini generateContent API with responseModalities=["IMAGE"].
 * Accepts data URIs or public HTTPS URLs as reference images.
 * Optimized with high-threshold safety settings suitable for fashion photography & virtual try-on.
 */
@Injectable()
export class GeminiImageProvider implements ImageProvider {
    private readonly logger = new Logger(GeminiImageProvider.name);

    private get apiKey(): string {
        return process.env.GEMINI_API_KEY?.trim() ?? '';
    }

    private get model(): string {
        return process.env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-2.0-flash-exp';
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

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
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
            throw Object.assign(
                new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`),
                { quota: isQuota, model: this.model },
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
            return { url: dataUri, provider: 'gemini', model: this.model };
        }

        const reason =
            data.promptFeedback?.blockReason ??
            candidate?.finishReason ??
            'no image returned';
        throw new Error(`Gemini returned no image (${reason})`);
    }

    // ── Input helpers ──────────────────────────────────────────────────────────

    private async toInline(src: string): Promise<Inline> {
        const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(src);
        if (match) return { mimeType: match[1], data: match[2] };

        // Public URL — download and encode
        const res = await fetch(src, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OutfitChecker/1.0)' },
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
            throw new Error(`Gemini: could not download input image from ${src} (HTTP ${res.status})`);
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
        return { mimeType: contentType, data: buffer.toString('base64') };
    }
}
