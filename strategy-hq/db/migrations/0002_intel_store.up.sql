-- ONE canonical, evidence-backed discovery store shared by all ten scouts.
-- Scouts are lenses (scout_finding_links), never separate data stores.

-- ---------------------------------------------------------------------------
-- Rights registry (gates what may be shown, and in which product mode)
-- ---------------------------------------------------------------------------
create table content_rights (
  id               uuid primary key default gen_random_uuid(),
  label            text not null,
  rights_status    text not null check (rights_status in ('unreviewed','link_out_only','personal_use','licensed','owned','denied')),
  allowed_uses     text[] not null default '{}',   -- subset of {private,closed_beta,commercial}
  retention_days   integer,                         -- null = keep while source exists
  attribution      text,
  agreement_ref    text,                            -- contract / approval reference (no secrets)
  expires_at       timestamptz,
  reviewed_by      uuid references users(id) on delete set null,
  reviewed_at      timestamptz,
  notes            text,
  created_at       timestamptz not null default now()
);

create table media_licenses (
  id            uuid primary key default gen_random_uuid(),
  licensor      text not null,
  license_type  text not null check (license_type in ('user_owned','licensed','permission_granted','unknown')),
  allowed_uses  text[] not null default '{}',
  attribution   text,
  evidence_url  text,
  expires_at    timestamptz,
  approved_by   uuid references users(id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table content_takedowns (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('finding','evidence','media','source','raw_post')),
  target_id   uuid not null,
  reason      text not null,
  received_at timestamptz not null default now(),
  actioned_at timestamptz,
  status      text not null default 'open' check (status in ('open','actioned','rejected'))
);

-- ---------------------------------------------------------------------------
-- Sources and ingestion
-- ---------------------------------------------------------------------------
create table sources (
  id               uuid primary key default gen_random_uuid(),
  game_id          text not null references games(id) on delete cascade,
  kind             text not null check (kind in ('rockstar','reddit','guide','official_map','other')),
  name             text not null,
  canonical_url    text not null,
  access_method    text not null check (access_method in ('html_change_watch','rss','reddit_api','manual')),
  enabled          boolean not null default false,
  status           text not null default 'not_configured'
                   check (status in ('not_configured','needs_credentials','needs_rights','ok','partial','failing','blocked','stale')),
  access_notes     text,
  terms_url        text,
  rights_id        uuid references content_rights(id) on delete set null,
  min_interval_minutes integer not null default 720,
  last_check_at    timestamptz,
  last_success_at  timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  unique (game_id, canonical_url)
);

create table ingestion_jobs (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('daily_scan','manual_refresh','verification','briefing')),
  idempotency_key  text not null unique,          -- e.g. daily_scan:2026-11-23
  requested_by     uuid references users(id) on delete set null,
  status           text not null default 'running' check (status in ('running','succeeded','partial','failed','skipped')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  summary          jsonb not null default '{}'
);

create table source_runs (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid not null references sources(id) on delete cascade,
  ingestion_job_id uuid references ingestion_jobs(id) on delete set null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  outcome          text not null check (outcome in ('success','partial','failed','skipped','blocked','not_configured')),
  items_fetched    integer not null default 0,
  items_new        integer not null default 0,
  window_from      timestamptz,
  window_to        timestamptz,
  coverage_note    text,
  error            text
);
create index source_runs_source_idx on source_runs(source_id, started_at desc);

create table raw_posts (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references sources(id) on delete cascade,
  original_id   text,
  url           text not null,
  title         text not null,
  excerpt       text check (length(excerpt) <= 500),    -- short only; never mirror full posts
  published_at  timestamptz,
  retrieved_at  timestamptz not null default now(),
  content_hash  text not null,
  routed_scouts text[] not null default '{}',
  processed_at  timestamptz,
  unique (source_id, content_hash)
);

-- ---------------------------------------------------------------------------
-- Scout registry (ten specialist lenses over one store)
-- ---------------------------------------------------------------------------
create table scout_categories (
  scout_id     text primary key,
  name         text not null,
  short_name   text not null,
  description  text not null,
  icon         text not null,
  color        text not null,
  sort         integer not null,
  finding_categories text[] not null default '{}'
);

-- ---------------------------------------------------------------------------
-- Normalized places + map
-- ---------------------------------------------------------------------------
create table places (
  id            uuid primary key default gen_random_uuid(),
  game_id       text not null references games(id) on delete cascade,
  location_key  text not null,                -- normalized landmark key; dedupe anchor
  landmark      text not null,                -- one-sentence verified physical description
  region        text,
  created_at    timestamptz not null default now(),
  unique (game_id, location_key)
);

create table map_assets (
  id             uuid primary key default gen_random_uuid(),
  game_id        text not null references games(id) on delete cascade,
  owner_user_id  uuid references users(id) on delete cascade,   -- null = platform asset
  kind           text not null check (kind in ('official','licensed','user_uploaded')),
  storage_key    text not null,
  mime           text not null,
  width          integer,
  height         integer,
  license_id     uuid references media_licenses(id) on delete set null,
  calibrated     boolean not null default false,
  calibration    jsonb,
  provenance     text not null,
  created_at     timestamptz not null default now()
);

-- Verified pins only. Coordinates require a calibrated platform map AND evidence.
create table map_pins (
  id            uuid primary key default gen_random_uuid(),
  place_id      uuid not null references places(id) on delete cascade,
  map_asset_id  uuid not null references map_assets(id) on delete cascade,
  x             numeric(7,6) not null check (x >= 0 and x <= 1),
  y             numeric(7,6) not null check (y >= 0 and y <= 1),
  precision     text not null check (precision in ('exact','approximate','region')),
  evidence_note text not null,
  created_at    timestamptz not null default now(),
  unique (place_id, map_asset_id)
);

-- ---------------------------------------------------------------------------
-- Findings (canonical) and evidence
-- ---------------------------------------------------------------------------
create table findings (
  id                 uuid primary key default gen_random_uuid(),
  game_id            text not null references games(id) on delete cascade,
  game_scope         text not null check (game_scope in ('GTA_VI','GTA_ONLINE')),
  category           text not null check (category in ('vehicle','weapon','cash_pickup','money_activity','secret','collectible','mission_tip','map_location','reward','update','community')),
  title              text not null,
  summary            text not null,                  -- paraphrase written from permitted references
  why_it_matters     text,
  how_to             text[] not null default '{}',
  prerequisites      text,
  hazards            text,
  risk               text not null default 'unknown' check (risk in ('low','medium','high','unknown')),
  chapter_min        integer check (chapter_min >= 1),   -- null = unknown
  chapter_max        integer check (chapter_max >= 1),
  spoiler_level      text not null default 'story' check (spoiler_level in ('none','mild','story')),
  verification       text not null default 'unverified'
                     check (verification in ('verified','corroborated','single_report','unverified','debunked','expired')),
  lifecycle          text not null default 'new' check (lifecycle in ('new','updated','corrected','stable','retired')),
  publication_status text not null default 'draft' check (publication_status in ('draft','in_review','published','retracted')),
  is_free            boolean,                           -- null = unknown
  payout_min         bigint,
  payout_max         bigint,
  price              bigint,
  availability       text,                              -- e.g. 'one-time', 'respawns', 'limited-time'
  place_id           uuid references places(id) on delete set null,
  patch_version      text,
  attributes         jsonb not null default '{}',
  first_seen_at      timestamptz not null default now(),
  last_confirmed_at  timestamptz,
  last_checked_at    timestamptz,
  published_at       timestamptz,
  dedupe_key         text not null,
  created_by         uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (game_id, dedupe_key),
  check (payout_min is null or payout_max is null or payout_min <= payout_max),
  check (chapter_min is null or chapter_max is null or chapter_min <= chapter_max)
);
create trigger findings_touch before update on findings for each row execute function touch_updated_at();
create index findings_pub_idx on findings(game_id, publication_status, chapter_min);
create index findings_fts_idx on findings using gin (to_tsvector('english', title || ' ' || summary));

create table scout_finding_links (
  scout_id   text not null references scout_categories(scout_id) on delete cascade,
  finding_id uuid not null references findings(id) on delete cascade,
  primary key (scout_id, finding_id)
);
create index sfl_finding_idx on scout_finding_links(finding_id);

create table evidence (
  id             uuid primary key default gen_random_uuid(),
  finding_id     uuid not null references findings(id) on delete cascade,
  source_id      uuid references sources(id) on delete set null,
  raw_post_id    uuid references raw_posts(id) on delete set null,
  url            text not null check (url ~ '^https://'),
  title          text not null,
  published_at   timestamptz,
  paraphrase     text not null check (length(paraphrase) <= 600),
  evidence_type  text not null check (evidence_type in ('official','guide','community','user_report','founder_observation')),
  independent_origin text not null,                -- domain/author bucket for corroboration counting
  contradicts    boolean not null default false,
  captured_at    timestamptz not null default now(),
  unique (finding_id, url)
);

create table finding_media (
  id               uuid primary key default gen_random_uuid(),
  finding_id       uuid not null references findings(id) on delete cascade,
  media_license_id uuid references media_licenses(id) on delete set null,
  kind             text not null check (kind in ('real_gameplay','user_owned','illustrative')),
  storage_key      text,
  external_url     text,
  alt_text         text not null,
  annotations      jsonb not null default '[]',
  created_at       timestamptz not null default now(),
  check (storage_key is not null or external_url is not null)
);

create table money_routes (
  finding_id          uuid primary key references findings(id) on delete cascade,
  money_kind          text not null check (money_kind in ('world_pickup','one_time_loot','repeatable_activity')),
  time_minutes_min    numeric,
  time_minutes_max    numeric,
  cooldown            text,
  repeatable          boolean,
  wanted_level_risk   text not null default 'unknown' check (wanted_level_risk in ('none','low','medium','high','unknown')),
  transfers_across_chapters text not null default 'unknown' check (transfers_across_chapters in ('yes','no','unknown')),
  patched             boolean not null default false
);

create table rewards (
  id               uuid primary key default gen_random_uuid(),
  finding_id       uuid unique references findings(id) on delete cascade,
  game_scope       text not null check (game_scope in ('GTA_VI','GTA_ONLINE')),
  cost_type        text not null check (cost_type in ('free','included_with_purchase','subscription','paid','unknown')),
  status           text not null check (status in ('active','upcoming','expired','unknown')),
  platforms        text[] not null default '{}',
  starts_at        timestamptz,
  ends_at          timestamptz,
  claim_steps      text[] not null default '{}',
  source_url       text not null,
  last_verified_at timestamptz
);

create table corrections (
  id           uuid primary key default gen_random_uuid(),
  finding_id   uuid not null references findings(id) on delete cascade,
  reported_by  uuid references users(id) on delete set null,
  kind         text not null check (kind in ('wrong_location','patched','wrong_chapter','spoiler','rights','other')),
  details      text not null check (length(details) between 3 and 2000),
  status       text not null default 'open' check (status in ('open','accepted','rejected')),
  resolved_by  uuid references users(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table admin_review_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references users(id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   text,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);

create table scout_runs (
  id                 uuid primary key default gen_random_uuid(),
  ingestion_job_id   uuid references ingestion_jobs(id) on delete set null,
  scout_id           text not null references scout_categories(scout_id) on delete cascade,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  status             text not null check (status in ('running','succeeded','partial','failed','skipped','not_configured')),
  items_examined     integer not null default 0,
  findings_added     integer not null default 0,
  findings_updated   integer not null default 0,
  findings_corrected integer not null default 0,
  llm_tokens         integer not null default 0,
  cost_micros        bigint not null default 0,
  note               text,
  error              text
);
create index scout_runs_idx on scout_runs(scout_id, started_at desc);
