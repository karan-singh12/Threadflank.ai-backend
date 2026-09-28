import { Module } from '@nestjs/common';
import { SdkService } from './sdk.service';
import { SdkController } from './sdk.controller';
import { ClientFactory } from './core/client-factory';
import { ModelRouter } from './core/router/model-router';
import { AiRequestLoggerService } from './logging/ai-request-logger.service';
import { CaptionGenerationChain } from './chains/caption-generation.chain';
import { OccasionPlannerAgent } from './agents/occasion-planner.agent';
import { WardrobeCombosAgent } from './agents/wardrobe-combos.agent';
import { VectorStoreClient } from './rag/store/vector-store.client';
import { EmbedPipeline } from './rag/ingestion/embed-pipeline';
import { Retriever } from './rag/retriever/retriever';
import { RagQueryService } from './rag/rag-query.service';
import { ConversationMemoryStore } from './memory/conversation-memory.store';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';
import { AuthModule } from '../auth/auth.module';
import { AppLogger } from '../shared/logger/logger.service';

const PROVIDERS = [
  ClientFactory,
  ModelRouter,
  AiRequestLoggerService,
  CaptionGenerationChain,
  OccasionPlannerAgent,
  WardrobeCombosAgent,
  VectorStoreClient,
  EmbedPipeline,
  Retriever,
  RagQueryService,
  ConversationMemoryStore,
  AppLogger,
  SdkService,
];

/** Public facade module for GenAI capability. Import this and inject SdkService —
 * nothing else in sdk/ is exported, so LangChain/provider details stay contained. */
@Module({
  imports: [PrismaModule, CacheModule, AuthModule],
  controllers: [SdkController],
  providers: PROVIDERS,
  exports: [SdkService],
})
export class SdkModule {}
