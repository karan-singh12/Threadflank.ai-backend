import { ToolDefinition } from '../core/providers/provider.types';

export interface AgentToolContext {
  userId: string;
}

export interface AgentTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: AgentToolContext): Promise<unknown>;
}
