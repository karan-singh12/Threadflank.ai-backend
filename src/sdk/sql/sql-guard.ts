import { SQL_DEFAULT_LIMIT, SQL_MAX_LIMIT, isAllowedTable, isSensitiveColumn } from './sql-schema';

/**
 * The gate between a model's output and the database.
 *
 * It is a lexical guard, not a SQL parser: it refuses anything it does not positively recognise
 * as a single read, rather than trying to understand every query Postgres would accept. That is
 * the right bias here — a false refusal costs one eval point, a false pass costs the database.
 * The read-only transaction behind it is the second line, so neither has to be perfect alone.
 */

/** Flat rather than a discriminated union: this project compiles with strictNullChecks off, where
 *  narrowing by `ok` does not work and every caller would need a cast. */
export interface GuardResult {
  ok: boolean;
  /** When allowed: the exact statement to run, LIMIT included. */
  sql?: string;
  /** When refused: why, worded so it can be handed straight back to the model. */
  reason?: string;
}

/** Statement types that have no business in a read path, matched as whole words. */
const FORBIDDEN_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'truncate',
  'grant',
  'revoke',
  'copy',
  'merge',
  'call',
  'execute',
  'vacuum',
  'refresh',
  'reindex',
  'listen',
  'notify',
  'lock',
  'commit',
  'rollback',
  'begin',
  'savepoint',
  'set',
  'reset',
  'do',
  'prepare',
  'declare',
  'fetch',
  'into',
];

/** Functions and schemas that read the server itself rather than the data. */
const FORBIDDEN_IDENTIFIERS = [
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'pg_sleep',
  'pg_stat_file',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'lo_import',
  'lo_export',
  'dblink',
  'current_setting',
  'set_config',
  'information_schema',
  'pg_catalog',
  'pg_class',
  'pg_tables',
  'pg_user',
  'pg_shadow',
  'pg_authid',
];

const word = (w: string) => new RegExp(`(^|[^\\w"])${w}(?![\\w"])`, 'i');

/** `FROM "X"`, `JOIN "X"` — the places a table name can enter a read. */
const TABLE_REF = /\b(?:from|join)\s+("?)([A-Za-z_][A-Za-z0-9_]*)\1/gi;
/** `WITH x AS (`, `, x AS (` — names the query defines for itself and may then select from. */
const CTE_NAME = /(?:\bwith\s+(?:recursive\s+)?|,\s*)("?)([A-Za-z_][A-Za-z0-9_]*)\1\s+as\s*\(/gi;
const QUOTED_IDENT = /"([A-Za-z_][A-Za-z0-9_]*)"/g;
/** A LIMIT that belongs to the statement, not one buried in a subquery's text. */
const LIMIT_CLAUSE = /\blimit\s+(\d+)\s*$/i;

/**
 * Checks one generated statement and returns the exact SQL to run — a LIMIT is appended when the
 * model left it out, which is the one rewrite this does. Anything else is refused with a reason
 * the agent can show the model on its retry.
 */
export function guardSql(raw: string): GuardResult {
  const sql = raw.trim().replace(/;\s*$/, '').trim();

  if (!sql) return { ok: false, reason: 'Empty query.' };
  if (sql.includes(';')) return { ok: false, reason: 'Only one statement is allowed; remove the semicolon.' };
  if (sql.includes('--') || sql.includes('/*')) return { ok: false, reason: 'Comments are not allowed in the query.' };

  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, reason: 'The query must start with SELECT or WITH.' };
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    // `with x as (select ...)` is a read; the forbidden list targets the statement verbs.
    if (word(keyword).test(sql)) {
      return { ok: false, reason: `"${keyword.toUpperCase()}" is not allowed — this path may only read.` };
    }
  }

  const lowered = sql.toLowerCase();
  for (const ident of FORBIDDEN_IDENTIFIERS) {
    if (lowered.includes(ident)) {
      return { ok: false, reason: `"${ident}" is not available here.` };
    }
  }

  // Names the query defines itself are legitimate targets for a later FROM.
  const cteNames = new Set<string>();
  for (const match of sql.matchAll(CTE_NAME)) cteNames.add(match[2]);

  const tables = [...sql.matchAll(TABLE_REF)].map((m) => m[2]);
  if (tables.length === 0) {
    return { ok: false, reason: 'The query reads no table.' };
  }
  for (const table of tables) {
    if (cteNames.has(table)) continue;
    if (!isAllowedTable(table)) {
      return { ok: false, reason: `Table "${table}" is outside the allowed set.` };
    }
  }

  for (const match of sql.matchAll(QUOTED_IDENT)) {
    const ident = match[1];
    if (isAllowedTable(ident) || cteNames.has(ident)) continue;
    if (isSensitiveColumn(ident)) {
      return { ok: false, reason: `Column "${ident}" is not readable through this path.` };
    }
  }

  const limit = sql.match(LIMIT_CLAUSE);
  if (!limit) {
    return { ok: true, sql: `${sql} LIMIT ${SQL_DEFAULT_LIMIT}` };
  }
  if (Number(limit[1]) > SQL_MAX_LIMIT) {
    return { ok: false, reason: `LIMIT ${limit[1]} is above the maximum of ${SQL_MAX_LIMIT}.` };
  }
  return { ok: true, sql };
}

/** Pulls the statement out of the model's reply, whether or not it fenced it. */
export function extractSql(reply: string): string {
  const fenced = reply.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : reply).trim();
  return body.replace(/^sql\s*\n/i, '').trim();
}
