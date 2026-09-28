import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SdkService } from '../../sdk/sdk.service';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const USER_SUMMARY = { id: true, username: true, email: true, avatar: true } as const;

/** Providers the dashboard reports on, and the env var each needs to run. */
const PROVIDERS: { name: string; label: string; env?: string; kind: 'llm' | 'image' }[] = [
  { name: 'gemini', label: 'Google Gemini', env: 'GEMINI_API_KEY', kind: 'llm' },
  { name: 'claude', label: 'Anthropic Claude', env: 'ANTHROPIC_API_KEY', kind: 'llm' },
  { name: 'groq', label: 'Groq', env: 'GROQ_API_KEY', kind: 'llm' },
  { name: 'openrouter', label: 'OpenRouter', env: 'OPENROUTER_API_KEY', kind: 'llm' },
  { name: 'openai', label: 'OpenAI', env: 'OPENAI_API_KEY', kind: 'llm' },
  // Image engines run from the web app, so we only see the calls it reports. The web app
  // reads the same key names; the backend's copy is used as the "configured" hint.
  { name: 'replicate', label: 'Replicate (try-on, twin, video)', kind: 'image' },
  { name: 'gemini-image', label: 'Gemini image (try-on, edits)', env: 'GEMINI_API_KEY', kind: 'image' },
  { name: 'openai-image', label: 'OpenAI image (try-on, edits)', env: 'OPENAI_API_KEY', kind: 'image' },
  { name: 'openrouter-image', label: 'OpenRouter image (try-on, edits)', env: 'OPENROUTER_API_KEY', kind: 'image' },
];

/** Image engines the web app may name when it reports a run. */
const IMAGE_ENGINES = new Set(PROVIDERS.filter((p) => p.kind === 'image').map((p) => p.name));

export type ProviderStatus = 'operational' | 'degraded' | 'down' | 'idle' | 'not_configured';

export interface ExternalUsageInput {
  /** Image engine that served the run (replicate | gemini-image | openai-image | openrouter-image). */
  provider?: string;
  model: string;
  taskType: string;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
  outputUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface LogFilter {
  page?: number;
  limit?: number;
  status?: 'success' | 'failed';
  provider?: string;
  taskType?: string;
  model?: string;
  userId?: string;
  days?: number;
}

export interface EvalInput {
  aiRequestLogId?: string;
  imageUrl?: string;
  engine?: string;
  garmentKind?: string;
  drapeScore: number;
  fidelityScore: number;
  identityScore: number;
  overallScore: number;
  notes?: string;
}

const clampDays = (d: unknown, fallback = 30) => Math.min(365, Math.max(1, Number(d) || fallback));
const rate = (ok: number, total: number) => (total ? Math.round((ok / total) * 1000) / 10 : null);
const money = (n: number | null | undefined) => Math.round((n ?? 0) * 10000) / 10000;
const score = (v: unknown) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 5) throw new BadRequestException('Scores must be between 1 and 5');
  return n;
};

@Injectable()
export class AiObservabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sdk: SdkService,
  ) {}

  // ─── Ingest (web app reports its Replicate runs) ───────────────────────────

  async report(userId: string | null, input: ExternalUsageInput) {
    if (!input?.model || !input.taskType) throw new BadRequestException('model and taskType are required');
    await this.sdk.logExternalCall({
      provider: input.provider && IMAGE_ENGINES.has(input.provider) ? input.provider : 'replicate',
      model: String(input.model).slice(0, 120),
      taskType: String(input.taskType).slice(0, 40),
      latencyMs: Math.max(0, Math.round(Number(input.latencyMs) || 0)),
      success: Boolean(input.success),
      errorMessage: input.errorMessage ? String(input.errorMessage) : undefined,
      requestedBy: userId ?? undefined,
      outputUrl: input.outputUrl ? String(input.outputUrl).slice(0, 1000) : undefined,
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : undefined,
    });
    return { logged: true };
  }

  // ─── Aggregates ────────────────────────────────────────────────────────────

  private async summarise(where: Prisma.AiRequestLogWhereInput, since: Date, days: number) {
    const [totals, ok, byProvider, byModel, byTask, providerOk, taskOk] = await Promise.all([
      this.prisma.aiRequestLog.aggregate({
        where,
        _count: true,
        _sum: { totalTokens: true, promptTokens: true, completionTokens: true, costUsd: true },
        _avg: { latencyMs: true },
      }),
      this.prisma.aiRequestLog.count({ where: { ...where, success: true } }),
      this.prisma.aiRequestLog.groupBy({ by: ['provider'], where, _count: true, _sum: { costUsd: true, totalTokens: true }, _avg: { latencyMs: true } }),
      this.prisma.aiRequestLog.groupBy({ by: ['provider', 'model'], where, _count: true, _sum: { costUsd: true, totalTokens: true }, _avg: { latencyMs: true } }),
      this.prisma.aiRequestLog.groupBy({ by: ['taskType'], where, _count: true, _sum: { costUsd: true, totalTokens: true }, _avg: { latencyMs: true } }),
      this.prisma.aiRequestLog.groupBy({ by: ['provider'], where: { ...where, success: true }, _count: true }),
      this.prisma.aiRequestLog.groupBy({ by: ['taskType'], where: { ...where, success: true }, _count: true }),
    ]);

    const okByProvider = new Map(providerOk.map((p) => [p.provider, p._count]));
    const okByTask = new Map(taskOk.map((t) => [t.taskType, t._count]));

    // Daily series + p95 latency need SQL the Prisma builder can't express.
    const userFilter = where.requestedBy ? Prisma.sql`AND "requestedBy" = ${where.requestedBy as string}` : Prisma.empty;
    const daily = await this.prisma.$queryRaw<{ day: Date; requests: bigint; failed: bigint; tokens: bigint | null; cost: number | null }[]>`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*) AS requests,
             COUNT(*) FILTER (WHERE NOT success) AS failed,
             SUM("totalTokens") AS tokens,
             SUM("costUsd") AS cost
      FROM "AiRequestLog"
      WHERE "createdAt" >= ${since} ${userFilter}
      GROUP BY 1 ORDER BY 1`;
    const [latency] = await this.prisma.$queryRaw<{ p50: number | null; p95: number | null }[]>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95
      FROM "AiRequestLog"
      WHERE "createdAt" >= ${since} AND "latencyMs" IS NOT NULL ${userFilter}`;

    const series = new Map<string, { date: string; requests: number; failed: number; tokens: number; costUsd: number }>();
    for (let d = days - 1; d >= 0; d--) {
      const key = new Date(Date.now() - d * DAY_MS).toISOString().slice(0, 10);
      series.set(key, { date: key, requests: 0, failed: 0, tokens: 0, costUsd: 0 });
    }
    for (const row of daily) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      const s = series.get(key);
      if (s) {
        s.requests = Number(row.requests);
        s.failed = Number(row.failed);
        s.tokens = Number(row.tokens ?? 0);
        s.costUsd = money(row.cost);
      }
    }

    const total = totals._count;
    return {
      totals: {
        requests: total,
        succeeded: ok,
        failed: total - ok,
        successRate: rate(ok, total),
        promptTokens: totals._sum.promptTokens ?? 0,
        completionTokens: totals._sum.completionTokens ?? 0,
        totalTokens: totals._sum.totalTokens ?? 0,
        costUsd: money(totals._sum.costUsd),
        avgLatencyMs: totals._avg.latencyMs ? Math.round(totals._avg.latencyMs) : null,
        p50LatencyMs: latency?.p50 != null ? Math.round(latency.p50) : null,
        p95LatencyMs: latency?.p95 != null ? Math.round(latency.p95) : null,
      },
      byProvider: byProvider
        .map((p) => ({
          provider: p.provider,
          requests: p._count,
          successRate: rate(okByProvider.get(p.provider) ?? 0, p._count),
          tokens: p._sum.totalTokens ?? 0,
          costUsd: money(p._sum.costUsd),
          avgLatencyMs: p._avg.latencyMs ? Math.round(p._avg.latencyMs) : null,
        }))
        .sort((a, b) => b.requests - a.requests),
      byModel: byModel
        .map((m) => ({
          provider: m.provider,
          model: m.model,
          requests: m._count,
          tokens: m._sum.totalTokens ?? 0,
          costUsd: money(m._sum.costUsd),
          avgLatencyMs: m._avg.latencyMs ? Math.round(m._avg.latencyMs) : null,
        }))
        .sort((a, b) => b.requests - a.requests),
      byTask: byTask
        .map((t) => ({
          taskType: t.taskType ?? 'unknown',
          requests: t._count,
          successRate: rate(okByTask.get(t.taskType) ?? 0, t._count),
          tokens: t._sum.totalTokens ?? 0,
          costUsd: money(t._sum.costUsd),
          avgLatencyMs: t._avg.latencyMs ? Math.round(t._avg.latencyMs) : null,
        }))
        .sort((a, b) => b.requests - a.requests),
      daily: [...series.values()],
    };
  }

  async overview(daysInput?: unknown) {
    const days = clampDays(daysInput);
    const since = new Date(Date.now() - days * DAY_MS);
    const where: Prisma.AiRequestLogWhereInput = { createdAt: { gte: since } };
    const [summary, activeUsers, status] = await Promise.all([
      this.summarise(where, since, days),
      this.prisma.aiRequestLog.groupBy({ by: ['requestedBy'], where: { ...where, requestedBy: { not: null } }, _count: true }),
      this.status(),
    ]);
    return { days, ...summary, activeUsers: activeUsers.length, status };
  }

  /** Live health per provider, from the last 24h of calls. */
  async status() {
    const since = new Date(Date.now() - DAY_MS);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const providers = await Promise.all(
      PROVIDERS.map(async (p) => {
        const configured = p.env ? Boolean(process.env[p.env]) : true;
        const [day, dayOk, hour, hourOk, recent, lastOk, lastFail] = await Promise.all([
          this.prisma.aiRequestLog.count({ where: { provider: p.name, createdAt: { gte: since } } }),
          this.prisma.aiRequestLog.count({ where: { provider: p.name, createdAt: { gte: since }, success: true } }),
          this.prisma.aiRequestLog.count({ where: { provider: p.name, createdAt: { gte: hourAgo } } }),
          this.prisma.aiRequestLog.count({ where: { provider: p.name, createdAt: { gte: hourAgo }, success: true } }),
          this.prisma.aiRequestLog.findMany({ where: { provider: p.name }, orderBy: { createdAt: 'desc' }, take: 5, select: { success: true } }),
          this.prisma.aiRequestLog.findFirst({ where: { provider: p.name, success: true }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, latencyMs: true } }),
          this.prisma.aiRequestLog.findFirst({ where: { provider: p.name, success: false }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, errorMessage: true, model: true } }),
        ]);

        let status: ProviderStatus;
        const successRate24h = rate(dayOk, day);
        if (!configured) status = 'not_configured';
        else if (recent.length >= 3 && recent.every((r) => !r.success)) status = 'down';
        else if (day === 0) status = 'idle';
        else if ((successRate24h ?? 100) < 80) status = 'degraded';
        else status = 'operational';

        return {
          provider: p.name,
          label: p.label,
          kind: p.kind,
          configured,
          status,
          requests24h: day,
          successRate24h,
          requests1h: hour,
          successRate1h: rate(hourOk, hour),
          lastSuccessAt: lastOk?.createdAt ?? null,
          lastLatencyMs: lastOk?.latencyMs ?? null,
          lastFailure: lastFail ? { at: lastFail.createdAt, model: lastFail.model, message: lastFail.errorMessage } : null,
        };
      }),
    );

    const rank: Record<ProviderStatus, number> = { down: 4, degraded: 3, operational: 1, idle: 0, not_configured: 0 };
    const worst = providers.reduce((w, p) => (rank[p.status] > rank[w] ? p.status : w), 'operational' as ProviderStatus);
    const anyLive = providers.some((p) => p.status !== 'not_configured');
    return { overall: anyLive ? worst : ('not_configured' as ProviderStatus), checkedAt: new Date(), providers };
  }

  /** Per-user usage table: requests, failures, tokens, cost, last call. */
  async users(query: { days?: unknown; page?: unknown; limit?: unknown; search?: string; sort?: string }) {
    const days = clampDays(query.days);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const since = new Date(Date.now() - days * DAY_MS);

    const where: Prisma.AiRequestLogWhereInput = { createdAt: { gte: since }, requestedBy: { not: null } };
    if (query.search?.trim()) {
      const matches = await this.prisma.user.findMany({
        where: { OR: [{ email: { contains: query.search.trim(), mode: 'insensitive' } }, { username: { contains: query.search.trim(), mode: 'insensitive' } }] },
        select: { id: true },
        take: 200,
      });
      where.requestedBy = { in: matches.map((m) => m.id) };
    }

    const orderBy: Prisma.AiRequestLogOrderByWithAggregationInput =
      query.sort === 'cost' ? { _sum: { costUsd: 'desc' } } : query.sort === 'recent' ? { _max: { createdAt: 'desc' } } : { _count: { requestedBy: 'desc' } };

    type UserGroup = {
      requestedBy: string | null;
      _count: { requestedBy: number };
      _sum: { totalTokens: number | null; costUsd: number | null };
      _avg: { latencyMs: number | null };
      _max: { createdAt: Date | null };
    };
    // A runtime-chosen orderBy trips Prisma's compile-time groupBy check, so the args are built untyped.
    const groupArgs: any = {
      by: ['requestedBy'],
      where,
      _count: { requestedBy: true },
      _sum: { totalTokens: true, costUsd: true },
      _avg: { latencyMs: true },
      _max: { createdAt: true },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    };
    const [groups, allGroups] = await Promise.all([
      (this.prisma.aiRequestLog as any).groupBy(groupArgs) as Promise<UserGroup[]>,
      this.prisma.aiRequestLog.groupBy({ by: ['requestedBy'], where, _count: true }),
    ]);
    const ids = groups.map((g) => g.requestedBy!).filter(Boolean);
    const [users, failures] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: USER_SUMMARY }),
      this.prisma.aiRequestLog.groupBy({ by: ['requestedBy'], where: { ...where, requestedBy: { in: ids }, success: false }, _count: true }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const failById = new Map(failures.map((f) => [f.requestedBy, f._count]));

    return {
      data: groups.map((g) => {
        const requests = g._count.requestedBy;
        const failed = failById.get(g.requestedBy) ?? 0;
        return {
          userId: g.requestedBy,
          user: userById.get(g.requestedBy!) ?? null,
          requests,
          failed,
          successRate: rate(requests - failed, requests),
          tokens: g._sum.totalTokens ?? 0,
          costUsd: money(g._sum.costUsd),
          avgLatencyMs: g._avg.latencyMs ? Math.round(g._avg.latencyMs) : null,
          lastUsedAt: g._max.createdAt,
        };
      }),
      meta: buildPaginationMeta(allGroups.length, page, limit),
    };
  }

  /** One user's usage — used by the admin drill-down and the user's own profile. */
  async userDetail(userId: string, daysInput?: unknown) {
    const days = clampDays(daysInput);
    const since = new Date(Date.now() - days * DAY_MS);
    const where: Prisma.AiRequestLogWhereInput = { createdAt: { gte: since }, requestedBy: userId };
    const [user, summary, recent, allTime] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { ...USER_SUMMARY, createdAt: true } }),
      this.summarise(where, since, days),
      this.prisma.aiRequestLog.findMany({ where: { requestedBy: userId }, orderBy: { createdAt: 'desc' }, take: 25 }),
      this.prisma.aiRequestLog.aggregate({ where: { requestedBy: userId }, _count: true, _sum: { costUsd: true, totalTokens: true } }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    return {
      user,
      days,
      ...summary,
      allTime: { requests: allTime._count, tokens: allTime._sum.totalTokens ?? 0, costUsd: money(allTime._sum.costUsd) },
      recent,
    };
  }

  async logs(filter: LogFilter) {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 25));
    const where: Prisma.AiRequestLogWhereInput = {};
    if (filter.days) where.createdAt = { gte: new Date(Date.now() - clampDays(filter.days) * DAY_MS) };
    if (filter.status === 'success') where.success = true;
    if (filter.status === 'failed') where.success = false;
    if (filter.provider) where.provider = filter.provider;
    if (filter.taskType) where.taskType = filter.taskType;
    if (filter.model) where.model = { contains: filter.model, mode: 'insensitive' };
    if (filter.userId) where.requestedBy = filter.userId;

    const [rows, total] = await Promise.all([
      this.prisma.aiRequestLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.aiRequestLog.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.requestedBy).filter((id): id is string => Boolean(id)) } },
      select: USER_SUMMARY,
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    return { data: rows.map((r) => ({ ...r, user: r.requestedBy ? userById.get(r.requestedBy) ?? null : null })), meta: buildPaginationMeta(total, page, limit) };
  }

  /** Distinct values for the log filters. */
  async facets() {
    const [providers, tasks, models] = await Promise.all([
      this.prisma.aiRequestLog.findMany({ distinct: ['provider'], select: { provider: true } }),
      this.prisma.aiRequestLog.findMany({ distinct: ['taskType'], select: { taskType: true } }),
      this.prisma.aiRequestLog.findMany({ distinct: ['model'], select: { model: true }, take: 50 }),
    ]);
    return {
      providers: providers.map((p) => p.provider),
      taskTypes: tasks.map((t) => t.taskType).filter(Boolean),
      models: models.map((m) => m.model),
    };
  }

  // ─── Ethnic-wear eval harness ──────────────────────────────────────────────

  /** Recent try-on renders nobody has scored yet. */
  async evalCandidates(query: { page?: unknown; limit?: unknown; garmentKind?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 12));
    const where: Prisma.AiRequestLogWhereInput = { taskType: 'try-on', success: true, outputUrl: { not: null }, evals: { none: {} } };
    if (query.garmentKind) where.metadata = { path: ['garmentKind'], equals: query.garmentKind };
    const [rows, total] = await Promise.all([
      this.prisma.aiRequestLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.aiRequestLog.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async createEval(input: EvalInput, adminUserId: string) {
    let imageUrl = input.imageUrl;
    let engine = input.engine;
    let garmentKind = input.garmentKind;
    if (input.aiRequestLogId) {
      const log = await this.prisma.aiRequestLog.findUnique({ where: { id: input.aiRequestLogId } });
      if (!log) throw new NotFoundException('Render not found');
      const meta = (log.metadata ?? {}) as Record<string, unknown>;
      imageUrl = imageUrl || log.outputUrl || undefined;
      engine = engine || (meta.engine as string) || log.model;
      garmentKind = garmentKind || (meta.garmentKind as string) || 'unspecified';
    }
    if (!imageUrl || !engine || !garmentKind) throw new BadRequestException('imageUrl, engine and garmentKind are required');

    return this.prisma.tryOnEval.create({
      data: {
        aiRequestLogId: input.aiRequestLogId || null,
        imageUrl,
        engine: engine.slice(0, 60),
        garmentKind: garmentKind.slice(0, 40),
        drapeScore: score(input.drapeScore),
        fidelityScore: score(input.fidelityScore),
        identityScore: score(input.identityScore),
        overallScore: score(input.overallScore),
        notes: input.notes?.trim().slice(0, 1000) || null,
        reviewerAdminId: adminUserId,
      },
    });
  }

  async evalList(query: { page?: unknown; limit?: unknown }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const [rows, total] = await Promise.all([
      this.prisma.tryOnEval.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.tryOnEval.count(),
    ]);
    return { data: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  /** Average rubric scores per engine × garment kind, plus a weekly trend. */
  async evalSummary() {
    const groups = await this.prisma.tryOnEval.groupBy({
      by: ['engine', 'garmentKind'],
      _count: true,
      _avg: { drapeScore: true, fidelityScore: true, identityScore: true, overallScore: true },
    });
    const weekly = await this.prisma.$queryRaw<{ week: Date; engine: string; avg: number; n: bigint }[]>`
      SELECT date_trunc('week', "createdAt") AS week, engine, AVG("overallScore")::float AS avg, COUNT(*) AS n
      FROM "TryOnEval"
      WHERE "createdAt" >= ${new Date(Date.now() - 180 * DAY_MS)}
      GROUP BY 1, 2 ORDER BY 1`;
    const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
    return {
      groups: groups
        .map((g) => ({
          engine: g.engine,
          garmentKind: g.garmentKind,
          count: g._count,
          drape: r1(g._avg.drapeScore),
          fidelity: r1(g._avg.fidelityScore),
          identity: r1(g._avg.identityScore),
          overall: r1(g._avg.overallScore),
        }))
        .sort((a, b) => (a.overall ?? 0) - (b.overall ?? 0)),
      weekly: weekly.map((w) => ({ week: new Date(w.week).toISOString().slice(0, 10), engine: w.engine, overall: r1(w.avg), count: Number(w.n) })),
    };
  }
}
