# Hand-off — GTA VI Strategy HQ V2 (Nov 23, 2026)

**Deployment status: NOT DEPLOYED.** Everything below was built and tested in a private
development container (local Postgres 16, production Next.js build on localhost).
No paid service, public registration, billing or outgoing email was activated.

## 0. How the sections fill themselves (V2.1)
The scouts populate the app on their own; you do not enter or upload intel.
1. **Every 3 hours (6 AM–midnight ET)** one shared pass reads Rockstar's official pages, Reddit (official API) and GTA VI items from gaming news/guide feeds.
2. **A reader turns each post or guide article into cards.** With an Anthropic key, Claude Haiku reads the full text; without one, a cautious rules reader builds a card from the post title.
3. **Every fact is checked against the source text.** Payouts, locations, chapters and steps the source never stated are removed; an item the source never mentions is dropped.
4. **Same thing at the same place = one card.** Each new independent source adds evidence and raises the badge: single report → corroborated → verified (official).
5. **Cards publish immediately with honest badges.** Story spoilers of unknown chapter (and Reddit posts flagged as spoilers) stay hidden; GTA Online items never appear in GTA VI sections.
6. Only a short excerpt of each post is stored, plus the paraphrased card and a link back to the source.

Proven by a simulated morning (`tests/db/autopopulate.test.ts`): Vehicles, Weapons and Cash fill with no manual work; two posts about the same car merge into one corroborated card; an invented payout and an invented weapon are removed; spoiler, question and GTA Online posts stay out.
**Not yet proven against live data**, because this build machine cannot reach Rockstar, Reddit or the news sites. The first hosted run is the real test.

## 1. Verified working (tests executed)
| Area | Evidence |
|---|---|
| Multi-user accounts, owner/admin/moderator/customer roles, invite-only sign-in, founder account | e2e: deep links survive login, bad credentials refused, no `/signup`, customer blocked from `/admin`, open-redirect neutralised |
| Account isolation (RLS) | DB tests: second account cannot read/write/delete tasks, notes, pins, hunts, screenshots, cash, subscriptions, maps, digests |
| Chapter spoiler gate | DB tests: Chapter 1 never sees Chapter 5 in lists, detail, evidence, scout links, search, assistant, brief body/subject/preheader. The owner's own views are gated too (a leak found and fixed during testing) |
| Ten scouts, one evidence store | Scout Center + workbenches for Vehicles / Weapons / Cash (priority), Secrets, Missions, Rewards; per-scout run logs; honest states (PARTIAL / NOT CONFIGURED / STALE / FAILING / PREVIEW) |
| Evidence tiers, dedupe, corrections | Unit + DB: single report vs corroborated vs verified; same place + category = one record; patch → expired; debunk; moderation publish gate; change log |
| Cash Trail rules | World money vs income activities split; cash/hour shown only with evidenced payout AND time, else UNKNOWN |
| Rewards Radar | GTA Online never shown as GTA VI; GTA+ never "free"; purchase perks = "included with purchase"; deadline re-derived from dates |
| Map Room | Non-geographic planning board (no licensed map); private map import (PNG/JPEG/WEBP by magic bytes, 8 MB); private pins with plan caps; deep links `/map?finding=` / `?pin=` |
| Playbook | Tasks, notes, hunt list (saved/found/skipped), collected vehicles/weapons, manual earnings tracker, JSON/CSV export, validated import |
| Coach ("I'm stuck") | Local search over chapter-visible findings with citations; optional Claude path is gated by key + owner flag + daily $ ceiling + per-plan quota, and tested with a fake model only |
| Morning brief | One per user per local day (idempotent), stored archive with section anchors, email HTML preview, deep links with `from=brief` |
| Scheduler | `/api/cron/tick` (bearer secret): DST-safe America/New_York scan 7:15 → brief 8:30; parallel ticks produce one brief |
| Email delivery gates | Dry-run by default; founder mode emails only `REPORT_TO_EMAIL`; provider-accepted ≠ delivered; idempotent; retry on transient errors only |
| Billing scaffolding | FREE/PLUS/PRO/FOUNDER labels, prices unset; HMAC webhook, idempotent; live events rejected; founder never downgraded |
| Rights gate | link-only / paraphrase+link / media by mode; commercial mode blocks unlicensed images and Reddit without agreement |
| Admin | Launch phase, integration status (names only), scout ops + manual run, flags (locked ones unchangeable), sources, accounts/plans, usage & AI spend, review/intake, rights registry |
| Phone UX | No horizontal scroll at 390px on 11 routes; nav targets ≥ 44px; offline playbook via service worker; reduced motion; Neon / Subtle / Velvet (red-black-white) themes |

Totals: **125 unit/DB tests, 14 end-to-end tests, typecheck, lint and production build all pass.**
Screenshots: `docs/screenshots/iphone-*.jpg` (iPhone 13, 390×844 @3x) and `desktop-*.jpg` (1440 wide).
Note: the iPhone screenshots are rendered with Chromium at the iPhone 13 viewport; Safari/WebKit was not available in the build container.

## 2. Built but waiting on you (credentials, rights, approval)
| Item | What is needed | Where |
|---|---|---|
| Hosting | Your Supabase + Vercel accounts (free tiers likely fit) | docs/DEPLOYMENT.md |
| Morning email | Resend account, verified sending domain, `REPORT_*` vars, flag `email_delivery`, opt-in in Settings | Settings → Morning email |
| News & guide feeds | Six feeds seeded (Rockstar Intel, PC Gamer, Polygon, GameSpot, Game Rant, IGN); addresses not yet confirmed from a live server | Source Monitor |
| Rockstar official watch | Works in code; **this container's network blocks rockstargames.com**, so no live fetch has succeeded yet. Will run once deployed | Source Monitor |
| Reddit communities | Approved Reddit Data API app + credentials; a **commercial agreement** before any paid launch. Never scraped | `.env`, flag `reddit_ingestion` |
| AI coach | `ANTHROPIC_API_KEY` + flag `llm_assistant`. Model: Claude Haiku 5.5 (your choice), low effort, $1/day ceiling. A refusal falls back to free local search | `.env` |
| Licensed Leonida map | Rockstar's map is for personal download; embedding/redistribution needs permission. Until then: personal import + text landmarks | Map Room |
| Live community data | Fills automatically once hosted. Best results need Reddit access (Reddit reviews API requests) + an Anthropic key for the Haiku reader. News/guide feeds work without either | Source Monitor |
| Billing | Choose a provider (e.g. Stripe), set prices, legal review. `billing_live` is locked off | Admin |
| Private uploads in production | Move from local disk to Supabase Storage (private bucket) before serverless deploy | `api/uploads`, `api/screenshots` |
| Brand | "GameScout HQ" trademark/domain clearance | — |

## 3. Source coverage report (honest)
| Source | Checked from this container | Result |
|---|---|---|
| Rockstar Newswire (GTA VI), GTA VI page, Support, launch article | Yes, on every scan | **Unreachable** (network policy). Logged as failed; nothing fabricated |
| Official Leonida map | Manual source | Personal-use rights only; not fetched |
| r/GTA6, r/GTAVI, r/GrandTheftAutoVI, r/GTA6unmoderated, r/gtaglitches, r/grandtheftauto, r/rockstar | No | Not configured (no API credentials). Existence/activity not verified by the system |

The three official items shown in the app (launch announcement, printable map, expired Vintage Vice City Pack + GTA+ promo)
come from your build kit and are labeled **single report — not yet re-checked by HQ**. They upgrade to VERIFIED
automatically the first time the deployed watcher fetches the official page itself.

## 4. Scheduler and email status
- Scheduler: implemented and tested locally. **Not scheduled anywhere** (no host yet). `vercel.json` declares a 15-minute cron.
- Email: **dry run only.** Every brief records `dry_run` with the reason. No message has been sent or queued.
- Set the recipient with `REPORT_TO_EMAIL` and the sender with `REPORT_FROM_EMAIL` (verified domain in Resend).

## 5. Costs (estimates — confirm current prices before buying anything)
- Scouts: $0 model spend (deterministic). Hosting/database: free tiers expected at founder scale (unverified).
- Scout reader (Haiku): capped at $0.50/day by default (≈$15/month worst case; typical use lower). Raise or lower with `EXTRACT_DAILY_BUDGET_USD`.
- AI coach (optional): Haiku 5.5 is $0.10 per million input and $0.50 per million output tokens (prompts under 100K tokens).
  A typical answer of ~1.5k in / 400 out costs about $0.00035 — roughly 2,800 answers per $1. The `$1/day` ceiling
  stays as a safety net; per-plan daily quotas (FREE 5, PLUS 30, PRO 100) apply first.
- Email: Resend has a free tier (check its current limits). Reddit API commercial pricing: UNKNOWN until you apply.

## 6. Launch checklist (only your actions remain)
1. Approve hosting; create Supabase + Vercel projects; set env vars (docs/DEPLOYMENT.md).
2. Run migrations, seed, `founder:create` against Supabase.
3. Set `CRON_SECRET`. Free scheduler: add repository secrets `HQ_URL` and `HQ_CRON_SECRET` on GitHub; the hourly workflow `.github/workflows/strategy-hq-tick.yml` then drives scans and the brief (scheduled workflows run from the default branch).
4. Email: Resend domain + vars → dry run from Brief → turn on `email_delivery` → opt in.
5. Optional: Anthropic key + `llm_assistant`; Reddit API app + `reddit_ingestion`.
6. Add your first verified finds through Admin → Review & intake.
7. Before closed beta (Phase 1): rights review of every source in Admin → Rights registry; move uploads to private storage.
8. Before charging (Phase 2–3): legal review (Rockstar/Take-Two content policy, Reddit agreement, trademark), billing provider, pricing.
   Public registration and live billing stay locked until you explicitly unlock them.

## 7. Blocker log
- rockstargames.com and reddit.com are blocked by this build environment's network proxy (HTTP 403 at the proxy).
- WebKit is not installed in the container; phone tests use Chromium with the iPhone 13 profile.
- `games.max_chapter` is 1. Raise it once later chapters are confirmed to exist; the gate handles any number.
