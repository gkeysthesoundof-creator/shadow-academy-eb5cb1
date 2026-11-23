-- GameScout HQ platform core: identity, tenancy, games, per-user profiles.
-- Every user-owned table carries user_id and is protected by row-level security.

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Request identity helpers (compatible with Supabase's auth.uid() convention:
-- both read the JWT claims that the server sets per transaction).
-- ---------------------------------------------------------------------------
create or replace function app_uid() returns uuid
language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Identity & tenancy
-- ---------------------------------------------------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,
  display_name  text not null default 'Player',
  password_hash text,                       -- null when an external IdP is used
  status        text not null default 'active' check (status in ('active','disabled','pending_deletion')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create trigger users_touch before update on users for each row execute function touch_updated_at();

create table sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
create index sessions_user_idx on sessions(user_id);

create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  kind       text not null check (kind in ('platform','personal','team')),
  created_at timestamptz not null default now()
);

create table membership_roles (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  role         text not null check (role in ('owner','admin','moderator','customer')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index membership_user_idx on membership_roles(user_id);

-- Platform administration = owner/admin membership in the single 'platform' workspace.
create or replace function app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membership_roles m join workspaces w on w.id = m.workspace_id
    where w.slug = 'platform' and m.user_id = app_uid() and m.role in ('owner','admin')
  )
$$;

create or replace function app_is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membership_roles m join workspaces w on w.id = m.workspace_id
    where w.slug = 'platform' and m.user_id = app_uid() and m.role in ('owner','admin','moderator')
  )
$$;

create table invites (
  id          uuid primary key default gen_random_uuid(),
  email       citext not null,
  code_hash   text not null unique,
  created_by  uuid references users(id) on delete set null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table privacy_consents (
  user_id    uuid not null references users(id) on delete cascade,
  consent    text not null check (consent in ('terms','screenshot_analysis','email_briefing','product_updates')),
  granted    boolean not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, consent)
);

create table feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  description text not null,
  locked      boolean not null default false,   -- locked flags cannot be flipped from the UI
  updated_by  uuid references users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Simple fixed-window rate limiter for unauthenticated surfaces (login).
create table rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------
-- Games (game-agnostic foundation; GTA VI is the first adapter)
-- ---------------------------------------------------------------------------
create table games (
  id           text primary key,                 -- 'gta6'
  name         text not null,
  adapter      text not null,
  max_chapter  integer not null default 1 check (max_chapter >= 1),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table game_versions (
  id          uuid primary key default gen_random_uuid(),
  game_id     text not null references games(id) on delete cascade,
  label       text not null,
  released_at date,
  notes       text,
  source_url  text,
  unique (game_id, label)
);

create table user_game_profiles (
  user_id      uuid not null references users(id) on delete cascade,
  game_id      text not null references games(id) on delete cascade,
  platform     text not null default 'PS5' check (platform in ('PS5','XBOX_SERIES','PC','OTHER')),
  chapter      integer not null default 1 check (chapter between 1 and 99),
  spoiler_shield boolean not null default true,
  timezone     text not null default 'America/New_York',
  saved_region text,                              -- user-declared area; no fake GPS
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, game_id)
);
create trigger ugp_touch before update on user_game_profiles for each row execute function touch_updated_at();

-- The requesting user's chapter for a game; defaults to 1 (spoiler-safe).
create or replace function app_user_chapter(p_game text) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select chapter from user_game_profiles where user_id = app_uid() and game_id = p_game), 1)
$$;

create table player_device_preferences (
  user_id         uuid primary key references users(id) on delete cascade,
  primary_device  text not null default 'iPhone',
  other_devices   text[] not null default '{}',
  theme           text not null default 'neon' check (theme in ('neon','subtle','velvet')),
  reduced_motion  boolean not null default false,
  updated_at      timestamptz not null default now()
);

create table alert_preferences (
  user_id          uuid primary key references users(id) on delete cascade,
  email_enabled    boolean not null default false,       -- opt-in; nothing sends until configured
  send_local_time  time not null default '08:30',
  sections         text[] not null default array['top3','vehicles','weapons','money','secrets','missions','rewards','corrections','health'],
  include_private_screenshots boolean not null default false,
  updated_at       timestamptz not null default now()
);

-- Private progress
create table user_progress (
  user_id      uuid not null references users(id) on delete cascade,
  game_id      text not null references games(id) on delete cascade,
  notes        text not null default '' check (length(notes) <= 20000),
  missions_done text[] not null default '{}',
  updated_at   timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table user_tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  game_id    text not null references games(id) on delete cascade,
  text       text not null check (length(text) between 1 and 300),
  done       boolean not null default false,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);
create index user_tasks_user_idx on user_tasks(user_id, game_id);

create table user_cash_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  game_id    text not null references games(id) on delete cascade,
  amount     bigint not null,                    -- manually entered; never read from console
  label      text not null check (length(label) between 1 and 120),
  entered_at timestamptz not null default now()
);
create index user_cash_user_idx on user_cash_entries(user_id, game_id);
