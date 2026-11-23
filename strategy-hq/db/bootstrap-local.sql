-- LOCAL / SELF-HOSTED POSTGRES ONLY. Run once as a superuser.
-- Supabase already provides the `anon`, `authenticated` and `service_role`
-- roles, so this file is skipped there (see docs/DEPLOYMENT.md).
-- The application connects as the database owner and then switches into one
-- of these roles per transaction, so row-level security is enforced by the
-- database itself rather than trusted to application code.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- :owner is substituted by scripts/migrate.ts (default gsq_owner)
grant anon, authenticated, service_role to :"owner";
