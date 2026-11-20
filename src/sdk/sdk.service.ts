import { Injectable } from '@nestjs/common';
import { CaptionGenerationChain } from './chains/caption-generation.chain';
import { BrandContentChain } from './chains/brand-content.chain';
import { BrandContentInput } from './prompts/brand-content.prompt';
import { OccasionPlannerAgent, OccasionPlanResult } from './agents/occasion-planner.agent';
import { TextToSqlAgent, SqlAnswer } from './agents/text-to-sql.agent';
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
    private readonly brandContentChain: BrandContentChain,
    private readonly occasionAgent: OccasionPlannerAgent,
    private readonly textToSqlAgent: TextToSqlAgent,
    private readonly combosAgent: WardrobeCombosAgent,
    private readonly ragQueryService: RagQueryService,
    private readonly embedPipeline: EmbedPipeline,
    private readonly clientFactory: ClientFactory,
    private readonly requestLogger: AiRequestLoggerService,
  ) {}

  generateCaption(input: CaptionPromptInput, opts: { override?: RouteOverride; requestedBy?: string } = {}): Promise<string> {
    return this.captionChain.run(input, opts);
  }

  /** Several editable copy options for a brand (descriptions, captions, announcements, email, SEO). */
  generateBrandContent(input: BrandContentInput, opts: { override?: RouteOverride; requestedBy?: string } = {}): Promise<string[]> {
    return this.brandContentChain.run(input, opts);
  }

  runOccasionPlanner(userId: string, input: OccasionPromptInput): Promise<OccasionPlanResult> {
    return this.occasionAgent.run(userId, input);
  }

  generateWardrobeCombos(userId: string, input: WardrobeCombosInput): Promise<{ combos: WardrobeCombo[] }> {
    return this.combosAgent.run(userId, input);
  }

  /**
   * A plain-English question about the catalog and the platform's own AI telemetry, answered by
   * generating SQL and running it read-only. The reachable tables are fixed in sql-schema.ts and
   * exclude everything personal, so this is safe to put behind an admin screen but must never be
   * widened to "ask anything about the database".
   */
  askPlatformData(question: string, opts: { requestedBy?: string } = {}): Promise<SqlAnswer> {
    return this.textToSqlAgent.run(question, opts);
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
