import { Logger } from '@nestjs/common';

/**
 * Image-to-video engines for the brand AI Studio. A render takes minutes, so an engine starts a job
 * and is asked later how it is going. Two engines:
 *
 * - Veo, through the Gemini API (`predictLongRunning`, then poll the operation). Needs a Gemini key
 *   whose Google project has Veo access (paid billing). The model is BRAND_VIDEO_VEO_MODEL, or the
 *   best Veo model the key lists.
 * - Replicate image-to-video (default `wan-video/wan-2.2-i2v-fast`, or BRAND_VIDEO_REPLICATE_MODEL).
 *   Needs REPLICATE_API_TOKEN.
 *
 * BRAND_VIDEO_ENGINE ("veo" | "replicate") forces one; otherwise the first one with access is used.
 */

export type VideoInput = {
  /** The garment photo, as raw bytes. */
  image: { bytes: Buffer; mimeType: string };
  /** The same photo as a URL or data URI, for engines that fetch it themselves. */
  imageUrl: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  durationSec: number;
};

export type VideoCheck = { state: 'running' } | { state: 'done'; video: Buffer; mimeType: string } | { state: 'failed'; reason: string };

export interface VideoEngine {
  readonly id: 'veo' | 'replicate';
  /** The model this engine will use, or null when it has no access. */
  model(): Promise<string | null>;
  /** Shapes the engine can render; an empty list means it follows the photo's own shape. */
  readonly aspectRatios: string[];
  readonly durationSec: number;
  start(input: VideoInput): Promise<{ operation: string; model: string }>;
  check(operation: string): Promise<VideoCheck>;
}

const logger = new Logger('BrandVideoEngines');

/** Reads an error message from a Google or Replicate JSON error body. */
async function errorText(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string; detail?: string } | null;
  const msg = typeof body?.error === 'string' ? body.error : body?.error?.message ?? body?.detail;
  return msg || `HTTP ${res.status}`;
}

async function download(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download the rendered video (HTTP ${res.status}).`);
  return { video: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get('content-type')?.split(';')[0] || 'video/mp4' };
}

// ── Veo (Gemini API) ──────────────────────────────────────────────────────

export class VeoEngine implements VideoEngine {
  readonly id = 'veo' as const;
  readonly aspectRatios = ['9:16', '16:9'];
  readonly durationSec = 8;
  private cached: { model: string | null; at: number } | null = null;

  private get key() {
    return process.env.GEMINI_API_KEY?.trim() || '';
  }

  private get api() {
    const base = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    return /\/v1(beta)?$/.test(base) ? base : `${base}/v1beta`;
  }

  /** BRAND_VIDEO_VEO_MODEL, else the best Veo model this key can run (checked every 10 minutes). */
  async model(): Promise<string | null> {
    if (!this.key) return null;
    const forced = process.env.BRAND_VIDEO_VEO_MODEL?.trim();
    if (forced) return forced;
    if (this.cached && Date.now() - this.cached.at < 10 * 60_000) return this.cached.model;
    let model: string | null = null;
    try {
      const res = await fetch(`${this.api}/models?pageSize=1000`, { headers: { 'x-goog-api-key': this.key } });
      const body = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      const names = (body.models ?? [])
        .filter((m) => /veo/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes('predictLongRunning'))
        .map((m) => m.name.replace(/^models\//, ''));
      // Newest generation first; within one, the full model before the fast one.
      const rank = (n: string) => {
        const v = Number(n.match(/veo-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
        return v * 10 - (/fast/.test(n) ? 1 : 0) - (/preview/.test(n) ? 0.5 : 0);
      };
      model = names.sort((a, b) => rank(b) - rank(a))[0] ?? null;
    } catch (err) {
      logger.warn(`Could not list Veo models: ${err}`);
    }
    this.cached = { model, at: Date.now() };
    return model;
  }

  async start(input: VideoInput) {
    const model = await this.model();
    if (!model) throw new Error('Veo is not available for this Gemini key.');
    const parameters: Record<string, unknown> = {
      aspectRatio: this.aspectRatios.includes(input.aspectRatio) ? input.aspectRatio : '9:16',
      personGeneration: 'allow_adult',
      negativePrompt: input.negativePrompt,
    };
    // Veo 2 needs the length; Veo 3 and later render 8 seconds by default.
    if (/veo-2/.test(model)) parameters.durationSeconds = input.durationSec;
    const res = await fetch(`${this.api}/models/${model}:predictLongRunning`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: input.prompt, image: { bytesBase64Encoded: input.image.bytes.toString('base64'), mimeType: input.image.mimeType } }],
        parameters,
      }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    const op = (await res.json()) as { name?: string };
    if (!op.name) throw new Error('Veo did not return a job id.');
    return { operation: op.name, model };
  }

  async check(operation: string): Promise<VideoCheck> {
    const res = await fetch(`${this.api}/${operation}`, { headers: { 'x-goog-api-key': this.key } });
    if (!res.ok) {
      // A temporary error while checking is not a failed render; try again on the next check.
      if (res.status >= 500 || res.status === 429) return { state: 'running' };
      return { state: 'failed', reason: await errorText(res) };
    }
    const op = (await res.json()) as {
      done?: boolean;
      error?: { message?: string };
      response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } };
    };
    if (!op.done) return { state: 'running' };
    if (op.error) return { state: 'failed', reason: op.error.message || 'The render failed.' };
    const out = op.response?.generateVideoResponse;
    const uri = out?.generatedSamples?.[0]?.video?.uri;
    if (!uri) {
      const why = out?.raiMediaFilteredReasons?.[0];
      return { state: 'failed', reason: why ? `Google's safety filter blocked this clip: ${why}` : 'The engine finished without a video.' };
    }
    return { state: 'done', ...(await download(uri, { 'x-goog-api-key': this.key })) };
  }
}

// ── Replicate ─────────────────────────────────────────────────────────────

export class ReplicateEngine implements VideoEngine {
  readonly id = 'replicate' as const;
  readonly aspectRatios: string[] = [];
  readonly durationSec = 5;

  private get token() {
    return process.env.REPLICATE_API_TOKEN?.trim() || '';
  }

  async model() {
    if (!this.token) return null;
    return process.env.BRAND_VIDEO_REPLICATE_MODEL?.trim() || 'wan-video/wan-2.2-i2v-fast';
  }

  async start(input: VideoInput) {
    const model = await this.model();
    if (!model) throw new Error('REPLICATE_API_TOKEN is not set.');
    const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { image: input.imageUrl, prompt: input.prompt, negative_prompt: input.negativePrompt } }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    const p = (await res.json()) as { id?: string };
    if (!p.id) throw new Error('Replicate did not return a job id.');
    return { operation: p.id, model };
  }

  async check(operation: string): Promise<VideoCheck> {
    const res = await fetch(`https://api.replicate.com/v1/predictions/${operation}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) return { state: 'running' };
      return { state: 'failed', reason: await errorText(res) };
    }
    const p = (await res.json()) as { status?: string; output?: string | string[] | null; error?: string | null };
    if (p.status === 'succeeded') {
      const url = Array.isArray(p.output) ? p.output[0] : p.output;
      if (!url) return { state: 'failed', reason: 'The engine finished without a video.' };
      return { state: 'done', ...(await download(url)) };
    }
    if (p.status === 'failed' || p.status === 'canceled') return { state: 'failed', reason: p.error || 'The render failed.' };
    return { state: 'running' };
  }
}

export const VIDEO_ENGINES: VideoEngine[] = [new VeoEngine(), new ReplicateEngine()];

/** BRAND_VIDEO_ENGINE when set, otherwise the first engine with access. Null when none has. */
export async function pickVideoEngine(engines = VIDEO_ENGINES): Promise<{ engine: VideoEngine; model: string } | null> {
  const forced = process.env.BRAND_VIDEO_ENGINE?.trim().toLowerCase();
  for (const engine of forced ? engines.filter((e) => e.id === forced) : engines) {
    const model = await engine.model();
    if (model) return { engine, model };
  }
  return null;
}

export const engineById = (id: string, engines = VIDEO_ENGINES) => engines.find((e) => e.id === id);
