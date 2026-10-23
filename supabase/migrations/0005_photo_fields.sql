-- travelboard migration 0005: photo fields on captures, cache tokens on replies (SPEC.md 7A.1)
-- Touches only schema travel and public.tb_* functions. No grants to anon.
-- travel.captures: photo_path, photo_w, photo_h, photo_bytes. photo_path is
-- '<owner uuid>/<capture id>.jpg' in bucket tb-photos, null when there is no photo or it has
-- not uploaded yet. travel.journal_messages: cache_write_tokens, cache_read_tokens (7A.4).
-- Replaced, same signatures, grants re-stated:
-- - tb_capture_upsert: carries the four photo fields; a photo_path must be the caller's
--   own '<uid>/<id>.jpg'.
-- - tb_journal_turn: each of the day's captures also carries photo_path, so tb-journal can
--   load the day's photos (7A.4).
-- - tb_journal_reply: stores cache_write_tokens and cache_read_tokens.
-- tb_captures_since is not replaced: it returns whole rows (c.*), so the new columns come
-- through as they are.
begin;

alter table travel.captures
  add column photo_path  text check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  add column photo_w     int  check (photo_w is null or photo_w > 0),
  add column photo_h     int  check (photo_h is null or photo_h > 0),
  add column photo_bytes int  check (photo_bytes is null or photo_bytes > 0);

alter table travel.journal_messages
  add column cache_write_tokens int,
  add column cache_read_tokens  int;

create or replace function public.tb_capture_upsert(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = travel, public
as $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_kind  text;
  v_body  text;
  v_tz    text;
  v_photo text;
  v_owner uuid;
  v_ts    timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'capture must be a JSON object' using errcode = '22023';
  end if;

  v_id    := (p->>'id')::uuid;
  v_kind  := coalesce(p->>'kind', 'note');
  v_body  := coalesce(p->>'body', '');
  v_tz    := p->>'tz';
  v_photo := p->>'photo_path';

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
    trip_id, place_id, photo_path, photo_w, photo_h, photo_bytes, updated_at, deleted_at, server_ts)
  values (
    v_id, v_uid, v_body, v_kind,
    (p->>'captured_at')::timestamptz, v_tz, (p->>'local_date')::date,
    (p->>'lat')::double precision, (p->>'lng')::double precision, (p->>'accuracy_m')::real,
    (p->>'trip_id')::uuid, p->>'place_id',
    v_photo, (p->>'photo_w')::int, (p->>'photo_h')::int, (p->>'photo_bytes')::int,
    (p->>'updated_at')::timestamptz, (p->>'deleted_at')::timestamptz, now())
  on conflict (id) do update set
    body        = excluded.body,
    kind        = excluded.kind,
    captured_at = excluded.captured_at,
    tz          = excluded.tz,
    local_date  = excluded.local_date,
    lat         = excluded.lat,
    lng         = excluded.lng,
    accuracy_m  = excluded.accuracy_m,
    trip_id     = excluded.trip_id,
    place_id    = excluded.place_id,
    photo_path  = excluded.photo_path,
    photo_w     = excluded.photo_w,
    photo_h     = excluded.photo_h,
    photo_bytes = excluded.photo_bytes,
    updated_at  = excluded.updated_at,
    deleted_at  = excluded.deleted_at,
    server_ts   = now()
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

-- tb-journal steps 2 to 4 (SPEC.md 8.3), unchanged except that each capture carries photo_path.
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
                                          'photo_path', c.photo_path)
                       order by c.captured_at, c.id)
      from travel.captures c
      where c.owner = v_uid and c.local_date = v_user.local_date and c.deleted_at is null), '[]'::jsonb));
end;
$$;

-- tb-journal step 7, unchanged except that it also stores the cache token counts.
create or replace function public.tb_journal_reply(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = travel, public
as $$
declare
  v_uid     uuid := auth.uid();
  v_parent  travel.journal_messages;
  v_reply   travel.journal_messages;
  v_content text;
  v_new     boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'reply must be a JSON object' using errcode = '22023';
  end if;
  v_content := coalesce(p->>'content', '');
  if btrim(v_content) = '' then
    raise exception 'content is empty' using errcode = '22023';
  end if;
  if char_length(v_content) > 20000 then
    raise exception 'content longer than 20000 characters' using errcode = '22023';
  end if;
  select * into v_parent from travel.journal_messages m where m.id = (p->>'reply_to')::uuid;
  if not found or v_parent.owner <> v_uid or v_parent.role <> 'user' then
    raise exception 'reply_to is not one of your user turns' using errcode = '22023';
  end if;

  insert into travel.journal_messages as m (id, owner, local_date, role, content, reply_to, model,
                                            input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
                                            created_at, server_ts)
  values (gen_random_uuid(), v_uid, v_parent.local_date, 'assistant', v_content, v_parent.id,
          p->>'model', (p->>'input_tokens')::int, (p->>'output_tokens')::int,
          (p->>'cache_write_tokens')::int, (p->>'cache_read_tokens')::int, now(), now())
  on conflict (reply_to) where role = 'assistant' do nothing
  returning * into v_reply;
  v_new := found;
  if not v_new then
    select * into v_reply from travel.journal_messages m
     where m.reply_to = v_parent.id and m.role = 'assistant';
  end if;
  return jsonb_build_object('reply', to_jsonb(v_reply) - 'owner', 'inserted', v_new);
end;
$$;

-- create or replace keeps the existing ACL; re-stated so the file stands on its own.
revoke all on function public.tb_capture_upsert(jsonb) from public, anon;
revoke all on function public.tb_journal_turn(jsonb)   from public, anon;
revoke all on function public.tb_journal_reply(jsonb)  from public, anon;
grant execute on function public.tb_capture_upsert(jsonb) to authenticated;
grant execute on function public.tb_journal_turn(jsonb)   to authenticated;
grant execute on function public.tb_journal_reply(jsonb)  to authenticated;

commit;
