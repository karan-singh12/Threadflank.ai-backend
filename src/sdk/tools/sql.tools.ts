import { TextToSqlAgent } from '../agents/text-to-sql.agent';
import { AgentTool } from './tool.types';

/**
 * The text-to-SQL agent as a tool another agent can call.
 *
 * It answers questions about the catalog and the platform's own AI telemetry — never about a
 * person — so it is safe to hand to an agent that is already reasoning on a user's behalf: the
 * boundary is in the SQL path, not in who is asking.
 */
export function buildSqlTools(agent: TextToSqlAgent): AgentTool[] {
  return [
    {
      definition: {
        name: 'query_platform_data',
        description:
          'Answer a question about brands, their catalog, drops, engagement counters, AI renders or try-on eval scores by running a read-only SQL query. Use for counts, averages, rankings and date ranges. Cannot see users, messages, wardrobes or payments.',
        parameters: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The question in plain English, e.g. "average price of published products per category".',
            },
          },
          required: ['question'],
        },
      },
      execute: async (args, ctx) => {
        const question = String(args.question ?? '').trim();
        if (!question) return { error: 'A question is required.' };

        const answer = await agent.run(question, { requestedBy: ctx.userId });
        if (!answer.sql) return { error: answer.refusal ?? 'That question could not be answered from the available tables.' };
        return { sql: answer.sql, rowCount: answer.rowCount, rows: answer.rows };
      },
    },
  ];
}
