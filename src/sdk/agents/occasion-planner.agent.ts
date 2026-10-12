import { Injectable } from '@nestjs/common';
import { ModelRouter } from '../core/router/model-router';
import { PrismaService } from '../../prisma/prisma.service';
import { buildWardrobeTools } from '../tools/wardrobe.tools';
import { buildOccasionTools } from '../tools/occasion.tools';
import { AgentTool } from '../tools/tool.types';
import { occasionPlannerSystemPrompt, occasionPlannerUserPrompt, OccasionPromptInput } from '../prompts/occasion-planner.prompt';
import { ChatMessage } from '../core/providers/provider.types';
import { Retriever } from '../rag/retriever/retriever';
import { STYLE_GUIDE_NAMESPACE } from '../rag/knowledge/style-guide';
import { AppLogger } from '../../shared/logger/logger.service';

const MAX_TOOL_ROUNDS = 4;
const STYLE_TOP_K = 4;
// Measured on the style index: the right rule scores ~0.72, loosely related ones
// ~0.58–0.64. Keep matches above a floor AND close to the best one.
const STYLE_MIN_SCORE = 0.6;
const STYLE_MAX_GAP = 0.08;

export interface OccasionPlanResult {
  raw: string;
  outfits: unknown;
  /** Titles of the style-guide rules retrieved (RAG) and given to the agent. */
  styleGuide: string[];
}

interface StyleNote {
  title: string;
  text: string;
}

/**
 * Tool-calling agent example: reasons over the user's own wardrobe/looks
 * (via read-only tools) to answer the Occasion Planner brief (PRD §4.4).
 * Runs on the "agentic-reasoning" task type — the router selects Claude by
 * default for this task, with automatic fallback per ROUTER_CONFIG.
 * Before reasoning, it retrieves matching occasion / dress-code rules from the
 * style-guide RAG index so picks follow real etiquette, not model guesswork.
 */
@Injectable()
export class OccasionPlannerAgent {
  constructor(
    private readonly router: ModelRouter,
    private readonly prisma: PrismaService,
    private readonly retriever: Retriever,
    private readonly logger: AppLogger,
  ) {}

  async run(userId: string, input: OccasionPromptInput): Promise<OccasionPlanResult> {
    const tools: AgentTool[] = [...buildWardrobeTools(this.prisma), ...buildOccasionTools()];
    const toolsByName = new Map(tools.map((t) => [t.definition.name, t]));
    const styleNotes = await this.retrieveStyleNotes(input);

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          `${occasionPlannerSystemPrompt()}\n\nRespond ONLY with JSON of the shape ` +
          `{"outfits":[{"name":"","itemIds":[],"confidence":0,"why":"","missing":[{"item":"","searchQuery":"","estimatedPrice":0}]}],"reasoning":""} ` +
          `once you are done reasoning — no prose outside the JSON. "searchQuery" is a short shopping search (e.g. "gold embellished clutch") ` +
          `and "estimatedPrice" is in INR; keep the missing pieces within the budget when one is given.` +
          this.styleGuideBlock(styleNotes),
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

    return {
      raw: lastContent,
      outfits: this.tryParseJson(lastContent),
      styleGuide: styleNotes.map((n) => n.title),
    };
  }

  /** Best-effort RAG lookup: if Pinecone/embeddings are unavailable the planner
   * still runs, just without the style-guide grounding. */
  private async retrieveStyleNotes(input: OccasionPromptInput): Promise<StyleNote[]> {
    const query = [input.eventType, input.dressCode, input.location, input.notes].filter(Boolean).join('. ');
    try {
      const matches = await this.retriever.retrieve(query, STYLE_TOP_K, STYLE_GUIDE_NAMESPACE);
      const best = Math.max(0, ...matches.map((m) => m.score));
      return matches
        .filter((m) => m.score >= STYLE_MIN_SCORE && best - m.score <= STYLE_MAX_GAP && typeof m.metadata?.text === 'string')
        .map((m) => ({ title: String(m.metadata?.title ?? m.id), text: String(m.metadata?.text) }));
    } catch (error) {
      this.logger.warn('OccasionPlannerAgent', 'Style-guide retrieval skipped', { error: String(error) });
      return [];
    }
  }

  private styleGuideBlock(notes: StyleNote[]): string {
    if (notes.length === 0) return '';
    return (
      `\n\nThreadflank style guide — rules retrieved for this event. Treat them as authoritative for ` +
      `dress code, colours, fabrics and etiquette; skip wardrobe items that break them, and name the rule ` +
      `you followed in each outfit's "why". Ignore any rule that does not apply to this event.\n` +
      notes.map((n, i) => `[${i + 1}] ${n.text}`).join('\n')
    );
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
