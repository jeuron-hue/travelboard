-- travelboard migration 0002: client RPCs (SPEC.md 6.3)
-- Creates only public.tb_* functions. All SECURITY DEFINER, search_path travel, public,
-- execute revoked from public and anon, granted to authenticated, auth.uid() checked.
-- Applied 04/10/26 as Supabase migration tb_0002_rpcs.
begin;

-- Gate check for the client.
create function public.tb_whoami()
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
    'email', (select u.email from auth.users u where u.id = v_uid));
end;
$$;

-- One capture. Insert, or update only if the incoming updated_at is newer (last-write-wins).
-- Retrying the same row any number of times leaves one row.
create function public.tb_capture_upsert(p jsonb)
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
  v_owner uuid;
  v_ts    timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'capture must be a JSON object' using errcode = '22023';
  end if;

  v_id   := (p->>'id')::uuid;
  v_kind := coalesce(p->>'kind', 'note');
  v_body := coalesce(p->>'body', '');
  v_tz   := p->>'tz';

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

  select c.owner into v_owner from travel.captures c where c.id = v_id;
  if found and v_owner <> v_uid then
    raise exception 'capture % belongs to another user', v_id using errcode = '42501';
  end if;

  insert into travel.captures as c (
    id, owner, body, kind, captured_at, tz, local_date, lat, lng, accuracy_m,
    trip_id, place_id, updated_at, deleted_at, server_ts)
  values (
    v_id, v_uid, v_body, v_kind,
    (p->>'captured_at')::timestamptz, v_tz, (p->>'local_date')::date,
    (p->>'lat')::double precision, (p->>'lng')::double precision, (p->>'accuracy_m')::real,
    (p->>'trip_id')::uuid, p->>'place_id',
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

-- Batch wrapper: one transaction, results in input order.
create function public.tb_captures_upsert(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = travel, public
as $$
declare
  v_out  jsonb := '[]'::jsonb;
  v_item jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'batch must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p) > 200 then
    raise exception 'batch larger than 200 rows' using errcode = '22023';
  end if;
  for v_item in select e from jsonb_array_elements(p) as t(e) loop
    v_out := v_out || jsonb_build_array(public.tb_capture_upsert(v_item));
  end loop;
  return v_out;
end;
$$;

-- Pull by keyset cursor (server_ts, id). Null cursor means from the start.
-- Soft-deleted rows are included so deletes propagate.
create function public.tb_captures_since(p_since_ts timestamptz default null, p_since_id uuid default null)
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
  select coalesce(jsonb_agg(to_jsonb(page) - 'owner' order by page.server_ts, page.id), '[]'::jsonb)
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

revoke all on function public.tb_whoami()                             from public, anon;
revoke all on function public.tb_capture_upsert(jsonb)                from public, anon;
revoke all on function public.tb_captures_upsert(jsonb)               from public, anon;
revoke all on function public.tb_captures_since(timestamptz, uuid)    from public, anon;
grant execute on function public.tb_whoami()                          to authenticated;
grant execute on function public.tb_capture_upsert(jsonb)             to authenticated;
grant execute on function public.tb_captures_upsert(jsonb)            to authenticated;
grant execute on function public.tb_captures_since(timestamptz, uuid) to authenticated;

commit;
