/**
 * What the text-to-SQL agent is allowed to see.
 *
 * The boundary is deliberately narrow: brand-side catalog, engagement counters and AI
 * telemetry. Anything that identifies a person (users, messages, friendships, wardrobes,
 * payments, tokens) is outside it, so a wrong — or adversarial — question cannot reach
 * personal data however convincing the prompt is.
 */

/** Tables the agent may read. A query naming anything else is refused before it reaches the database. */
export const SQL_TABLE_ALLOWLIST = [
  'Brand',
  'BrandProduct',
  'BrandProductVariant',
  'BrandProductLike',
  'BrandFollow',
  'BrandPost',
  'BrandPostLike',
  'BrandDrop',
  'BrandEvent',
  'BrandVideo',
  'BrandReel',
  'BrandReelShot',
  'DiscoverCategory',
  'CreditPack',
  'AiRequestLog',
  'TryOnEval',
  'StudioBackground',
] as const;

export type AllowedTable = (typeof SQL_TABLE_ALLOWLIST)[number];

/**
 * Columns refused even inside an allowed table: credentials, contact details, the brand's tax
 * number, and the id columns that would let rows be tied back to one person. Aggregate questions
 * about *people* are therefore out of scope by design — that is the trade for a boundary that is
 * simple enough to state in one sentence.
 */
export const SENSITIVE_COLUMN_PATTERNS: RegExp[] = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_]?key/i,
  /widget[_]?key/i,
  /\botp\b/i,
  /email/i,
  /phone/i,
  /gstin/i,
  /\bip\b|ipaddress/i,
  /^userid$/i,
  /^requestedby$/i,
  /adminid$/i,
];

/** Rows a single answer may carry back, and what is used when the model writes no LIMIT of its own. */
export const SQL_DEFAULT_LIMIT = 50;
export const SQL_MAX_LIMIT = 200;
/** A question that cannot be answered in this long is a question the agent should not be asking. */
export const SQL_STATEMENT_TIMEOUT_MS = 5_000;

export function isSensitiveColumn(column: string): boolean {
  return SENSITIVE_COLUMN_PATTERNS.some((p) => p.test(column));
}

export function isAllowedTable(table: string): boolean {
  return (SQL_TABLE_ALLOWLIST as readonly string[]).includes(table);
}

export interface ColumnInfo {
  table: string;
  column: string;
  dataType: string;
}

/**
 * The schema the model is shown. It lists only what it is allowed to use, so a refused query is
 * usually a model mistake rather than a boundary the model never knew about.
 */
export function schemaPrompt(columns: ColumnInfo[]): string {
  const byTable = new Map<string, string[]>();
  for (const c of columns) {
    if (!isAllowedTable(c.table) || isSensitiveColumn(c.column)) continue;
    const list = byTable.get(c.table) ?? [];
    list.push(`${c.column} ${c.dataType}`);
    byTable.set(c.table, list);
  }

  const tables = [...byTable.entries()].map(([table, cols]) => `"${table}"(${cols.join(', ')})`);
  return tables.join('\n');
}

/** The rules the model is held to; the guard enforces every one of them again after generation. */
export function sqlSystemPrompt(schema: string): string {
  return [
    'You write PostgreSQL SELECT queries for a fashion marketplace, and nothing else.',
    '',
    'Schema (every table and column you may use):',
    schema,
    '',
    'Rules:',
    '1. One statement only, starting with SELECT or WITH. Never INSERT, UPDATE, DELETE, or any DDL.',
    '2. Table and column names are case-sensitive and must be double-quoted: "BrandProduct"."createdAt".',
    '3. Use only the tables and columns listed above. If the question needs anything else, answer with the single word: UNANSWERABLE.',
    `4. Always end with a LIMIT of ${SQL_MAX_LIMIT} or less. Aggregates still need one.`,
    '5. No comments, no semicolons, no CTE that writes.',
    '',
    'Reply with the SQL in a ```sql fenced block and nothing else.',
  ].join('\n');
}
