# GTA VI Strategy HQ — on the GameScout HQ platform

A private, chapter-aware strategy companion for GTA VI, built from day one as a
**multi-user, sellable platform** ("GameScout HQ" is a provisional working name —
clear trademark/domain before launch). Founder-only private alpha today.

> Independent, unofficial game guide. Not affiliated with, licensed or endorsed by
> Rockstar Games, Take-Two Interactive or Reddit. No Rockstar art, logos, screenshots
> or map files are bundled.

This folder lives inside the `shadow-academy` repository, but it is a separate app.
The kindergarten game at the repository root is untouched.

## What it is
- **Ten specialist scouts** (Vehicle Hunter, Weapons Scout, Cash Trail, Secrets, Mission Coach,
  Cartographer, Rockstar Free Rewards, Community Discovery, Verification & Corrections,
  Morning Brief & Ops). Each one is a lens plus a deterministic worker over **one shared evidence
  database**. They are not ten paid AI sessions running all day.
- **Evidence tiers are computed, never typed in**: verified / corroborated / single report /
  unverified / debunked / expired.
- **Spoiler shield enforced by the database** (Postgres row-level security), and checked again
  in code before anything is emailed.
- **Account isolation**: every private row is protected by RLS and tested with two accounts.
- **One morning brief per user per day**. It is archived in the app, and email stays off until
  you configure it.
- **Commercial scaffolding** is in place: FREE / PLUS / PRO plan labels (no prices), entitlements,
  usage meters, a daily AI cost ceiling, a provider-neutral billing webhook (staging only), a rights
  registry, admin moderation and an audit log.

## Run it locally
Needs Node 20+ and PostgreSQL 16.
```bash
cd strategy-hq
npm install
# one-time: create a database + owner role, then roles for RLS
createdb gsq   # or use docker: docker run -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:16
BOOTSTRAP_SUPERUSER_URL=postgres://postgres:<pw>@127.0.0.1:5432/gsq DATABASE_URL=postgres://gsq_owner:<pw>@127.0.0.1:5432/gsq npm run db:migrate
DATABASE_URL=... npm run db:seed
DATABASE_URL=... FOUNDER_EMAIL=you@example.com FOUNDER_PASSWORD='12+ characters' npm run founder:create
cp .env.example .env.local   # fill DATABASE_URL, CRON_SECRET
npm run dev                  # http://localhost:3100
```

## Tests
| Command | What it covers |
|---|---|
| `npm run typecheck`, `npm run lint` | TypeScript, ESLint |
| `npm test` | 105 unit + database tests: RLS isolation, chapter leaks, evidence tiers, rights gate, rewards rules, cash/hour UNKNOWN, DST scheduler, pipeline idempotency/dedupe, brief leak test, email gates, billing webhooks, moderation, uploads, import/export, assistant fallbacks |
| `npm run test:e2e` | 14 Playwright tests at iPhone 13 size (390×844) against the production build |
| `npm run screenshots` | Regenerates `docs/screenshots/` from the real app |

Database tests use `TEST_DATABASE_URL` (default `gsq_test`).

## Layout
```
db/migrations/        0001–0004 up/down SQL (schema, intel store, commerce, RLS)
src/lib/domain/       pure rules: scouts, evidence, spoilers, rights, rewards, money, schedule, plans, router
src/lib/repo/         data access (all user reads run as the user under RLS)
src/lib/workers/      source adapters, scout pipeline, briefing, scheduler tick
src/lib/email/        email HTML renderer + guarded delivery (Resend)
src/lib/assistant/    local retrieval + optional budget-capped Claude coach
src/lib/billing/      provider-neutral webhook adapter (staging)
src/app/(hq)/         Home, Scouts, Workbenches, Intel, Map, Playbook, Coach, Brief, Sources, Settings, Admin
src/app/api/          cron tick, billing webhook, uploads, screenshots, assist, export, health
docs/                 HANDOFF.md (status, coverage, costs, launch checklist), DEPLOYMENT.md, screenshots/
```

See **docs/HANDOFF.md** for what works, what needs credentials or rights, and the launch checklist.
