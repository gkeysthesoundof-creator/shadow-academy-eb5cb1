-- Row-level security. The app switches into `authenticated` (per signed-in user)
-- or `service_role` (scheduled workers) inside each transaction.
-- Private data: owner only. Intel: published + chapter-eligible only.
-- Verification state, publication and billing can never be written by a customer.

-- ---------------------------------------------------------------------------
-- Spoiler gate: a finding is visible to the requesting user only when it is
-- published AND within their chapter. Chapter-unknown items are visible only
-- when they carry no story content at all.
-- ---------------------------------------------------------------------------
create or replace function app_finding_visible(p_game text, p_status text, p_chapter_min integer, p_spoiler text)
returns boolean language sql stable as $$
  select p_status = 'published' and (
    (p_chapter_min is not null and p_chapter_min <= app_user_chapter(p_game))
    or (p_chapter_min is null and p_spoiler = 'none')
  )
$$;

-- Counts of locked future-chapter items, without any titles or details.
create or replace function locked_future_counts(p_game text)
returns table(scout_id text, locked integer)
language sql stable security definer set search_path = public as $$
  select l.scout_id, count(*)::int
  from findings f join scout_finding_links l on l.finding_id = f.id
  where f.game_id = p_game and f.publication_status = 'published'
    and not ((f.chapter_min is not null and f.chapter_min <= app_user_chapter(p_game))
             or (f.chapter_min is null and f.spoiler_level = 'none'))
  group by l.scout_id
$$;

-- Prevent non-admins from altering protected columns even if a policy slipped.
create or replace function guard_finding_writes() returns trigger
language plpgsql as $$
begin
  if current_user = 'authenticated' and not app_is_moderator() then
    raise exception 'findings are read-only for customers';
  end if;
  return new;
end $$;
create trigger findings_guard before insert or update or delete on findings
  for each row execute function guard_finding_writes();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. Not FORCED: the schema owner (migrations + SECURITY DEFINER
-- helpers) bypasses RLS, exactly like Supabase's postgres role. Application requests
-- always run as `authenticated`/`service_role`/`anon`, never as the owner.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'users','sessions','workspaces','membership_roles','invites','privacy_consents','feature_flags','rate_limits',
    'games','game_versions','user_game_profiles','player_device_preferences','alert_preferences',
    'user_progress','user_tasks','user_cash_entries',
    'content_rights','media_licenses','content_takedowns','sources','ingestion_jobs','source_runs','raw_posts',
    'scout_categories','places','map_assets','map_pins','findings','scout_finding_links','evidence','finding_media',
    'money_routes','rewards','corrections','admin_review_log','scout_runs',
    'user_hunts','user_private_pins','user_screenshots','digest_runs','digest_sections','delivery_attempts',
    'plan_catalog','billing_customers','subscriptions','entitlements','billing_webhook_events','usage_meter','platform_budget'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- Owner-only tables: full CRUD for the owning user.
do $$
declare t text;
begin
  foreach t in array array[
    'user_game_profiles','player_device_preferences','alert_preferences','user_progress','user_tasks',
    'user_cash_entries','user_hunts','user_private_pins','user_screenshots','privacy_consents'
  ] loop
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format($p$create policy owner_all on %I for all to authenticated
                     using (user_id = app_uid()) with check (user_id = app_uid())$p$, t);
  end loop;
end $$;

-- Read-own tables (written only by the service / billing webhook / scheduler).
do $$
declare t text;
begin
  foreach t in array array['subscriptions','entitlements','billing_customers','usage_meter','digest_runs'] loop
    execute format('grant select on %I to authenticated', t);
    execute format($p$create policy owner_read on %I for select to authenticated
                     using (user_id = app_uid() or app_is_admin())$p$, t);
  end loop;
end $$;

grant select on digest_sections, delivery_attempts to authenticated;
create policy owner_read on digest_sections for select to authenticated
  using (exists (select 1 from digest_runs d where d.id = digest_id and (d.user_id = app_uid() or app_is_admin())));
create policy owner_read on delivery_attempts for select to authenticated
  using (exists (select 1 from digest_runs d where d.id = digest_id and (d.user_id = app_uid() or app_is_admin())));

-- Users: read self (admins read all). Profile name edits go through the service.
grant select on users to authenticated;
create policy self_read on users for select to authenticated using (id = app_uid() or app_is_admin());
grant select on sessions to authenticated;
create policy self_read on sessions for select to authenticated using (user_id = app_uid());

grant select on workspaces, membership_roles to authenticated;
create policy member_read on membership_roles for select to authenticated using (user_id = app_uid() or app_is_admin());
create policy member_read on workspaces for select to authenticated
  using (app_is_admin() or exists (select 1 from membership_roles m where m.workspace_id = id and m.user_id = app_uid()));

grant select on invites to authenticated;
create policy admin_read on invites for select to authenticated using (app_is_admin());

-- Feature flags: everyone signed-in may read; only admins may flip unlocked flags.
grant select, update on feature_flags to authenticated;
create policy read_flags on feature_flags for select to authenticated using (true);
create policy admin_flip on feature_flags for update to authenticated using (app_is_admin() and not locked) with check (app_is_admin() and not locked);

-- Public catalogue data
grant select on games, game_versions, scout_categories, plan_catalog to authenticated, anon;
create policy read_all on games for select to authenticated, anon using (true);
create policy read_all on game_versions for select to authenticated, anon using (true);
create policy read_all on scout_categories for select to authenticated, anon using (true);
create policy read_public on plan_catalog for select to authenticated, anon using (public or app_is_admin());

-- Source health is visible to signed-in users (transparency); configs/admin edits admin-only.
grant select on sources, source_runs, scout_runs, ingestion_jobs to authenticated;
create policy read_all on sources for select to authenticated using (true);
create policy read_all on source_runs for select to authenticated using (true);
create policy read_all on scout_runs for select to authenticated using (true);
create policy read_all on ingestion_jobs for select to authenticated using (true);
grant update on sources to authenticated;
create policy admin_update on sources for update to authenticated using (app_is_admin()) with check (app_is_admin());

-- Rights registry: admins only.
grant select, insert, update on content_rights, media_licenses, content_takedowns to authenticated;
create policy admin_all on content_rights for all to authenticated using (app_is_admin()) with check (app_is_admin());
create policy admin_all on media_licenses for all to authenticated using (app_is_admin()) with check (app_is_admin());
create policy admin_all on content_takedowns for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- Raw posts: moderators only (customers see paraphrased findings + link-outs).
grant select on raw_posts to authenticated;
create policy mod_read on raw_posts for select to authenticated using (app_is_moderator());

-- ---------------------------------------------------------------------------
-- Findings and everything hanging off them inherit the spoiler gate.
-- ---------------------------------------------------------------------------
grant select, insert, update on findings to authenticated;
create policy visible_read on findings for select to authenticated
  using (app_finding_visible(game_id, publication_status, chapter_min, spoiler_level) or app_is_moderator());
create policy mod_write on findings for insert to authenticated with check (app_is_moderator());
create policy mod_update on findings for update to authenticated using (app_is_moderator()) with check (app_is_moderator());

grant select, insert, delete on scout_finding_links, evidence, money_routes, rewards, finding_media to authenticated;
grant update on evidence, money_routes, rewards, finding_media to authenticated;
do $$
declare t text;
begin
  foreach t in array array['scout_finding_links','evidence','money_routes','rewards','finding_media'] loop
    execute format($p$create policy visible_read on %I for select to authenticated
                     using (exists (select 1 from findings f where f.id = finding_id))$p$, t);
    execute format($p$create policy mod_write on %I for all to authenticated
                     using (app_is_moderator()) with check (app_is_moderator())$p$, t);
  end loop;
end $$;

grant select, insert, update on places, map_assets, map_pins to authenticated;
create policy read_all on places for select to authenticated using (true);
create policy mod_write on places for all to authenticated using (app_is_moderator()) with check (app_is_moderator());
-- Map assets: platform assets visible to all; user uploads visible to their owner only.
create policy read_assets on map_assets for select to authenticated
  using (owner_user_id is null or owner_user_id = app_uid());
create policy own_upload on map_assets for insert to authenticated
  with check (owner_user_id = app_uid() and kind = 'user_uploaded' and calibrated = false);
create policy mod_assets on map_assets for update to authenticated using (app_is_moderator()) with check (app_is_moderator());
grant delete on map_assets to authenticated;
create policy own_delete on map_assets for delete to authenticated using (owner_user_id = app_uid());
-- Verified pins follow the finding they belong to.
create policy visible_read on map_pins for select to authenticated
  using (exists (select 1 from findings f where f.place_id = map_pins.place_id));
create policy mod_write on map_pins for all to authenticated using (app_is_moderator()) with check (app_is_moderator());

-- Corrections: anyone may file; reporters read their own; moderators triage.
grant select, insert, update on corrections to authenticated;
create policy file_own on corrections for insert to authenticated
  with check (reported_by = app_uid() and status = 'open' and resolved_by is null);
create policy read_own on corrections for select to authenticated using (reported_by = app_uid() or app_is_moderator());
create policy mod_update on corrections for update to authenticated using (app_is_moderator()) with check (app_is_moderator());

grant select, insert on admin_review_log to authenticated;
create policy mod_read on admin_review_log for select to authenticated using (app_is_moderator());
create policy mod_insert on admin_review_log for insert to authenticated with check (app_is_moderator() and actor_id = app_uid());

-- Webhook events and budgets: service only (no authenticated grants at all).

grant execute on function app_uid(), app_is_admin(), app_is_moderator(), app_user_chapter(text),
  app_finding_visible(text,text,integer,text), locked_future_counts(text), consume_usage(text,integer,date)
  to authenticated;
revoke execute on function consume_usage(text,integer,date) from public, anon;
