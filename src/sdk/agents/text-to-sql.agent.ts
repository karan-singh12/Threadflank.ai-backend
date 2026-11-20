import { Injectable } from '@nestjs/common';
import { ModelRouter } from '../core/router/model-router';
import { ChatMessage } from '../core/providers/provider.types';
import { RouteOverride } from '../core/router/router.types';
import { AppLogger } from '../../shared/logger/logger.service';
import { ReadOnlyDb } from '../sql/readonly-db.service';
import { extractSql, guardSql } from '../sql/sql-guard';
import { schemaPrompt, sqlSystemPrompt } from '../sql/sql-schema';

export interface SqlAnswer {
  question: string;
  /** The statement that actually ran, LIMIT included. Null when nothing was allowed to run. */
  sql: string | null;
  rows: Record<string, unknown>[];
  rowCount: number;
  /** How many times the model had to be asked; 1 means it was right first time. */
  attempts: number;
  /** Set when no query ran: the guard's reason, the database's error, or UNANSWERABLE. */
  refusal?: string;
  provider?: string;
  model?: string;
}

const MAX_ATTEMPTS = 2;

/**
 * Natural language in, read-only rows out.
 *
 * The model is the least trusted part of this: everything it writes goes through the lexical
 * guard and then a read-only transaction before it reaches data. When either refuses, the reason
 * is handed back to the model once — most failures are a quoted-identifier slip it fixes
 * immediately — and after that the question is simply unanswered. A wrong answer here would be
 * worse than none, so there is no "best effort" path.
 */
@Injectable()
export class TextToSqlAgent {
  constructor(
    private readonly router: ModelRouter,
    private readonly db: ReadOnlyDb,
    private readonly logger: AppLogger,
  ) {}

  async run(question: string, opts: { requestedBy?: string; override?: RouteOverride } = {}): Promise<SqlAnswer> {
    const schema = schemaPrompt(await this.db.columns());
    const messages: ChatMessage[] = [
      { role: 'system', content: sqlSystemPrompt(schema) },
      { role: 'user', content: question },
    ];

    let refusal = 'The model did not produce a query.';
    let provider: string | undefined;
    let model: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await this.router.execute({
        taskType: 'agentic-reasoning',
        messages,
        // A data question has one right answer; sampling only invents column names.
        temperature: 0,
        requestedBy: opts.requestedBy,
        override: opts.override,
      });
      provider = response.provider;
      model = response.model;

      const candidate = extractSql(response.content);
      if (/^unanswerable$/i.test(candidate)) {
        return { question, sql: null, rows: [], rowCount: 0, attempts: attempt, refusal: 'Outside the available tables.', provider, model };
      }

      const guarded = guardSql(candidate);
      if (!guarded.ok) {
        refusal = guarded.reason;
        this.logger.warn('text-to-sql', 'Query refused by the guard', { reason: guarded.reason });
        messages.push({ role: 'assistant', content: candidate });
        messages.push({ role: 'user', content: `That query was refused: ${guarded.reason} Rewrite it within the rules.` });
        continue;
      }

      try {
        const { rows, rowCount } = await this.db.run(guarded.sql);
        return { question, sql: guarded.sql, rows, rowCount, attempts: attempt, provider, model };
      } catch (err: any) {
        refusal = err?.message ?? 'The database refused the query.';
        this.logger.warn('text-to-sql', 'Postgres rejected the query', { reason: refusal });
        messages.push({ role: 'assistant', content: guarded.sql });
        messages.push({ role: 'user', content: `Postgres rejected that query: ${refusal} Rewrite it.` });
      }
    }

    return { question, sql: null, rows: [], rowCount: 0, attempts: MAX_ATTEMPTS, refusal, provider, model };
  }
}
