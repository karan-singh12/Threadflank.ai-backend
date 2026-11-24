import { Injectable, Logger, Optional } from '@nestjs/common';
import { SdkService } from '../../sdk';

/** JSON Schema subset both engines accept for structured output. */
export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  description?: string;
};

export interface VisionRequest {
  /** What to work out. The schema is appended for the engine that cannot take one natively. */
  prompt: string;
  /** Optional photo as a data URI. Without one this is a plain structured text call. */
  image?: string;
  schema: JsonSchema;
  /** Shown in the AI request log, e.g. "brand:abc" or "catalog:auto-tag". */
  requestedBy: string;
  taskType: string;
}

const TIMEOUT_MS = 45_000;

/** Thrown when neither engine is configured or both failed. `quota` tells the caller why, for its message. */
export class VisionUnavailableError extends Error {
  constructor(
    message: string,
    readonly quota = false,
  ) {
    super(message);
  }
}

/**
 * Gemini's responseSchema is the OpenAPI subset with upper-case type names (STRING, OBJECT), while
 * the rest of the code writes ordinary JSON Schema. Converted here, once, recursively.
 */
export function toGeminiSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type.toUpperCase() };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.required) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  return out;
}

/**
 * Reads the model's answer as JSON. Engines sometimes wrap it in a ```json fence or add a sentence
 * around it even when asked not to, so this takes the outermost {...} rather than trusting the text.
 */
export function parseJsonAnswer<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error('the answer was not JSON');
  }
}

/**
 * Looks at a photo (or just a brief) and answers in JSON: what a garment is, whether a photo is fit
 * for try-on, a product description. Gemini goes first because it takes a response schema natively;
 * OpenAI is the fallback, told the schema in the prompt. Both are already configured for the text
 * features, and text quota is separate from image-generation quota, so this works on keys whose
 * image quota is exhausted.
 */
@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);

  constructor(@Optional() private readonly sdk?: SdkService) {}

  private get geminiKey() {
    return process.env.GEMINI_API_KEY?.trim() ?? '';
  }
  private get openaiKey() {
    return process.env.OPENAI_API_KEY?.trim() ?? '';
  }

  isConfigured(): boolean {
    return Boolean(this.geminiKey || this.openaiKey);
  }

  async json<T>(req: VisionRequest): Promise<T> {
    if (!this.isConfigured()) throw new VisionUnavailableError('No AI engine is configured.');
    const errors: string[] = [];
    let quota = false;
    const engines: ((r: VisionRequest) => Promise<unknown>)[] = [(r) => this.gemini(r), (r) => this.openai(r)];
    for (const engine of engines) {
      try {
        const answer = (await engine(req)) as T | undefined;
        if (answer !== undefined) return answer;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/quota|RESOURCE_EXHAUSTED|rate limit|429|insufficient_quota/i.test(msg)) quota = true;
        errors.push(msg);
      }
    }
    this.logger.warn(`vision ${req.taskType} failed: ${errors.join(' | ').slice(0, 400)}`);
    throw new VisionUnavailableError(errors.join(' | ') || 'No engine answered.', quota);
  }

  private async gemini<T>(req: VisionRequest): Promise<T | undefined> {
    if (!this.geminiKey) return undefined;
    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
    const base = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const parts: unknown[] = [];
    if (req.image) {
      const m = req.image.match(/^data:([^;,]+);base64,(.*)$/s);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    parts.push({ text: req.prompt });
    const started = Date.now();
    try {
      const res = await this.post(`${base}/v1beta/models/${model}:generateContent`, { 'x-goog-api-key': this.geminiKey }, {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(req.schema), temperature: 0.2 },
      });
      const data = res as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!text) throw new Error('Gemini returned no text');
      const answer = parseJsonAnswer<T>(text);
      void this.log({ provider: 'gemini', model, req, started, success: true });
      return answer;
    } catch (e) {
      void this.log({ provider: 'gemini', model, req, started, success: false, error: e });
      throw e;
    }
  }

  private async openai<T>(req: VisionRequest): Promise<T | undefined> {
    if (!this.openaiKey) return undefined;
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
    const content: unknown[] = [
      { type: 'text', text: `${req.prompt}\n\nAnswer with one JSON object only, matching this JSON Schema:\n${JSON.stringify(req.schema)}` },
    ];
    if (req.image) content.push({ type: 'image_url', image_url: { url: req.image } });
    const started = Date.now();
    try {
      const res = await this.post('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${this.openaiKey}` }, {
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content }],
      });
      const data = res as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error('OpenAI returned no text');
      const answer = parseJsonAnswer<T>(text);
      void this.log({ provider: 'openai', model, req, started, success: true });
      return answer;
    } catch (e) {
      void this.log({ provider: 'openai', model, req, started, success: false, error: e });
      throw e;
    }
  }

  private async post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return await res.json();
    } catch (e) {
      if (controller.signal.aborted) throw new Error('the engine took too long to answer');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private async log(o: { provider: string; model: string; req: VisionRequest; started: number; success: boolean; error?: unknown }) {
    try {
      await this.sdk?.logExternalCall({
        provider: o.provider,
        model: o.model,
        taskType: o.req.taskType,
        latencyMs: Date.now() - o.started,
        success: o.success,
        errorMessage: o.error ? (o.error instanceof Error ? o.error.message : String(o.error)).slice(0, 500) : undefined,
        requestedBy: o.req.requestedBy,
      });
    } catch {
      /* logging never breaks a request */
    }
  }
}
