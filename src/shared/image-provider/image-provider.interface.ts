/**
 * Shared image generation interface used by DrapeModule and TwinModule.
 *
 * Both modules inject ImageProviderService which implements the Replicate-primary
 * → Gemini-fallback chain in one place.
 */

export type AspectRatio = '3:4' | '1:1' | '4:3' | '9:16';

export interface ImageJob {
    /**
     * Instruction for the provider. For multi-image models refer to inputs as
     * "image 1", "image 2", etc.
     */
    prompt: string;

    /**
     * Reference images as data URIs (data:image/...;base64,...) or public HTTPS
     * URLs, in the order the prompt names them.
     */
    images?: string[];

    aspectRatio?: AspectRatio;

    /**
     * Replicate-specific overrides. When set, the ReplicateImageProvider calls
     * `run()` directly instead of the generic predictions endpoint. The `model`
     * field is used only for logging/observability.
     */
    replicate?: {
        model: string;
        run: () => Promise<string>;
    };
}

export interface ImageResult {
    /** Public URL or data URI of the generated image. */
    url: string;
    /** Provider that produced the result: "replicate" | "gemini". */
    provider: string;
    /** Model identifier used, e.g. "cuuupid/idm-vton" or "gemini-2.0-flash-exp". */
    model: string;
}

export interface ImageProvider {
    /**
     * Returns true if this provider has the required credentials in the current
     * environment. Called at startup to decide the provider order.
     */
    isConfigured(): boolean;

    /**
     * Generate an image and resolve with its URL or a data URI.
     * Throws on unrecoverable failure — the caller decides whether to fall back.
     */
    generate(job: ImageJob): Promise<ImageResult>;
}

/** NestJS injection token — inject ImageProviderService, not providers directly. */
export const IMAGE_PROVIDER = Symbol('IMAGE_PROVIDER');
