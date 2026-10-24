-- travelboard migration 0008: two travellers (SPEC.md D16, 7B.2)
-- Touches only schema travel, public.tb_* functions and the policy tb_photos_select on
-- storage.objects. No grants to anon. RLS on both new tables, no table grants.
-- New:
-- - travel.people: one row per traveller, with the journal prompt tb-journal uses. Rows for
--   gary@travelboard.local (journal) and eric@travelboard.local (journal-eric).
-- - travel.partner_adds: one row per direction. The link is live when both directions exist
--   with removed_at null. Remove sets removed_at; adding again clears it. Never deleted.
-- - travel.captures.shared, default false: every existing row stays unshared.
-- - tb_linked(p_other): true when the caller's link with p_other is live.
-- - tb_partner_add(p_uid), tb_partner_remove(p_uid): the caller's own direction only. Both
--   people must be rows in travel.people. Each returns the link state with p_uid.
-- - tb_partner_captures(): every capture visible to the caller from others: shared, not
--   deleted, owner linked live. Full set, no cursor, each with owner and owner_name.
-- - tb_can_read_photo(name): for the Storage policy. True when name is the photo_path of a
--   capture that is shared, not deleted, and whose owner is linked live to the caller.
--   Returns false (does not raise) with no auth.uid(), because it runs inside a policy.
-- Replaced, same signatures, grants re-stated:
-- - tb_whoami: also the caller's display_name and the other people with the link state
--   (none, added_by_me, added_me, live).
-- - tb_capture_upsert: carries shared. A row without the field (an app from before M1.2)
--   inserts false and, on update, keeps the stored value, so an older app's edit never
--   unshares or shares a capture. Rows of another owner are still rejected.
-- - tb_captures_since: own rows as before, now with owner (it was stripped).
-- - tb_journal_turn: the day's captures are the caller's own plus those visible to the caller
--   from a live partner, each with owner_name; photo_path only where the owner's
--   photo_to_claude is true. Also returns me { display_name, journal_prompt } so tb-journal
--   picks the prompt. The thread stays the caller's own.
-- - policy tb_photos_select (alter policy, not drop): own folder, or tb_can_read_photo(name).
--   tb_photos_insert and tb_photos_update stay own folder only.
begin;

create table travel.people (
  uid            uuid primary key references auth.users(id),
  display_name   text not null check (btrim(display_name) <> '' and char_length(display_name) <= 40),
  journal_prompt text not null check (journal_prompt ~ '^[a-z0-9-]+$')
);

create table travel.partner_adds (
  adder      uuid not null references auth.users(id),
  added      uuid not null references auth.users(id),
  added_at   timestamptz not null default now(),
  removed_at timestamptz,
  primary key (adder, added),
  check (adder <> added)
);

alter table travel.people enable row level security;
alter table travel.partner_adds enable row level security;

alter table travel.captures
  add column shared boolean not null default false;

-- The two travellers. Both auth users must exist (Gary created Eric in 7B.1).
do $people$
declare
  v_gary uuid := (select id from auth.users where email = 'gary@travelboard.local');
  v_eric uuid := (select id from auth.users where email = 'eric@travelboard.local');
begin
  if v_gary is null or v_eric is null then
    raise exception '0008: auth users gary@ and eric@travelboard.local must both exist';
  end if;
  insert into travel.people (uid, display_name, journal_prompt) values
    (v_gary, 'Gary', 'journal'),
    (v_eric, 'Eric', 'journal-eric');
end
$people$;

-- Live link between the caller and p_other: both directions added, neither removed.
create function public.tb_linked(p_other uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = travel, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return exists (select 1 from travel.partner_adds a
                  where a.adder = v_uid and a.added = p_other and a.removed_at is null)
     and exists (select 1 from travel.partner_adds b
                  where b.adder = p_other and b.added = v_uid and b.removed_at is null);
end;
$$;

-- The link state between the caller and each other person, in words the client shows.
-- Internal to the functions below: same guardrails, executable by authenticated.
create function public.tb_link_state(p_other uuid)
returns text
language plpgsql
stable
security definer
set search_path = travel, public
as $$
declare
  v_uid  uuid := auth.uid();
  v_mine boolean;
  v_them boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_mine := exists (select 1 from travel.partner_adds a where a.adder = v_uid and a.added = p_other and a.removed_at is null);
  v_them := exists (select 1 from travel.partner_adds b where b.adder = p_other and b.added = v_uid and b.removed_at is null);
  return case when v_mine and v_them then 'live' when v_mine then 'added_by_me' when v_them then 'added_me' else 'none' end;
end;
$$;

create or replace function public.tb_whoami()
returns jsonb
language plpgsql
security definer
set search_path = travel, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'uid', v_uid,
    'email', (select u.email from auth.users u where u.id = v_uid),
    'display_name', (select p.display_name from travel.people p where p.uid = v_uid),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('uid', p.uid, 'name', p.display_name,
                                          'link', public.tb_link_state(p.uid))
                       order by p.display_name, p.uid)
      from travel.people p where p.uid <> v_uid), '[]'::jsonb));
end;
$$;

create function public.tb_partner_add(p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = travel, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_uid is null or p_uid = v_uid or not exists (select 1 from travel.people p where p.uid = p_uid) then
    raise exception 'p_uid must be another person in travelboard' using errcode = '22023';
  end if;
  if not exists (select 1 from travel.people p where p.uid = v_uid) then
    raise exception 'caller is not a person in travelboard' using errcode = '42501';
  end if;
  insert into travel.partner_adds as a (adder, added, added_at, removed_at)
  values (v_uid, p_uid, now(), null)
  on conflict (adder, added) do update set
    added_at   = case when a.removed_at is null then a.added_at else now() end,
    removed_at = null;
  return jsonb_build_object('uid', p_uid, 'link', public.tb_link_state(p_uid));
end;
$$;

create function public.tb_partner_remove(p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = travel, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_uid is null or p_uid = v_uid or not exists (select 1 from travel.people p where p.uid = p_uid) then
    raise exception 'p_uid must be another person in travelboard' using errcode = '22023';
  end if;
  update travel.partner_adds a set removed_at = now()
   where a.adder = v_uid and a.added = p_uid and a.removed_at is null;
  return jsonb_build_object('uid', p_uid, 'link', public.tb_link_state(p_uid));
end;
$$;

-- Captures visible to the caller from others: shared, not deleted, owner linked live.
create function public.tb_partner_captures()
returns jsonb
language plpgsql
stable
security definer
set search_path = travel, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(c) || jsonb_build_object('owner_name', p.display_name) order by c.captured_at, c.id)
    from travel.captures c
    join travel.people p on p.uid = c.owner
    where c.owner <> v_uid and c.shared and c.deleted_at is null and public.tb_linked(c.owner)), '[]'::jsonb);
end;
$$;

-- Storage policy helper (tb_photos_select). name is '<owner>/<capture id>.jpg'; the capture
-- is found by id and must carry exactly this photo_path.
create function public.tb_can_read_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = travel, public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null or p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' then
    return false;
  end if;
  v_id := substring(p_name from 38 for 36)::uuid;
  return exists (select 1 from travel.captures c
                  where c.id = v_id and c.photo_path = p_name and c.owner <> v_uid
                    and c.shared and c.deleted_at is null and public.tb_linked(c.owner));
end;
$$;

create or replace function public.tb_capture_upsert(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = travel, public
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_kind   text;
  v_body   text;
  v_tz     text;
  v_photo  text;
  v_claude boolean;
  v_shared boolean;
  v_owner  uuid;
  v_ts     timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'capture must be a JSON object' using errcode = '22023';
  end if;

  v_id     := (p->>'id')::uuid;
  v_kind   := coalesce(p->>'kind', 'note');
  v_body   := coalesce(p->>'body', '');
  v_tz     := p->>'tz';
  v_photo  := p->>'photo_path';
  v_claude := (p->>'photo_to_claude')::boolean;   -- null when absent: see 0007
  v_shared := (p->>'shared')::boolean;            -- null when absent: see the header

  if v_id is null then
    raise exception 'id is required' using errcode = '22023';
  end if;
  if v_kind not in ('note', 'journal') then
    raise exception 'invalid kind: %', v_kind using errcode = '22023';
  end if;
  if char_length(v_body) > 20000 then
    raise exception 'body longer than 20000 characters' using errcode = '22023';
  end if;
  if v_tz is null or btrim(v_tz) = '' then
    raise exception 'tz is required' using errcode = '22023';
  end if;
  if v_photo is not null and v_photo <> v_uid::text || '/' || v_id::text || '.jpg' then
    raise exception 'photo_path must be %/%.jpg', v_uid, v_id using errcode = '22023';
  end if;

  select c.owner into v_owner from travel.captures c where c.id = v_id;
  if found and v_owner <> v_uid then
    raise exception 'capture % belongs to another user', v_id using errcode = '42501';
  end if;

  insert into travel.captures as c (
    id, owner, body, kind, captured_at, tz, local_date, lat, lng, accuracy_m,
    trip_id, place_id, photo_path, photo_w, photo_h, photo_bytes, photo_to_claude, shared,
    updated_at, deleted_at, server_ts)
  values (
    v_id, v_uid, v_body, v_kind,
    (p->>'captured_at')::timestamptz, v_tz, (p->>'local_date')::date,
    (p->>'lat')::double precision, (p->>'lng')::double precision, (p->>'accuracy_m')::real,
    (p->>'trip_id')::uuid, p->>'place_id',
    v_photo, (p->>'photo_w')::int, (p->>'photo_h')::int, (p->>'photo_bytes')::int, coalesce(v_claude, true),
    coalesce(v_shared, false),
    (p->>'updated_at')::timestamptz, (p->>'deleted_at')::timestamptz, now())
  on conflict (id) do update set
    body            = excluded.body,
    kind            = excluded.kind,
    captured_at     = excluded.captured_at,
    tz              = excluded.tz,
    local_date      = excluded.local_date,
    lat             = excluded.lat,
    lng             = excluded.lng,
    accuracy_m      = excluded.accuracy_m,
    trip_id         = excluded.trip_id,
    place_id        = excluded.place_id,
    photo_path      = excluded.photo_path,
    photo_w         = excluded.photo_w,
    photo_h         = excluded.photo_h,
    photo_bytes     = excluded.photo_bytes,
    photo_to_claude = coalesce(v_claude, c.photo_to_claude),
    shared          = coalesce(v_shared, c.shared),
    updated_at      = excluded.updated_at,
    deleted_at      = excluded.deleted_at,
    server_ts       = now()
  where c.owner = v_uid and c.updated_at < excluded.updated_at
  returning c.server_ts into v_ts;

  if v_ts is not null then
    return jsonb_build_object('id', v_id, 'applied', true, 'server_ts', v_ts);
  end if;

  -- Existing row is as new or newer: nothing written.
  select c.server_ts into v_ts from travel.captures c where c.id = v_id;
  return jsonb_build_object('id', v_id, 'applied', false, 'server_ts', v_ts);
end;
$$;

-- Pull by keyset cursor (server_ts, id), own rows only, now with owner.
create or replace function public.tb_captures_since(p_since_ts timestamptz default null, p_since_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = travel, public
as $$
declare
  v_uid  uuid := auth.uid();
  v_ts   timestamptz := coalesce(p_since_ts, '-infinity'::timestamptz);
  v_id   uuid := coalesce(p_since_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  with page as (
    select c.* from travel.captures c
    where c.owner = v_uid and (c.server_ts, c.id) > (v_ts, v_id)
    order by c.server_ts, c.id
    limit 500
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by page.server_ts, page.id), '[]'::jsonb)
    into v_rows from page;

  if jsonb_array_length(v_rows) = 0 then
    return jsonb_build_object('rows', v_rows,
      'next_cursor', jsonb_build_object('server_ts', p_since_ts, 'id', p_since_id));
  end if;

  return jsonb_build_object('rows', v_rows,
    'next_cursor', jsonb_build_object(
      'server_ts', v_rows->-1->'server_ts',
      'id',        v_rows->-1->'id'));
end;
$$;

-- tb-journal steps 2 to 4 (SPEC.md 8.3). As 0007, plus: the day's captures shared with the
-- caller by a live partner, each capture with owner_name, and me (display_name,
-- journal_prompt). The thread is the caller's own.
create or replace function public.tb_journal_turn(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = travel, public
as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_date    date;
  v_content text;
  v_created timestamptz;
  v_user    travel.journal_messages;
  v_reply   travel.journal_messages;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'turn must be a JSON object' using errcode = '22023';
  end if;
  v_id      := (p->>'message_id')::uuid;
  v_date    := (p->>'local_date')::date;
  v_content := coalesce(p->>'content', '');
  v_created := (p->>'created_at')::timestamptz;
  if v_id is null or v_date is null or v_created is null then
    raise exception 'message_id, local_date and created_at are required' using errcode = '22023';
  end if;
  if btrim(v_content) = '' then
    raise exception 'content is empty' using errcode = '22023';
  end if;
  if char_length(v_content) > 20000 then
    raise exception 'content longer than 20000 characters' using errcode = '22023';
  end if;

  select * into v_user from travel.journal_messages m where m.id = v_id;
  if found and (v_user.owner <> v_uid or v_user.role <> 'user') then
    raise exception 'message % belongs to another user or is not a user turn', v_id using errcode = '42501';
  end if;
  if not found then
    insert into travel.journal_messages (id, owner, local_date, role, content, created_at, server_ts)
    values (v_id, v_uid, v_date, 'user', v_content, v_created, now())
    on conflict (id) do nothing;
    select * into v_user from travel.journal_messages m where m.id = v_id;
    if v_user.owner <> v_uid or v_user.role <> 'user' then
      raise exception 'message % belongs to another user or is not a user turn', v_id using errcode = '42501';
    end if;
  end if;

  select * into v_reply from travel.journal_messages m
   where m.reply_to = v_id and m.role = 'assistant';
  if found then
    return jsonb_build_object('user', to_jsonb(v_user) - 'owner', 'reply', to_jsonb(v_reply) - 'owner');
  end if;

  return jsonb_build_object(
    'user', to_jsonb(v_user) - 'owner',
    'reply', null,
    'me', (select jsonb_build_object('display_name', pp.display_name, 'journal_prompt', pp.journal_prompt)
             from travel.people pp where pp.uid = v_uid),
    'thread', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content,
                                          'created_at', m.created_at)
                       order by coalesce(u.created_at, m.created_at), coalesce(u.id, m.id), m.role desc)
      from travel.journal_messages m
      left join travel.journal_messages u on u.id = m.reply_to and m.role = 'assistant'
      where m.owner = v_uid and m.local_date = v_user.local_date
        and (coalesce(u.created_at, m.created_at), coalesce(u.id, m.id))
            <= (v_user.created_at, v_user.id)), '[]'::jsonb),
    'captures', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'kind', c.kind,
                                          'captured_at', c.captured_at, 'tz', c.tz,
                                          'lat', c.lat, 'lng', c.lng, 'accuracy_m', c.accuracy_m,
                                          'photo_path', case when c.photo_to_claude then c.photo_path end,
                                          'owner_name', pp.display_name, 'own', c.owner = v_uid)
                       order by c.captured_at, c.id)
      from travel.captures c
      left join travel.people pp on pp.uid = c.owner
      where c.local_date = v_user.local_date and c.deleted_at is null
        and (c.owner = v_uid or (c.shared and public.tb_linked(c.owner)))), '[]'::jsonb));
end;
$$;

alter policy tb_photos_select on storage.objects
  using (bucket_id = 'tb-photos'
         and ((storage.foldername(name))[1] = (select auth.uid())::text
              or public.tb_can_read_photo(name)));

revoke all on function public.tb_linked(uuid)                         from public, anon;
revoke all on function public.tb_link_state(uuid)                     from public, anon;
revoke all on function public.tb_whoami()                             from public, anon;
revoke all on function public.tb_partner_add(uuid)                    from public, anon;
revoke all on function public.tb_partner_remove(uuid)                 from public, anon;
revoke all on function public.tb_partner_captures()                   from public, anon;
revoke all on function public.tb_can_read_photo(text)                 from public, anon;
revoke all on function public.tb_capture_upsert(jsonb)                from public, anon;
revoke all on function public.tb_captures_since(timestamptz, uuid)    from public, anon;
revoke all on function public.tb_journal_turn(jsonb)                  from public, anon;
grant execute on function public.tb_linked(uuid)                      to authenticated;
grant execute on function public.tb_link_state(uuid)                  to authenticated;
grant execute on function public.tb_whoami()                          to authenticated;
grant execute on function public.tb_partner_add(uuid)                 to authenticated;
grant execute on function public.tb_partner_remove(uuid)              to authenticated;
grant execute on function public.tb_partner_captures()                to authenticated;
grant execute on function public.tb_can_read_photo(text)              to authenticated;
grant execute on function public.tb_capture_upsert(jsonb)             to authenticated;
grant execute on function public.tb_captures_since(timestamptz, uuid) to authenticated;
grant execute on function public.tb_journal_turn(jsonb)               to authenticated;

commit;
