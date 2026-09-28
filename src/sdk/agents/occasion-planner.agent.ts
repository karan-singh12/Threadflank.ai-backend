import { Injectable } from '@nestjs/common';
import { ModelRouter } from '../core/router/model-router';
import { PrismaService } from '../../prisma/prisma.service';
import { buildWardrobeTools } from '../tools/wardrobe.tools';
import { buildOccasionTools } from '../tools/occasion.tools';
import { AgentTool } from '../tools/tool.types';
import { occasionPlannerSystemPrompt, occasionPlannerUserPrompt, OccasionPromptInput } from '../prompts/occasion-planner.prompt';
import { ChatMessage } from '../core/providers/provider.types';

const MAX_TOOL_ROUNDS = 4;

export interface OccasionPlanResult {
  raw: string;
  outfits: unknown;
}

/**
 * Tool-calling agent example: reasons over the user's own wardrobe/looks
 * (via read-only tools) to answer the Occasion Planner brief (PRD §4.4).
 * Runs on the "agentic-reasoning" task type — the router selects Claude by
 * default for this task, with automatic fallback per ROUTER_CONFIG.
 */
@Injectable()
export class OccasionPlannerAgent {
  constructor(
    private readonly router: ModelRouter,
    private readonly prisma: PrismaService,
  ) {}

  async run(userId: string, input: OccasionPromptInput): Promise<OccasionPlanResult> {
    const tools: AgentTool[] = [...buildWardrobeTools(this.prisma), ...buildOccasionTools()];
    const toolsByName = new Map(tools.map((t) => [t.definition.name, t]));

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          `${occasionPlannerSystemPrompt()}\n\nRespond ONLY with JSON of the shape ` +
          `{"outfits":[{"name":"","itemIds":[],"confidence":0,"why":"","missing":[{"item":"","searchQuery":"","estimatedPrice":0}]}],"reasoning":""} ` +
          `once you are done reasoning — no prose outside the JSON. "searchQuery" is a short shopping search (e.g. "gold embellished clutch") ` +
          `and "estimatedPrice" is in INR; keep the missing pieces within the budget when one is given.`,
      },
      { role: 'user', content: occasionPlannerUserPrompt(input) },
    ];

    let lastContent = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.router.execute({
        taskType: 'agentic-reasoning',
        messages,
        tools: tools.map((t) => t.definition),
        temperature: 0.4,
        requestedBy: userId,
      });

      lastContent = response.content;

      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      messages.push({ role: 'assistant', content: response.content || '(calling tools)' });

      for (const call of response.toolCalls) {
        const tool = toolsByName.get(call.name);
        const result = tool
          ? await tool.execute(call.arguments, { userId })
          : { error: `Unknown tool: ${call.name}` };

        messages.push({
          role: 'user',
          content: `Tool result for ${call.name}: ${JSON.stringify(result)}`,
        });
      }
    }

    return { raw: lastContent, outfits: this.tryParseJson(lastContent) };
  }

  private tryParseJson(content: string): unknown {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      return JSON.parse(match ? match[0] : content);
    } catch {
      return null;
    }
  }
}
