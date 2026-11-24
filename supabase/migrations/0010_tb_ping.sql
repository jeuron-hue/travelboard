-- travelboard migration 0010: keep-alive ping (SPEC.md 4.1, 6.8 step 5; Gary's decision 24/11/26)
-- Supabase warned on 24/11/26 that project travelboard had too little activity over 7 days and
-- would be paused, although the daily keep-alive had run green every day. That ping was an
-- anonymous rpc/tb_whoami refused with 42501, which reaches the database but runs no query.
-- New:
-- - tb_ping(): the one function anon may call (the named exception to CLAUDE.md rule 3). It
--   reads one row of travel.captures, so a real query runs, and returns only the server time.
--   It takes no input and returns no data: no row, no count, no id.
-- Touches only public.tb_*. No tables, no grants on tables, nothing dropped or replaced.
begin;

create function public.tb_ping()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = travel, public
as $$
begin
  perform 1 from travel.captures limit 1;
  return now();
end;
$$;

revoke all on function public.tb_ping() from public;
grant execute on function public.tb_ping() to anon, authenticated;

commit;
