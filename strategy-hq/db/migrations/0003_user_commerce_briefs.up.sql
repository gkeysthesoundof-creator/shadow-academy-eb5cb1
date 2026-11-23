-- Per-user collections, private uploads, briefings, billing scaffolding, usage limits.

create table user_hunts (
  user_id    uuid not null references users(id) on delete cascade,
  finding_id uuid not null references findings(id) on delete cascade,
  status     text not null check (status in ('saved','found','skipped')),
  note       text check (length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (user_id, finding_id)
);

create table user_private_pins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  game_id      text not null references games(id) on delete cascade,
  map_asset_id uuid references map_assets(id) on delete cascade,
  x            numeric(7,6) not null check (x >= 0 and x <= 1),
  y            numeric(7,6) not null check (y >= 0 and y <= 1),
  label        text not null check (length(label) between 1 and 80),
  note         text check (length(note) <= 500),
  finding_id   uuid references findings(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index upp_user_idx on user_private_pins(user_id, game_id);

create table user_screenshots (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  storage_key        text not null unique,
  mime               text not null check (mime in ('image/png','image/jpeg','image/webp')),
  bytes              integer not null check (bytes > 0 and bytes <= 8388608),
  sha256             text not null,
  consent_analysis   boolean not null default false,
  question           text check (length(question) <= 500),
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Morning briefing: one per user per local calendar day (idempotent)
-- ---------------------------------------------------------------------------
create table digest_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  game_id         text not null references games(id) on delete cascade,
  local_date      date not null,
  chapter         integer not null,
  status          text not null check (status in ('building','ready','failed')),
  subject         text,
  preheader       text,
  html            text,
  summary         jsonb not null default '{}',
  scout_job_id    uuid references ingestion_jobs(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (user_id, game_id, local_date)
);

create table digest_sections (
  digest_id   uuid not null references digest_runs(id) on delete cascade,
  section     text not null,
  sort        integer not null,
  items       jsonb not null default '[]',
  primary key (digest_id, section)
);

create table delivery_attempts (
  id                  uuid primary key default gen_random_uuid(),
  digest_id           uuid not null references digest_runs(id) on delete cascade,
  idempotency_key     text not null unique,
  attempt             integer not null default 1,
  provider            text not null,
  status              text not null check (status in ('dry_run','blocked','queued','sent','provider_accepted','delivered','failed')),
  provider_message_id text,
  error               text,
  at                  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Billing scaffolding (provider-neutral; live billing disabled by flag)
-- ---------------------------------------------------------------------------
create table plan_catalog (
  id            text primary key check (id in ('free','plus','pro','founder')),
  label         text not null,
  description   text not null,
  monthly_price_cents integer,      -- null until the owner sets real pricing
  yearly_price_cents  integer,
  features      jsonb not null,     -- {feature: limit|null(unlimited)|false}
  public        boolean not null default true,
  active        boolean not null default true
);

create table billing_customers (
  user_id              uuid primary key references users(id) on delete cascade,
  provider             text not null,
  provider_customer_id text not null,
  test_mode            boolean not null default true,
  unique (provider, provider_customer_id)
);

create table subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  plan_id             text not null references plan_catalog(id),
  status              text not null check (status in ('trialing','active','past_due','canceled','grandfathered')),
  provider            text not null default 'none',
  provider_ref        text,
  interval            text check (interval in ('month','year')),
  current_period_end  timestamptz,
  test_mode           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index subscriptions_one_live on subscriptions(user_id) where status in ('trialing','active','past_due','grandfathered');

create table entitlements (
  user_id    uuid not null references users(id) on delete cascade,
  feature    text not null,
  limit_value integer,              -- null = unlimited
  source     text not null check (source in ('plan','grant','founder')),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature)
);

create table billing_webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,
  event_id      text not null,
  event_type    text not null,
  payload_sha256 text not null,
  status        text not null default 'received' check (status in ('received','processed','ignored','failed')),
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  unique (provider, event_id)
);

create table usage_meter (
  user_id     uuid not null references users(id) on delete cascade,
  meter       text not null,
  day         date not null,
  count       integer not null default 0,
  cost_micros bigint not null default 0,
  primary key (user_id, meter, day)
);

-- Platform-wide daily cost ceiling bookkeeping (LLM etc.)
create table platform_budget (
  day          date not null,
  meter        text not null,
  cost_micros  bigint not null default 0,
  calls        integer not null default 0,
  primary key (day, meter)
);

-- Atomically consume one unit of a metered feature. Returns false when over limit.
create or replace function consume_usage(p_meter text, p_limit integer, p_day date)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if app_uid() is null then return false; end if;
  if p_limit is not null and p_limit <= 0 then return false; end if;
  insert into usage_meter(user_id, meter, day, count) values (app_uid(), p_meter, p_day, 1)
  on conflict (user_id, meter, day) do update set count = usage_meter.count + 1
  where p_limit is null or usage_meter.count < p_limit
  returning count into v_count;
  return v_count is not null;
end $$;
