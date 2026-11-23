# Threadflank API (NestJS)

The backend for Threadflank: user and admin auth, social and real-time chat, wardrobe and looks, twins and the Twin Circle, events, stylists, brand feed, share cards, the brand try-on widget, and the GenAI layer. Built with **NestJS 11 on Fastify**, **Prisma 7 + PostgreSQL**, **Redis** and **Socket.io**.

Project docs live in [`../documentation`](../documentation): start with [`trd.md`](../documentation/trd.md) for architecture and APIs, and [`progress_checklist.md`](../documentation/progress_checklist.md) for build status.

---

## 🏗️ Architecture Overview

```mermaid
graph TD
    Web[User app / Admin app] -->|REST /api| Fastify[Fastify HTTP server]
    Web -->|WebSockets| SocketIO[Socket.io gateways]

    subgraph NestJS
        Fastify --> Guards[Guards · throttler · validation]
        Guards --> Controllers --> Services
        Services --> Prisma[Prisma ORM]
        Services --> SDK[GenAI SDK · ModelRouter]
        SocketIO --> WSAdapter[Redis Socket.io adapter]
        Cron[Cron + BullMQ] --> Jobs[Background jobs]
    end

    Prisma --> DB[(PostgreSQL)]
    WSAdapter --> Redis[(Redis)]
    Guards --> Redis
    SDK --> LLM[Gemini · Groq · OpenRouter · Claude · OpenAI]
```

---

## 🛠️ Technology Stack

| Component | Technology |
| :--- | :--- |
| Framework | NestJS 11 on Fastify |
| Database | PostgreSQL 17 via Prisma 7 (`pg` driver adapter) |
| Real-time | Socket.io with Redis adapter |
| Cache, rate limits, queues | Redis (ioredis), `@nestjs/throttler`, BullMQ, `@nestjs/schedule` |
| Auth | JWT (users and admins, admin refresh tokens), bcryptjs |
| Validation | class-validator / class-transformer |
| GenAI | LangChain chat models, Pinecone (optional RAG) |
| Email | Nodemailer |
| API docs | Swagger at `/api/docs` |

---

## 📂 Directory Structure

```text
backend/
├── prisma/
│   ├── schema.prisma        # All models
│   └── seed*.ts             # Super admin, discover feed, demo users
├── public/                  # Uploaded files, served at /public/*
├── src/
│   ├── main.ts              # Fastify bootstrap, /api prefix, Swagger, CORS
│   ├── app.module.ts        # Throttler, schedule, feature modules
│   ├── common/              # Filters, interceptors, guards, decorators
│   ├── jobs/                # Cron processors + BullMQ queue
│   ├── modules/             # Feature modules, grouped by panel (see below)
│   ├── sdk/                 # GenAI: providers, router, agents, chains, RAG, cost logging
│   └── shared/              # Audit log, logger, mailer, storage
└── docker-compose.yml       # Local PostgreSQL on :5433
```

**Feature modules** (`src/modules`), one folder per panel. Grouping does not change any route:
* **`User-panel/`**: shopper app APIs and public/embed routes. `auth` (`/user/auth`), `chat` (conversations, calls, Socket.io), `users`, `posts`, `wardrobe`, `looks`, `twin`, `twin-circle`, `drape`, `events`, `stylists`, `share`, `notifications`, `uploads`, `payments` (`/billing`), `rooms`, plus the public read controllers for `brands`, `brand-posts`, `brand-stories`, `cms`, `contact`, `studio-backgrounds`, `widget` and the AI usage ingest (`/ai/usage`).
* **`Admin-panel/`**: staff APIs under `/admin-panel/*` and `/admin/*`. `admin-auth`, `admin-users`, `admin`, `admin-ops`, `security-observability`, `email-templates`, `brands`, `brand-posts`, `brand-stories`, `cms`, `contact`, `studio-backgrounds`, `widget`, `ai-observability`, plus the admin controllers for `stylists`, `share` and `payments`.
* **`Brand-panel/`**: brand portal APIs under `/brand/*`. `auth`, `profile`, `catalog`, `analytics`, `ai-studio`, `drops`, `bidding`, `upload`.
  * `ai-studio/` is the brand's own generative code and shares nothing with the shopper's Drape beyond the engine adapters in `shared/image-provider`: `brand-ai-studio.service.ts` (written copy), `brand-video.service.ts` and `brand-reel.service.ts` (motion), and **`ai-studio/model/`** (model shoots). Reviewing brand AI work means reading that one folder — nothing in `User-panel/drape` or `User-panel/twin` affects it.

A module's service and Nest module file live in the panel that owns the data. Its controllers sit in the panel whose users call them.

---

## 🚀 Core Features

1. **Users & presence** — JWT auth, profiles, friends with suggestions, online/last-seen presence.
2. **Real-time chat** — 1:1 and groups, receipts, reactions, edits, attachments, search; WebRTC call signalling and live broadcasts.
3. **Wardrobe OS** — items, wear logs, cost-per-wear analytics, similar-item lookup, saved looks with poses and video.
4. **Twin & Twin Circle** — persistent twin profile; a circle of up to 5 managed profiles or friends; borrow/swap requests.
5. **Events & GRWM** — circle events, per-member outfit plans with clash warnings, AI suggestions, event-scoped group chat.
6. **Stylists** — applications, admin verification, review queue and comments on looks.
7. **Brand feed** — brands, posts (scheduled publishing, AI captions, product variants with stock), stories.
8. **Share cards** — short-link tokens, open tracking, admin stats.
9. **Brand widget** — per-brand key and allowed domains, session metering.
10. **GenAI** — see below.
11. **Admin & ops** — admin roles, audit log, user/chat/traffic reports, community moderation, AI observability.
12. **Background jobs** — scheduled brand posts (every minute), story clean-up and log clean-up (daily).

### GenAI providers (`src/sdk`)
* Text AI (occasion planner, wardrobe combos, captions, RAG) goes through one `ModelRouter` over five providers: **Gemini, Groq, OpenRouter, Anthropic Claude and OpenAI**.
* Each task has a provider (`AGENT_TASK_PROVIDER`, `CAPTION_TASK_PROVIDER`, …) and every provider has a model (`GEMINI_MODEL`, `GROQ_MODEL`, `CLAUDE_MODEL`, …). See `.env.example`.
* Providers without an API key are skipped. A failing provider hands the task to the next one in `LLM_FALLBACK_CHAIN`. The occasion planner is routed to Claude and runs on the fallback chain until `ANTHROPIC_API_KEY` is set.
* Every call (and every failed attempt) is logged to `AiRequestLog` with tokens and an estimated cost; the admin panel's AI page reads it.
* Drape's image work (try-on, twin, poses, makeup) runs in the web app (`frontend/src/lib/server/image-engine.ts`) on Replicate, Gemini, OpenAI or OpenRouter, whichever has a key and credits. Each run is reported here (`POST /api/ai/usage`).

### Brand AI Studio — model shoots (`src/modules/Brand-panel/ai-studio/model`)

A brand sends a flat garment photo and picks a model, a pose, a backdrop and a framing; the piece
comes back worn. Routes are under `/brand/ai-studio/model/*` (`presets`, `status`, `shoots`).

* The cast lives in `model-presets.ts` and `buildShootPrompt` (`model-prompt.ts`) turns a chosen set-up
  into the engine's instruction. A brand picks from the cast, it never writes the prompt, so every
  word sent to the engine is one we wrote. The prompt's first rule is garment fidelity: the piece
  must come back the colour, cut and print it went in as, because this photo goes on a product page.
* A render answers in one call, so there is no job to poll: credits are taken, the engine is asked,
  and either a `BrandModelShot` row is written or the credits are returned with the reason. It needs
  an engine that reads a reference image, so it asks for Gemini specifically.
* Preview photos for the panel's model and pose tiles are rendered once and committed as static
  files: `npm run studio:previews` (needs `GEMINI_API_KEY` with image quota, plus `sharp`). They land
  in `Brand-panel/public/ai-studio/models/`, which is where the presets' `previewUrl`s point.

### Text-to-SQL (`src/sdk/sql`, `src/sdk/agents/text-to-sql.agent.ts`)
A plain-English question is turned into one PostgreSQL `SELECT` and answered from the real database. The model is the least trusted part of the path, so nothing it writes reaches data directly:

1. **Allow-list** (`sql-schema.ts`) — only brand catalog, engagement counters and AI telemetry (17 tables). Users, messages, wardrobes, payments and tokens are outside it, and columns matching `email`, `phone`, `gstin`, `*AdminId`, `userId`, `requestedBy`, … are refused even inside an allowed table.
2. **Guard** (`sql-guard.ts`) — a lexical gate that refuses anything it does not positively recognise as a single read: multiple statements, comments, any write verb, `pg_*`/`information_schema`, a table outside the list, a `LIMIT` above 200. A missing `LIMIT` is the one thing it rewrites rather than refuses. Covered by `sql-guard.spec.ts`, which runs on every `npm test` with no database or model needed.
3. **Read-only transaction** (`readonly-db.service.ts`) — the statement runs inside `BEGIN TRANSACTION READ ONLY` with a 5s `statement_timeout`, on a pool of 2 connections, and is always rolled back. Set `READONLY_DATABASE_URL` to a role that only has `SELECT` on the allow-listed tables and the boundary is enforced by Postgres itself; without it the path still cannot write, but a guard bug could read more than it should, so production should always set it.

A refused or failed query is handed back to the model once with the reason — most failures are a quoted-identifier slip it fixes immediately — and after that the question goes unanswered rather than half-answered.

Exposed as `SdkService.askPlatformData()`, as the `query_platform_data` agent tool, and over HTTP at `POST /api/admin-panel/ai/ask-data` (admin-guarded, since the data spans every brand).

**Accuracy** is measured by execution: `evals/sql-30.json` holds 30 questions with hand-written reference SQL, and a question counts only when the agent's rows match the reference's rows.

```bash
npm run eval:sql                          # prints X/30 and writes evals/last-run.json
npm run eval:sql -- --provider groq       # pin the model being scored
npm run eval:sql -- --only 4,17
```

Last run: **29/30 (96.7%)** on `groq/openai/gpt-oss-120b`, median 2.6s per question, no retries needed. The one miss answers `UNANSWERABLE` for a table that was in its own prompt. A score belongs to a model and to the data it ran against, so quote it with both — `evals/last-run.json` records them.

The harness sets `AI_REQUEST_LOG=off`, because four of the questions ask about `AiRequestLog` and every question makes an LLM call that would otherwise be written to it. Never set that variable in production.

### Rate limiting
* One global throttler: 100 requests/min per route per IP.
* Auth controllers are limited to 10/min and uploads to 20/min via `@Throttle({ default: … })`.
* Throttled requests return 429. Don't register extra named throttlers in `app.module.ts` — every named throttler applies to every route.

---

## ⚙️ Setup & Installation

### Prerequisites
* Node.js 20+
* Docker (for the local PostgreSQL) or your own PostgreSQL
* Redis (optional in development; needed for BullMQ jobs and multi-instance sockets)

### 1. Environment
Copy the variables from `.env.example` into `.env` and fill in at least:

```env
API_PORT=3003
DATABASE_URL="postgresql://outfit:outfit_dev@127.0.0.1:5433/outfit_checker"
DIRECT_URL="postgresql://outfit:outfit_dev@127.0.0.1:5433/outfit_checker"
# Required: without these, tokens are signed with hard-coded defaults and can be forged
JWT_SECRET="…"
ADMIN_JWT_SECRET="…"
ADMIN_JWT_REFRESH_SECRET="…"
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
# At least one LLM key, e.g.
GEMINI_API_KEY="…"
```

### 2. Install, create the database and seed
```bash
npm install              # also runs prisma generate
npm run db:up            # PostgreSQL 17 in Docker on :5433
npx prisma db push       # apply the schema
npm run seed:all         # super admin, discover feed, demo users (password Demo@1234)
```

`npm run db:reset` wipes the database, re-applies the schema and re-seeds. `npm run rag:ingest` loads published CMS content into the Pinecone RAG index (needs `PINECONE_API_KEY`).

### 3. Run
```bash
npm run start:dev        # watch mode on :3003 — Swagger at http://localhost:3003/api/docs
npm run build && npm run start:prod
```

### 4. Test
```bash
npm test                 # Jest (model router, services)
```

A `Dockerfile` builds a production image (Node 20 + Prisma).
