/** Provider-agnostic message/response shapes. No LangChain or vendor types leak past this file. */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-schema-shaped parameter description (zod schemas are converted internally per-provider). */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface UsageInfo {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface GenerateRequest {
  messages: ChatMessage[];
  model: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: UsageInfo;
  provider: string;
  model: string;
}

export interface GenerateChunk {
  contentDelta: string;
  done: boolean;
}
