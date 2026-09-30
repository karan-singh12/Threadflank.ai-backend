import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { GeminiImageProvider } from './gemini.provider';
import { ImageJob, ImageProvider, ImageResult } from './image-provider.interface';
import { ReplicateImageProvider } from './replicate.provider';

export type EngineAttempt = {
    provider: string;
    model: string;
    latencyMs: number;
    error: string;
};

@Injectable()
export class ImageProviderService {
    private readonly logger = new Logger(ImageProviderService.name);

    constructor(
        private readonly replicateProvider: ReplicateImageProvider,
        private readonly geminiProvider: GeminiImageProvider,
    ) {}

    /**
     * Determines the order of providers to try based on IMAGE_ENGINES env var.
     * Default order: ['replicate', 'gemini']
     */
    private getEngineOrder(): ('replicate' | 'gemini')[] {
        const envOrder = process.env.IMAGE_ENGINES?.split(',')
            .map((s) => s.trim().toLowerCase())
            .filter((s): s is 'replicate' | 'gemini' => s === 'replicate' || s === 'gemini');

        if (envOrder && envOrder.length > 0) {
            return Array.from(new Set(envOrder));
        }

        return ['replicate', 'gemini'];
    }

    /**
     * Maps engine name to provider instance.
     */
    private getProvider(engine: 'replicate' | 'gemini'): ImageProvider {
        return engine === 'gemini' ? this.geminiProvider : this.replicateProvider;
    }

    /**
     * Generates an image using the first available provider, automatically
     * falling back to secondary providers if the primary encounters quota/rate limits or failure.
     */
    async generate(job: ImageJob): Promise<ImageResult> {
        const order = this.getEngineOrder();
        const configuredEngines = order.filter((engine) => this.getProvider(engine).isConfigured());

        if (configuredEngines.length === 0) {
            throw new InternalServerErrorException(
                'No image generation provider is configured. Please provide GEMINI_API_KEY or REPLICATE_API_TOKEN in backend environment variables.',
            );
        }

        const failedAttempts: EngineAttempt[] = [];

        for (const engine of configuredEngines) {
            const provider = this.getProvider(engine);
            const startTime = Date.now();

            this.logger.log(`Attempting image generation with provider: ${engine}`);

            try {
                const result = await provider.generate(job);
                const latencyMs = Date.now() - startTime;
                this.logger.log(`Image generation succeeded via ${engine} in ${latencyMs}ms (model: ${result.model})`);
                return result;
            } catch (err: any) {
                const latencyMs = Date.now() - startTime;
                const errorMessage = err?.message || String(err);
                this.logger.warn(`Provider ${engine} failed after ${latencyMs}ms: ${errorMessage}`);

                failedAttempts.push({
                    provider: engine,
                    model: (err as any)?.model || engine,
                    latencyMs,
                    error: errorMessage,
                });
            }
        }

        const summary = failedAttempts
            .map((a) => `[${a.provider}] (${a.latencyMs}ms): ${a.error}`)
            .join('; ');

        this.logger.error(`All configured image providers failed: ${summary}`);

        throw new InternalServerErrorException(
            `All configured image providers failed: ${summary}`,
        );
    }
}
