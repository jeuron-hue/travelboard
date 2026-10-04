-- travelboard migration 0001: schema travel and travel.captures (SPEC.md 6.2)
-- Touches only schema travel. No grants to anon or authenticated.
-- Applied 04/10/26 as Supabase migration 20261004090608 tb_0001_travel_schema_captures.
begin;

create schema if not exists travel;
revoke all on schema travel from public, anon, authenticated;

create table travel.captures (
  id           uuid primary key,                 -- generated on the phone
  owner        uuid not null references auth.users(id),
  body         text not null default '' check (char_length(body) <= 20000),
  kind         text not null default 'note' check (kind in ('note','journal')),
  captured_at  timestamptz not null,             -- device clock, UTC
  tz           text not null,                    -- IANA zone at capture, e.g. Asia/Bangkok
  local_date   date not null,                    -- calendar date in tz at capture
  lat          double precision,
  lng          double precision,
  accuracy_m   real,
  trip_id      uuid,                             -- reserved for M3, no FK yet
  place_id     text,                             -- reserved for M3
  updated_at   timestamptz not null,             -- device clock, drives last-write-wins
  deleted_at   timestamptz,                      -- soft delete
  server_ts    timestamptz not null default now()-- set by server on every write, pull cursor
);

-- Defence in depth (SPEC.md 6.2 notes): no role has table grants, and no policies exist.
alter table travel.captures enable row level security;

create index captures_owner_day on travel.captures (owner, local_date);
create index captures_owner_server_ts on travel.captures (owner, server_ts);

commit;
