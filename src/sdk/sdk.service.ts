import { Injectable } from '@nestjs/common';
import { CaptionGenerationChain } from './chains/caption-generation.chain';
import { OccasionPlannerAgent, OccasionPlanResult } from './agents/occasion-planner.agent';
import { WardrobeCombosAgent, WardrobeCombo } from './agents/wardrobe-combos.agent';
import { RagQueryService, RagQueryResult } from './rag/rag-query.service';
import { EmbedPipeline } from './rag/ingestion/embed-pipeline';
import { RagDocument } from './rag/ingestion/loader';
import { ClientFactory } from './core/client-factory';
import { ROUTER_CONFIG } from './core/router/router-config';
import { CaptionPromptInput } from './prompts/caption-generation.prompt';
import { OccasionPromptInput } from './prompts/occasion-planner.prompt';
import { WardrobeCombosInput } from './prompts/wardrobe-combos.prompt';
import { RouteOverride } from './core/router/router.types';
import { AiRequestLoggerService, AiRequestLogInput } from './logging/ai-request-logger.service';

/**
 * Single public facade for GenAI capability. Every other module in the app
 * (BrandPostsService, the CMS module, sdk.controller.ts, ...) imports SdkModule
 * and calls SdkService — never a LangChain class or provider SDK directly.
 */
@Injectable()
export class SdkService {
  constructor(
    private readonly captionChain: CaptionGenerationChain,
    private readonly occasionAgent: OccasionPlannerAgent,
    private readonly combosAgent: WardrobeCombosAgent,
    private readonly ragQueryService: RagQueryService,
    private readonly embedPipeline: EmbedPipeline,
    private readonly clientFactory: ClientFactory,
    private readonly requestLogger: AiRequestLoggerService,
  ) {}

  generateCaption(input: CaptionPromptInput, opts: { override?: RouteOverride; requestedBy?: string } = {}): Promise<string> {
    return this.captionChain.run(input, opts);
  }

  runOccasionPlanner(userId: string, input: OccasionPromptInput): Promise<OccasionPlanResult> {
    return this.occasionAgent.run(userId, input);
  }

  generateWardrobeCombos(userId: string, input: WardrobeCombosInput): Promise<{ combos: WardrobeCombo[] }> {
    return this.combosAgent.run(userId, input);
  }

  ragQuery(question: string, opts: { namespace?: string; topK?: number; requestedBy?: string } = {}): Promise<RagQueryResult> {
    return this.ragQueryService.query(question, opts.namespace, opts.topK, opts.requestedBy);
  }

  ingestDocument(doc: RagDocument, namespace?: string): Promise<number> {
    return this.embedPipeline.ingest(doc, namespace);
  }

  removeDocument(sourceType: string, sourceId: string, namespace?: string): Promise<number> {
    return this.embedPipeline.remove(sourceType, sourceId, namespace);
  }

  /** Records an AI call made outside the router (e.g. Replicate image/video models run by the web app). */
  logExternalCall(input: AiRequestLogInput): Promise<void> {
    return this.requestLogger.log(input);
  }

  async embedText(texts: string[]): Promise<number[][]> {
    const provider = this.clientFactory.get(ROUTER_CONFIG.embeddingProvider);
    if (!provider.embed) {
      throw new Error(`Configured embedding provider "${ROUTER_CONFIG.embeddingProvider}" does not support embed()`);
    }
    return provider.embed(texts);
  }
}
