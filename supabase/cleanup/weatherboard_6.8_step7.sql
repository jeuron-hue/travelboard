-- travelboard clean-up in project weatherboard (nyjsrnntxdgfykkmihpx), SPEC.md 6.8 step 7.
-- Run once, 24/10/26, on Gary's explicit yes after the move passed on the Pixel.
-- Run as plain SQL (not apply_migration), so weatherboard's migration history gains no row.
-- One transaction. No CASCADE: if anything else depended on these objects, a drop fails
-- and nothing changes. The guards stop it if the rows differ from the inventory, so no data
-- written to weatherboard after the copy could be lost unseen.
-- Removes: schema travel (tables captures, journal_messages, journal_days and their 7
-- indexes), the 9 public.tb_* functions, and the 4 tb_ rows in
-- supabase_migrations.schema_migrations. Gary deletes Edge Function tb-journal and the auth
-- user gary@travelboard.local in the dashboard.
begin;

do $guard$
begin
  if (select count(*) from travel.captures) <> 33
     or (select count(*) from travel.journal_messages) <> 12
     or (select count(*) from travel.journal_days) <> 1 then
    raise exception 'clean-up: travel row counts differ from the 23/10/26 inventory (33, 12, 1)';
  end if;
end
$guard$;

drop function public.tb_whoami();
drop function public.tb_capture_upsert(jsonb);
drop function public.tb_captures_upsert(jsonb);
drop function public.tb_captures_since(timestamptz, uuid);
drop function public.tb_journal_day(date);
drop function public.tb_journal_days(int);
drop function public.tb_journal_day_suffix(date, text);
drop function public.tb_journal_turn(jsonb);
drop function public.tb_journal_reply(jsonb);

drop table travel.journal_messages;
drop table travel.journal_days;
drop table travel.captures;
drop schema travel;

do $history$
declare
  n int;
begin
  delete from supabase_migrations.schema_migrations
   where name in ('tb_0001_travel_schema_captures', 'tb_0002_rpcs', 'tb_0003_journal_tables', 'tb_0004_journal_rpcs');
  get diagnostics n = row_count;
  if n <> 4 then
    raise exception 'clean-up: expected 4 migration history rows, found %', n;
  end if;
end
$history$;

commit;
