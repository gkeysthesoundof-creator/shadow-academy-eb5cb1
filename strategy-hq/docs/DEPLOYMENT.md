# Deployment guide (not yet performed — requires owner approval)

Nothing in this repository has been deployed. These are the steps for when you approve hosting.
Recommended low-cost stack: **Supabase** (Postgres) + **Vercel** (Next.js hosting + cron). Both have free tiers;
check current pricing before you create accounts.

## 1. Database (Supabase)
1. Create a Supabase project (region near you). Copy the *session-mode* connection string.
2. Supabase already has the `anon`, `authenticated` and `service_role` roles — **skip** `db/bootstrap-local.sql`.
3. Run migrations from your machine or CI:
   ```bash
   DATABASE_URL='postgres://postgres:...@...supabase.com:5432/postgres' npm run db:migrate
   DATABASE_URL='...' npm run db:seed
   DATABASE_URL='...' FOUNDER_EMAIL='you@...' FOUNDER_PASSWORD='12+ chars' FOUNDER_NAME='Sir' npm run founder:create
   ```
4. Roll back one migration with `npm run db:down` (every migration has a `.down.sql`).

## 2. App hosting (Vercel)
1. Import the repository, set **Root Directory = `strategy-hq`**.
2. Add environment variables from `.env.example` in Vercel's encrypted settings (never in git).
3. Uploads: `UPLOAD_DIR` is local disk. Serverless hosts have ephemeral disks, so before relying on
   private screenshots/maps in production, switch the upload store to Supabase Storage (private bucket,
   signed URLs). The interface is isolated in `src/app/api/uploads` and `src/app/api/screenshots`.
4. Keep the deployment **private**: protect it with Vercel's deployment protection or keep the URL unpublished.
   Public registration is locked off in the database regardless.

## 3. Scheduler
`vercel.json` declares a cron hitting `/api/cron/tick` every 15 minutes. Vercel sends
`Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set in project settings.
The tick decides in America/New_York time whether to scan (~7:15) or brief (~8:30) — DST-safe.
Alternatives: Supabase `pg_cron` + `pg_net`, or a GitHub Actions schedule calling the same URL with the bearer token.
Check that your Vercel plan allows a 15-minute cron; if not, use GitHub Actions.

## 4. Email (Resend)
1. Create a Resend account, verify a sending domain you own.
2. Set `RESEND_API_KEY`, `REPORT_FROM_EMAIL` (on the verified domain), `REPORT_TO_EMAIL` (your inbox), `REPORT_ENABLED=true`.
3. In the app: Settings → Morning email → opt in. Admin → Feature flags → turn on `email_delivery`.
4. Use Brief → "Build today's brief now (dry run)" first and review the HTML preview.
Status words are kept separate: dry run / blocked / provider accepted / failed. "Delivered" needs provider webhooks (not built).

## 5. Optional integrations
- Coach AI: `ANTHROPIC_API_KEY` + admin flag `llm_assistant`. Capped by `LLM_DAILY_BUDGET_USD` and per-plan quotas.
- Reddit: create an app under Reddit's Data API terms, set the three `REDDIT_*` variables, turn on flag `reddit_ingestion`.
  Commercial use requires a separate agreement with Reddit before any paid launch.
- Billing: provider-neutral webhook at `/api/billing/webhook` (HMAC header `x-gsq-signature: t=<unix>,v1=<hex>`).
  Live billing is locked off; test mode is an admin flag.

## 6. CI
`.github/workflows/ci.yml` at the repository root runs typecheck, lint, unit + database tests (Postgres service) and the build.
