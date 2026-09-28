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
│   ├── auth/                # End-user auth (/user/auth)
│   ├── chat/                # Conversations, groups, messages, calls, Socket.io gateways
│   ├── common/              # Filters, interceptors, guards, decorators
│   ├── jobs/                # Cron processors + BullMQ queue
│   ├── modules/             # Feature modules (see below)
│   ├── sdk/                 # GenAI: providers, router, agents, chains, RAG, cost logging
│   └── shared/              # Audit log, logger, mailer, storage
└── docker-compose.yml       # Local PostgreSQL on :5433
```

**Feature modules** (`src/modules`):
* **Users & auth:** `users`, `admin-auth`, `admin-users`
* **Content & brands:** `posts`, `brands`, `brand-posts`, `brand-stories`, `cms`, `contact`, `email-templates`
* **Wardrobe & twins:** `wardrobe`, `looks`, `twin`, `twin-circle`, `events`, `stylists`, `share`
* **Studio & AI:** `studio-backgrounds`, `widget`, `ai-observability`
* **Platform & admin:** `uploads`, `notifications`, `admin`, `admin-ops`
* **Stubs:** `payments`, `rooms`

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
