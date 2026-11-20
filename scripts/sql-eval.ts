/**
 * Execution-accuracy harness for the text-to-SQL agent.
 *
 *   npm run eval:sql            # all 30 questions
 *   npm run eval:sql -- --only 4,17
 *
 * A question counts only when the agent's rows match a hand-written reference query's rows. The
 * reference is trusted and runs on the same read-only connection without passing the guard, so
 * what is measured is the agent. The score moves with the data in the database, so a number
 * quoted anywhere should name the run it came from — `evals/last-run.json` records it.
 */
import * as dotenv from 'dotenv';
dotenv.config();

// Four of the questions ask about AiRequestLog, and every question makes an LLM call that would
// otherwise be written to it — a run would score itself against data it had just changed.
process.env.AI_REQUEST_LOG = 'off';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { SdkModule } from '../src/sdk/sdk.module';
import { TextToSqlAgent } from '../src/sdk/agents/text-to-sql.agent';
import { ReadOnlyDb } from '../src/sdk/sql/readonly-db.service';

interface EvalQuestion {
  id: number;
  question: string;
  referenceSql: string;
}

const EVAL_PATH = path.join(process.cwd(), 'evals', 'sql-30.json');
const REPORT_PATH = path.join(process.cwd(), 'evals', 'last-run.json');

/**
 * Rows compared as values, not as column names: an answer that labels a count "n" instead of
 * "total" is right, one that returns a different number is not. Row order is ignored unless the
 * question asked for an order, which the reference query then also applies.
 */
function normaliseRows(rows: Record<string, unknown>[]): string {
  const normalised = rows.map((row) =>
    Object.values(row)
      .map((value) => {
        if (value === null || value === undefined) return '∅';
        if (value instanceof Date) return value.toISOString();
        const asNumber = typeof value === 'number' ? value : Number(value);
        if (typeof value !== 'boolean' && String(value).trim() !== '' && Number.isFinite(asNumber)) {
          return String(Math.round(asNumber * 10_000) / 10_000);
        }
        return String(value);
      })
      .sort()
      .join('|'),
  );
  return JSON.stringify(normalised.sort());
}

async function main() {
  Logger.overrideLogger(['error']);

  const flag = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : undefined;
  };

  const onlyArg = flag('only');
  const only = onlyArg ? new Set(onlyArg.split(',').map((n) => Number(n.trim()))) : null;
  // A score belongs to a model, so the run can pin one instead of taking whatever the router picks.
  const provider = flag('provider');
  const override = provider ? ({ provider, model: flag('model') } as any) : undefined;

  const file = JSON.parse(fs.readFileSync(EVAL_PATH, 'utf8')) as { questions: EvalQuestion[] };
  const questions = only ? file.questions.filter((q) => only.has(q.id)) : file.questions;

  const app = await NestFactory.createApplicationContext(SdkModule, { logger: ['error'] });
  const agent = app.get(TextToSqlAgent);
  const db = app.get(ReadOnlyDb);

  if (!db.isolated) {
    console.warn('⚠  READONLY_DATABASE_URL is not set — running as the application role (still read-only).\n');
  }

  const results: {
    id: number;
    question: string;
    passed: boolean;
    attempts: number;
    ms: number;
    served?: string;
    sql: string | null;
    reason?: string;
  }[] = [];

  for (const q of questions) {
    let passed = false;
    let reason: string | undefined;
    let attempts = 0;
    let sql: string | null = null;
    let served: string | undefined;
    const startedAt = Date.now();

    try {
      const expected = await db.run(q.referenceSql);
      const answer = await agent.run(q.question, { override });
      attempts = answer.attempts;
      sql = answer.sql;
      served = answer.provider ? `${answer.provider}/${answer.model}` : undefined;

      if (!answer.sql) {
        reason = answer.refusal;
      } else {
        passed = normaliseRows(answer.rows) === normaliseRows(expected.rows);
        if (!passed) reason = `expected ${expected.rows.length} row(s), got ${answer.rows.length} with different values`;
      }
    } catch (err: any) {
      reason = `harness error: ${err?.message ?? err}`;
    }

    const ms = Date.now() - startedAt;
    results.push({ id: q.id, question: q.question, passed, attempts, ms, served, sql, reason });
    const mark = passed ? '✓' : '✗';
    console.log(`${mark} ${String(q.id).padStart(2)}. ${q.question}  [${(ms / 1000).toFixed(1)}s${served ? `, ${served}` : ''}]`);
    if (!passed && reason) console.log(`     ${reason}`);
  }

  const score = results.filter((r) => r.passed).length;
  const firstTry = results.filter((r) => r.passed && r.attempts === 1).length;
  const pct = Math.round((score / results.length) * 1000) / 10;

  console.log(`\nExecution accuracy: ${score}/${results.length} (${pct}%)`);
  const totalMs = results.reduce((n, r) => n + r.ms, 0);
  const retried = results.filter((r) => r.attempts > 1).length;
  console.log(`Needed a retry:     ${retried}/${results.length} — a refusal reason fed back to the model once.`);
  console.log(`Median question:    ${(results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)] / 1000).toFixed(1)}s (total ${(totalMs / 1000).toFixed(0)}s)`);

  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify({ ranAt: new Date().toISOString(), override: override ?? 'router default', score, total: results.length, pct, firstTry, results }, null, 2),
  );
  console.log(`Report written to ${REPORT_PATH}`);

  await app.close().catch(() => undefined); // Redis may never have connected; a noisy shutdown is not a failed run
  process.exit(score === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
