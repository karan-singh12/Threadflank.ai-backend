import { ToolDefinition, ToolCall } from './provider.types';

/** Converts our generic ToolDefinition into the OpenAI-function-call shape that every
 * LangChain chat model's bindTools() understands and normalizes internally. */
export function toBindableTools(tools: ToolDefinition[] | undefined) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Normalizes a LangChain AIMessage's `.tool_calls` array into our ToolCall shape. */
export function normalizeToolCalls(rawToolCalls: any[] | undefined): ToolCall[] | undefined {
  if (!rawToolCalls || rawToolCalls.length === 0) return undefined;
  return rawToolCalls.map((call, index) => ({
    id: call.id ?? `call_${index}`,
    name: call.name,
    arguments: call.args ?? {},
  }));
}

/** Normalizes an AIMessage's `.content`, which LangChain may return as a string or a
 * content-block array (some providers return multi-part content). */
export function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part?.text ?? '')))
      .join('');
  }
  return '';
}
