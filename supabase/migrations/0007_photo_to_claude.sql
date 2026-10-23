-- travelboard migration 0007: per-photo "Claude sees this" switch (SPEC.md D15, 7A.1)
-- Touches only schema travel and public.tb_* functions. No grants to anon.
-- travel.captures.photo_to_claude, default true. Replaced, same signatures, grants re-stated:
-- - tb_capture_upsert: carries photo_to_claude. A row without the field (an app from before
--   the switch) inserts true and, on update, keeps the stored value, so an older app's edit
--   never switches a photo back on.
-- - tb_journal_turn: returns photo_path only where photo_to_claude is true, so a switched-off
--   photo never reaches tb-journal.
-- tb_captures_since returns whole rows (c.*), so it carries the field unchanged.
begin;

alter table travel.captures
  add column photo_to_claude boolean not null default true;

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
  v_claude := (p->>'photo_to_claude')::boolean;   -- null when absent: see the header

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
    trip_id, place_id, photo_path, photo_w, photo_h, photo_bytes, photo_to_claude,
    updated_at, deleted_at, server_ts)
  values (
    v_id, v_uid, v_body, v_kind,
    (p->>'captured_at')::timestamptz, v_tz, (p->>'local_date')::date,
    (p->>'lat')::double precision, (p->>'lng')::double precision, (p->>'accuracy_m')::real,
    (p->>'trip_id')::uuid, p->>'place_id',
    v_photo, (p->>'photo_w')::int, (p->>'photo_h')::int, (p->>'photo_bytes')::int, coalesce(v_claude, true),
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

-- tb-journal steps 2 to 4 (SPEC.md 8.3), unchanged except that photo_path is returned only
-- for a photo switched on for Claude.
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
                                          'photo_path', case when c.photo_to_claude then c.photo_path end)
                       order by c.captured_at, c.id)
      from travel.captures c
      where c.owner = v_uid and c.local_date = v_user.local_date and c.deleted_at is null), '[]'::jsonb));
end;
$$;

-- create or replace keeps the existing ACL; re-stated so the file stands on its own.
revoke all on function public.tb_capture_upsert(jsonb) from public, anon;
revoke all on function public.tb_journal_turn(jsonb)   from public, anon;
grant execute on function public.tb_capture_upsert(jsonb) to authenticated;
grant execute on function public.tb_journal_turn(jsonb)   to authenticated;

commit;
