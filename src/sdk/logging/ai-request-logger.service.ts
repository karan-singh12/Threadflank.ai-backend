import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogger } from '../../shared/logger/logger.service';
import { UsageInfo } from '../core/providers/provider.types';
import { estimateCostUsd } from './ai-cost';

export interface AiRequestLogInput {
  provider: string;
  model: string;
  taskType?: string;
  usage?: UsageInfo;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
  requestedBy?: string;
  outputUrl?: string;
  metadata?: Record<string, unknown>;
}

/** Persists AiRequestLog rows so which provider/model served each request — and its
 * token usage and estimated cost — is visible for cost tracking and debugging. Never throws. */
@Injectable()
export class AiRequestLoggerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {}

  async log(input: AiRequestLogInput): Promise<void> {
    this.logger.info('AiRequestLogger', `${input.provider}/${input.model} (${input.taskType ?? 'n/a'})`, {
      success: input.success,
      latencyMs: input.latencyMs,
      totalTokens: input.usage?.totalTokens,
    });

    try {
      await this.prisma.aiRequestLog.create({
        data: {
          provider: input.provider,
          model: input.model,
          taskType: input.taskType ?? null,
          promptTokens: input.usage?.promptTokens ?? null,
          completionTokens: input.usage?.completionTokens ?? null,
          totalTokens: input.usage?.totalTokens ?? null,
          latencyMs: input.latencyMs,
          success: input.success,
          errorMessage: input.errorMessage?.slice(0, 1000) ?? null,
          requestedBy: input.requestedBy ?? null,
          // A failed call that never reached the model is not billed.
          costUsd: input.success ? estimateCostUsd(input.model, input.usage) : null,
          outputUrl: input.outputUrl ?? null,
          metadata: (input.metadata as any) ?? undefined,
        },
      });
    } catch (error) {
      this.logger.error('AiRequestLogger', 'Failed to persist AiRequestLog row', error);
    }
  }
}
