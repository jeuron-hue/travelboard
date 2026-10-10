-- travelboard migration 0004: journal RPCs (SPEC.md 8.2, 8.3)
-- Creates only public.tb_* functions. All SECURITY DEFINER, search_path travel, public,
-- execute revoked from public and anon, granted to authenticated, auth.uid() checked.
-- Client: tb_journal_day, tb_journal_days, tb_journal_day_suffix.
-- tb-journal Edge Function, called with the user's own JWT: tb_journal_turn, tb_journal_reply.
-- Thread order everywhere: user turns by (created_at, id), each reply straight after its turn.
begin;

-- One day's thread, in thread order, plus the day's title suffix.
create function public.tb_journal_day(p_local_date date)
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
  if p_local_date is null then
    raise exception 'local_date is required' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'local_date', p_local_date,
    'suffix', coalesce((select d.suffix from travel.journal_days d
                         where d.owner = v_uid and d.local_date = p_local_date), ''),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) - 'owner'
                       order by coalesce(u.created_at, m.created_at), coalesce(u.id, m.id), m.role desc)
      from travel.journal_messages m
      left join travel.journal_messages u on u.id = m.reply_to and m.role = 'assistant'
      where m.owner = v_uid and m.local_date = p_local_date), '[]'::jsonb));
end;
$$;

-- Days with journal activity, newest first: message count, latest server_ts (messages or
-- suffix) as the exact string the client compares to decide whether to re-fetch, suffix.
create function public.tb_journal_days(p_limit int default 400)
returns jsonb
language plpgsql
stable
security definer
set search_path = travel, public
as $$
declare
  v_uid uuid := auth.uid();
  v_lim int := least(greatest(coalesce(p_limit, 400), 1), 1000);
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'local_date', x.local_date, 'messages', x.messages,
             'last_server_ts', x.last_server_ts, 'suffix', x.suffix)
           order by x.local_date desc)
    from (
      select k.local_date,
             (select count(*) from travel.journal_messages m
               where m.owner = v_uid and m.local_date = k.local_date)::int as messages,
             greatest(
               (select max(m.server_ts) from travel.journal_messages m
                 where m.owner = v_uid and m.local_date = k.local_date),
               (select d.server_ts from travel.journal_days d
                 where d.owner = v_uid and d.local_date = k.local_date)) as last_server_ts,
             coalesce((select d.suffix from travel.journal_days d
                        where d.owner = v_uid and d.local_date = k.local_date), '') as suffix
      from (select m.local_date from travel.journal_messages m where m.owner = v_uid
            union
            select d.local_date from travel.journal_days d where d.owner = v_uid) k
      order by k.local_date desc
      limit v_lim
    ) x), '[]'::jsonb);
end;
$$;

-- Set the free-text title suffix for a day ('' clears it).
create function public.tb_journal_day_suffix(p_local_date date, p_suffix text)
returns jsonb
language plpgsql
security definer
set search_path = travel, public
as $$
declare
  v_uid    uuid := auth.uid();
  v_suffix text := btrim(coalesce(p_suffix, ''));
  v_ts     timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_local_date is null then
    raise exception 'local_date is required' using errcode = '22023';
  end if;
  if char_length(v_suffix) > 200 then
    raise exception 'suffix longer than 200 characters' using errcode = '22023';
  end if;
  insert into travel.journal_days as d (owner, local_date, suffix, server_ts)
  values (v_uid, p_local_date, v_suffix, now())
  on conflict (owner, local_date) do update set suffix = excluded.suffix, server_ts = now()
  returning d.server_ts into v_ts;
  return jsonb_build_object('local_date', p_local_date, 'suffix', v_suffix, 'server_ts', v_ts);
end;
$$;

-- tb-journal steps 2 to 4 (SPEC.md 8.3). Upsert the user turn by id (a retry changes
-- nothing). If a reply already exists, return it and nothing else. Otherwise return the
-- thread up to and including this turn, in thread order, and the day's live captures.
create function public.tb_journal_turn(p jsonb)
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
                                          'lat', c.lat, 'lng', c.lng, 'accuracy_m', c.accuracy_m)
                       order by c.captured_at, c.id)
      from travel.captures c
      where c.owner = v_uid and c.local_date = v_user.local_date and c.deleted_at is null), '[]'::jsonb));
end;
$$;

-- tb-journal step 7. Store the reply to a user turn, once. If a reply is already stored
-- (a concurrent retry got there first), keep it and return it.
create function public.tb_journal_reply(p jsonb)
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
                                            input_tokens, output_tokens, created_at, server_ts)
  values (gen_random_uuid(), v_uid, v_parent.local_date, 'assistant', v_content, v_parent.id,
          p->>'model', (p->>'input_tokens')::int, (p->>'output_tokens')::int, now(), now())
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

revoke all on function public.tb_journal_day(date)              from public, anon;
revoke all on function public.tb_journal_days(int)              from public, anon;
revoke all on function public.tb_journal_day_suffix(date, text) from public, anon;
revoke all on function public.tb_journal_turn(jsonb)            from public, anon;
revoke all on function public.tb_journal_reply(jsonb)           from public, anon;
grant execute on function public.tb_journal_day(date)              to authenticated;
grant execute on function public.tb_journal_days(int)              to authenticated;
grant execute on function public.tb_journal_day_suffix(date, text) to authenticated;
grant execute on function public.tb_journal_turn(jsonb)            to authenticated;
grant execute on function public.tb_journal_reply(jsonb)           to authenticated;

commit;
