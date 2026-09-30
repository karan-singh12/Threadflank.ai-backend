import { Injectable, Logger } from '@nestjs/common';
import { ImageJob, ImageProvider, ImageResult } from './image-provider.interface';

const REPLICATE_API = 'https://api.replicate.com/v1';
const POLL_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

type Prediction = {
    id: string;
    status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
    output?: string | string[];
    error?: string;
};

/**
 * Replicate image provider.
 *
 * For jobs that carry a `replicate.run` function (e.g. IDM-VTON, FLUX Kontext)
 * that function is called directly so the caller retains full control of the
 * model input. For generic jobs the provider falls back to
 * `black-forest-labs/flux-schnell`.
 */
@Injectable()
export class ReplicateImageProvider implements ImageProvider {
    private readonly logger = new Logger(ReplicateImageProvider.name);

    private get token(): string {
        return process.env.REPLICATE_API_TOKEN?.trim() ?? '';
    }

    isConfigured(): boolean {
        return Boolean(this.token);
    }

    async generate(job: ImageJob): Promise<ImageResult> {
        if (!this.token) {
            throw new Error('REPLICATE_API_TOKEN is not configured.');
        }

        // Use the caller-supplied runner when available (IDM-VTON, FLUX Kontext, etc.)
        if (job.replicate?.run) {
            const url = await job.replicate.run();
            return { url, provider: 'replicate', model: job.replicate.model };
        }

        // Generic fallback: FLUX Schnell (fast, no image inputs required)
        const model = 'black-forest-labs/flux-schnell';
        const url = await this.runOfficialModel(model, {
            prompt: job.prompt,
            aspect_ratio: job.aspectRatio ?? '3:4',
        });
        return { url, provider: 'replicate', model };
    }

    // ── Shared Replicate utilities (used by DrapeService run() closures too) ────

    async runOfficialModel(
        model: string,
        input: Record<string, unknown>,
        opts: { timeoutMs?: number } = {},
    ): Promise<string> {
        const headers = {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };

        const created = await fetch(`${REPLICATE_API}/models/${model}/predictions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ input }),
        });

        if (!created.ok) {
            const text = await created.text().catch(() => '');
            throw new Error(`Replicate error ${created.status}: ${text.slice(0, 300)}`);
        }

        let prediction = (await created.json()) as Prediction;
        return this.poll(prediction.id, opts.timeoutMs);
    }

    async runVersionedModel(
        version: string,
        input: Record<string, unknown>,
        opts: { timeoutMs?: number } = {},
    ): Promise<string> {
        const headers = {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };

        const created = await fetch(`${REPLICATE_API}/predictions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ version, input }),
        });

        if (!created.ok) {
            const text = await created.text().catch(() => '');
            throw new Error(`Replicate versioned model error ${created.status}: ${text.slice(0, 300)}`);
        }

        const prediction = (await created.json()) as Prediction;
        return this.poll(prediction.id, opts.timeoutMs);
    }

    private async poll(predictionId: string, timeoutMs = POLL_TIMEOUT_MS): Promise<string> {
        const headers = { Authorization: `Bearer ${this.token}` };
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

            const res = await fetch(`${REPLICATE_API}/predictions/${predictionId}`, { headers });
            if (!res.ok) throw new Error(`Replicate poll failed: ${res.status}`);

            const data = (await res.json()) as Prediction;

            if (data.status === 'succeeded') {
                const output = Array.isArray(data.output) ? data.output[0] : data.output;
                if (!output) throw new Error('Replicate returned no output.');
                return output;
            }

            if (data.status === 'failed' || data.status === 'canceled') {
                throw new Error(
                    `Replicate prediction ${data.status}: ${data.error ?? 'unknown error'}`,
                );
            }
        }

        throw new Error(
            `Replicate prediction timed out after ${Math.round(timeoutMs / 60_000)} minutes.`,
        );
    }

    /** Convenience getter so DrapeService closures can access the token. */
    getToken(): string {
        return this.token;
    }
}
