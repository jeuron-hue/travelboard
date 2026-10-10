-- travelboard migration 0003: journal tables (SPEC.md 8.2)
-- Touches only schema travel. RLS on, no grants to anon or authenticated.
begin;

create table travel.journal_messages (
  id            uuid primary key,                -- generated on the phone for user turns, server for replies
  owner         uuid not null references auth.users(id),
  local_date    date not null,                   -- the thread (local day, 0400 rollover) the turn belongs to
  role          text not null check (role in ('user','assistant')),
  content       text not null check (char_length(content) <= 20000),
  reply_to      uuid,                            -- assistant row -> the user row it answers
  model         text,
  input_tokens  int,
  output_tokens int,
  created_at    timestamptz not null,            -- device clock for user turns, server clock for replies
  server_ts     timestamptz not null default now()-- set by server on every write
);
create unique index journal_one_reply on travel.journal_messages (reply_to) where role = 'assistant';
create index journal_owner_day on travel.journal_messages (owner, local_date, created_at);

create table travel.journal_days (
  owner       uuid not null references auth.users(id),
  local_date  date not null,
  suffix      text not null default '' check (char_length(suffix) <= 200),
  server_ts   timestamptz not null default now(),
  primary key (owner, local_date)
);

-- Defence in depth, as for travel.captures: no role has table grants, and no policies exist.
alter table travel.journal_messages enable row level security;
alter table travel.journal_days enable row level security;

commit;
