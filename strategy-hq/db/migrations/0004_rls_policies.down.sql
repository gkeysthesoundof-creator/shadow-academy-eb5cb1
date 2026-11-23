do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' loop
    execute format('alter table %I disable row level security', r.tablename);
  end loop;
end $$;
drop trigger if exists findings_guard on findings;
drop function if exists guard_finding_writes();
drop function if exists locked_future_counts(text);
drop function if exists app_finding_visible(text,text,integer,text);
