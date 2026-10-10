-- travelboard smoke tests (SPEC.md 11). Run through the Supabase connector as postgres.
-- Tests 1 to 11 cover M0 (migrations 0001, 0002); J1 to J12 cover M2 (migrations 0003, 0004).
-- Everything runs in one transaction that is rolled back: no rows are left behind.
-- Acts as Gary's auth user (the single user, gary@travelboard.local) by setting
-- role and request.jwt.claims the way PostgREST does.
-- Output: one row per test, name and PASS/FAIL with detail. Every row must be PASS.
begin;

do $smoke$
declare
  v_uid    uuid := (select id from auth.users where email = 'gary@travelboard.local');
  v_claims text;
  r        jsonb := '[]'::jsonb;
  v        jsonb;
  v_state  text;
  v_n      int;
  v_id     uuid := gen_random_uuid();
  v_ids    uuid[] := '{}';
  v_t1     timestamptz := '2026-10-04 01:00:00+00';
  v_t2     timestamptz := '2026-10-04 02:00:00+00';
  v_t3     timestamptz := '2026-10-04 03:00:00+00';
  v_cur_ts timestamptz;
  v_cur_id uuid;
  v_seen   uuid[] := '{}';
  v_pages  int := 0;
  f        text;
begin
  if v_uid is null then
    raise exception 'smoke: auth user gary@travelboard.local not found';
  end if;
  v_claims := json_build_object('sub', v_uid, 'role', 'authenticated')::text;

  -- 1. anon cannot execute any tb_ function
  foreach f in array array[
      'select public.tb_whoami()',
      'select public.tb_capture_upsert(''{}''::jsonb)',
      'select public.tb_captures_upsert(''[]''::jsonb)',
      'select public.tb_captures_since(null, null)'] loop
    begin
      set local role anon;
      execute f;
      reset role;
      r := r || jsonb_build_object('test', 'anon denied: ' || f, 'pass', false, 'detail', 'call succeeded');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      r := r || jsonb_build_object('test', 'anon denied: ' || f, 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;

  -- 2. anon and authenticated cannot read travel.captures directly
  foreach f in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', f);
      perform set_config('request.jwt.claims', case when f = 'authenticated' then v_claims else '' end, true);
      perform 1 from travel.captures limit 1;
      reset role;
      r := r || jsonb_build_object('test', f || ' direct table read denied', 'pass', false, 'detail', 'select succeeded');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      r := r || jsonb_build_object('test', f || ' direct table read denied', 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;

  -- 3. authenticated role without a user id is rejected by the auth.uid() check
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    perform public.tb_whoami();
    reset role;
    r := r || jsonb_build_object('test', 'null auth.uid() rejected', 'pass', false, 'detail', 'call succeeded');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    r := r || jsonb_build_object('test', 'null auth.uid() rejected', 'pass', sqlerrm = 'not authenticated', 'detail', v_state || ' ' || sqlerrm);
  end;

  -- From here on act as Gary.
  set local role authenticated;
  perform set_config('request.jwt.claims', v_claims, true);

  -- 4. whoami
  v := public.tb_whoami();
  r := r || jsonb_build_object('test', 'whoami returns uid and email',
         'pass', (v->>'uid')::uuid = v_uid and v->>'email' = 'gary@travelboard.local', 'detail', v);

  -- 5. insert, then identical retry: one row, second call not applied
  v := public.tb_capture_upsert(jsonb_build_object('id', v_id, 'body', 'first', 'kind', 'note',
         'captured_at', v_t1, 'tz', 'Asia/Singapore', 'local_date', '2026-10-04', 'updated_at', v_t2));
  r := r || jsonb_build_object('test', 'upsert new row applied', 'pass', (v->>'applied')::boolean, 'detail', v);
  v := public.tb_capture_upsert(jsonb_build_object('id', v_id, 'body', 'first', 'kind', 'note',
         'captured_at', v_t1, 'tz', 'Asia/Singapore', 'local_date', '2026-10-04', 'updated_at', v_t2));
  reset role;
  select count(*) into v_n from travel.captures where id = v_id;
  set local role authenticated;
  r := r || jsonb_build_object('test', 'identical retry: not applied, one row',
         'pass', not (v->>'applied')::boolean and v_n = 1, 'detail', jsonb_build_object('resp', v, 'rows', v_n));

  -- 6. older updated_at does not overwrite newer
  v := public.tb_capture_upsert(jsonb_build_object('id', v_id, 'body', 'older', 'kind', 'journal',
         'captured_at', v_t1, 'tz', 'Asia/Singapore', 'local_date', '2026-10-04', 'updated_at', v_t1));
  reset role;
  select count(*) into v_n from travel.captures where id = v_id and body = 'first' and kind = 'note';
  set local role authenticated;
  r := r || jsonb_build_object('test', 'older updated_at ignored',
         'pass', not (v->>'applied')::boolean and v_n = 1, 'detail', v);

  -- 7. newer updated_at wins, including a soft delete
  v := public.tb_capture_upsert(jsonb_build_object('id', v_id, 'body', 'newer', 'kind', 'journal',
         'captured_at', v_t1, 'tz', 'Asia/Singapore', 'local_date', '2026-10-04', 'updated_at', v_t3,
         'deleted_at', v_t3));
  reset role;
  select count(*) into v_n from travel.captures
   where id = v_id and body = 'newer' and kind = 'journal' and deleted_at = v_t3 and owner = v_uid;
  set local role authenticated;
  r := r || jsonb_build_object('test', 'newer updated_at applied (with deleted_at)',
         'pass', (v->>'applied')::boolean and v_n = 1, 'detail', v);

  -- 8. validation
  foreach f in array array['{"kind":"bogus"}', '{"tz":""}', '{"tz":null}', '{"body":"LONG"}', '{"id":null}'] loop
    begin
      v := jsonb_build_object('id', gen_random_uuid(), 'body', '', 'kind', 'note', 'captured_at', v_t1,
             'tz', 'Asia/Singapore', 'local_date', '2026-10-04', 'updated_at', v_t1) || f::jsonb;
      if v->>'body' = 'LONG' then v := v || jsonb_build_object('body', repeat('x', 20001)); end if;
      perform public.tb_capture_upsert(v);
      r := r || jsonb_build_object('test', 'rejects ' || f, 'pass', false, 'detail', 'accepted');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      r := r || jsonb_build_object('test', 'rejects ' || f, 'pass', v_state = '22023', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;

  -- 9. batch wrapper returns one result per row, in order
  v := public.tb_captures_upsert(jsonb_build_array(
         jsonb_build_object('id', '00000000-0000-4000-8000-000000000001', 'captured_at', v_t1, 'tz', 'Asia/Bangkok', 'local_date', '2026-10-04', 'updated_at', v_t1),
         jsonb_build_object('id', '00000000-0000-4000-8000-000000000002', 'captured_at', v_t1, 'tz', 'Asia/Bangkok', 'local_date', '2026-10-04', 'updated_at', v_t1),
         jsonb_build_object('id', v_id, 'body', 'stale', 'captured_at', v_t1, 'tz', 'Asia/Bangkok', 'local_date', '2026-10-04', 'updated_at', v_t1)));
  r := r || jsonb_build_object('test', 'batch: 3 results in order, stale row not applied',
         'pass', jsonb_array_length(v) = 3
                 and v->0->>'id' = '00000000-0000-4000-8000-000000000001' and (v->0->>'applied')::boolean
                 and (v->1->>'applied')::boolean and not (v->2->>'applied')::boolean,
         'detail', v);

  -- 10. batch larger than 200 rejected
  begin
    perform public.tb_captures_upsert((select jsonb_agg('{}'::jsonb) from generate_series(1, 201)));
    r := r || jsonb_build_object('test', 'batch over 200 rejected', 'pass', false, 'detail', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r := r || jsonb_build_object('test', 'batch over 200 rejected', 'pass', v_state = '22023', 'detail', sqlerrm);
  end;

  -- 11. pull with keyset cursor across a page boundary where every row shares one server_ts
  --     (this whole script is one transaction, so now() is the same for all of it).
  v_ids := array[v_id, '00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000002'::uuid];
  for v_n in 1..520 loop
    v_ids := v_ids || gen_random_uuid();
    perform public.tb_capture_upsert(jsonb_build_object('id', v_ids[array_length(v_ids, 1)],
      'captured_at', v_t1, 'tz', 'Asia/Singapore', 'local_date', '2026-10-04', 'updated_at', v_t1));
  end loop;
  v_cur_ts := null; v_cur_id := null;
  loop
    v := public.tb_captures_since(v_cur_ts, v_cur_id);
    exit when jsonb_array_length(v->'rows') = 0;
    v_pages := v_pages + 1;
    if jsonb_array_length(v->'rows') > 500 then
      r := r || jsonb_build_object('test', 'page size <= 500', 'pass', false, 'detail', jsonb_array_length(v->'rows'));
    end if;
    v_seen := v_seen || array(select (e->>'id')::uuid from jsonb_array_elements(v->'rows') e);
    v_cur_ts := (v->'next_cursor'->>'server_ts')::timestamptz;
    v_cur_id := (v->'next_cursor'->>'id')::uuid;
    exit when v_pages > 50;
  end loop;
  r := r || jsonb_build_object('test', 'pull: all 523 test rows seen exactly once across pages (shared server_ts)',
         'pass', (select count(*) from unnest(v_ids) i where i = any(v_seen)) = 523
                 and cardinality(v_seen) = (select count(distinct s) from unnest(v_seen) s)
                 and v_pages >= 2,
         'detail', jsonb_build_object('pages', v_pages, 'seen', cardinality(v_seen)));
  r := r || jsonb_build_object('test', 'pull: soft-deleted row included',
         'pass', v_id = any(v_seen), 'detail', v_id);
  r := r || jsonb_build_object('test', 'pull: rows omit owner',
         'pass', not ((public.tb_captures_since(null, null))->'rows'->0 ? 'owner'), 'detail', null);
  v := public.tb_captures_since(v_cur_ts, v_cur_id);
  r := r || jsonb_build_object('test', 'pull: empty page echoes the cursor',
         'pass', jsonb_array_length(v->'rows') = 0
                 and (v->'next_cursor'->>'server_ts')::timestamptz = v_cur_ts
                 and (v->'next_cursor'->>'id')::uuid = v_cur_id,
         'detail', v->'next_cursor');
  v := public.tb_captures_since(null, null);
  reset role;
  select count(*) into v_n from travel.captures
   where id = (v->'rows'->0->>'id')::uuid and server_ts = (v->'rows'->0->>'server_ts')::timestamptz;
  set local role authenticated;
  r := r || jsonb_build_object('test', 'pull: server_ts string round-trips exactly (microseconds kept)',
         'pass', v_n = 1, 'detail', v->'rows'->0->'server_ts');

  -- ================= M2 journal (migrations 0003, 0004). Test day 2000-01-01 holds no real rows.
  reset role;

  -- J1. anon cannot execute any journal function
  foreach f in array array[
      'select public.tb_journal_day(''2000-01-01'')',
      'select public.tb_journal_days(10)',
      'select public.tb_journal_day_suffix(''2000-01-01'', ''x'')',
      'select public.tb_journal_turn(''{}''::jsonb)',
      'select public.tb_journal_reply(''{}''::jsonb)'] loop
    begin
      set local role anon;
      execute f;
      reset role;
      r := r || jsonb_build_object('test', 'J1 anon denied: ' || f, 'pass', false, 'detail', 'call succeeded');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      r := r || jsonb_build_object('test', 'J1 anon denied: ' || f, 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;

  -- J2. anon and authenticated cannot read the journal tables directly
  foreach f in array array['anon:journal_messages', 'anon:journal_days', 'authenticated:journal_messages', 'authenticated:journal_days'] loop
    begin
      execute format('set local role %I', split_part(f, ':', 1));
      perform set_config('request.jwt.claims', case when f like 'authenticated%' then v_claims else '' end, true);
      execute format('select 1 from travel.%I limit 1', split_part(f, ':', 2));
      reset role;
      r := r || jsonb_build_object('test', 'J2 direct read denied ' || f, 'pass', false, 'detail', 'select succeeded');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      r := r || jsonb_build_object('test', 'J2 direct read denied ' || f, 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;

  -- J3. every journal function: SECURITY DEFINER, search_path travel, public, no anon or PUBLIC execute
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'tb\_journal%' and p.prosecdef
     and p.proconfig = array['search_path=travel, public']
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0);
  r := r || jsonb_build_object('test', 'J3 5 journal functions: definer, search_path, grants', 'pass', v_n = 5, 'detail', v_n);

  -- Two captures on the test day: one live, one soft-deleted. Act as Gary from here.
  set local role authenticated;
  perform set_config('request.jwt.claims', v_claims, true);
  perform public.tb_captures_upsert(jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000c1', 'body', 'live capture', 'kind', 'journal',
      'captured_at', '2000-01-01 06:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-01',
      'lat', 13.7, 'lng', 100.5, 'updated_at', '2000-01-01 06:00:00+00'),
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000c2', 'body', 'deleted capture', 'kind', 'note',
      'captured_at', '2000-01-01 07:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-01',
      'updated_at', '2000-01-01 07:00:00+00', 'deleted_at', '2000-01-01 07:00:00+00')));

  -- J4. a new turn: stored, no reply, thread is just this turn, live captures only
  v := public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000a1',
         'local_date', '2000-01-01', 'content', 'first turn', 'created_at', '2000-01-01 12:00:00+00'));
  r := r || jsonb_build_object('test', 'J4 new turn: no reply, thread of 1, 1 live capture',
         'pass', v->'reply' = 'null'::jsonb and jsonb_array_length(v->'thread') = 1
                 and v->'thread'->0->>'content' = 'first turn'
                 and jsonb_array_length(v->'captures') = 1 and v->'captures'->0->>'body' = 'live capture'
                 and not (v->'user' ? 'owner'),
         'detail', v);

  -- J5. the same turn again: one row, content unchanged even if the retry differs
  v := public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000a1',
         'local_date', '2000-01-01', 'content', 'changed on retry', 'created_at', '2000-01-01 12:00:00+00'));
  reset role;
  select count(*) into v_n from travel.journal_messages where id = '00000000-0000-4000-8000-0000000000a1' and content = 'first turn';
  set local role authenticated;
  r := r || jsonb_build_object('test', 'J5 turn retry: one row, unchanged', 'pass', v_n = 1, 'detail', v_n);

  -- J6. reply stored once; a second reply for the same turn returns the first
  v := public.tb_journal_reply(jsonb_build_object('reply_to', '00000000-0000-4000-8000-0000000000a1',
         'content', 'reply one', 'model', 'claude-sonnet-5-5', 'input_tokens', 100, 'output_tokens', 20));
  r := r || jsonb_build_object('test', 'J6 reply inserted with model and tokens',
         'pass', (v->>'inserted')::boolean and v->'reply'->>'role' = 'assistant' and v->'reply'->>'model' = 'claude-sonnet-5-5'
                 and (v->'reply'->>'input_tokens')::int = 100 and v->'reply'->>'local_date' = '2000-01-01',
         'detail', v);
  v := public.tb_journal_reply(jsonb_build_object('reply_to', '00000000-0000-4000-8000-0000000000a1',
         'content', 'reply two', 'model', 'claude-sonnet-5-5', 'input_tokens', 1, 'output_tokens', 1));
  reset role;
  select count(*) into v_n from travel.journal_messages where reply_to = '00000000-0000-4000-8000-0000000000a1';
  set local role authenticated;
  r := r || jsonb_build_object('test', 'J6 second reply: not inserted, first kept, one assistant row',
         'pass', not (v->>'inserted')::boolean and v->'reply'->>'content' = 'reply one' and v_n = 1, 'detail', v);

  -- J7. retrying a turn that has a reply returns the stored reply and no context
  v := public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000a1',
         'local_date', '2000-01-01', 'content', 'first turn', 'created_at', '2000-01-01 12:00:00+00'));
  r := r || jsonb_build_object('test', 'J7 turn with a reply returns it, no thread',
         'pass', v->'reply'->>'content' = 'reply one' and not (v ? 'thread'), 'detail', v);

  -- J8. thread order: a later turn sees turn 1 then its reply; an older turn sent late sees only itself
  v := public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000a2',
         'local_date', '2000-01-01', 'content', 'second turn', 'created_at', '2000-01-01 13:00:00+00'));
  r := r || jsonb_build_object('test', 'J8 thread for turn 2: turn 1, reply 1, turn 2',
         'pass', jsonb_array_length(v->'thread') = 3 and v->'thread'->0->>'content' = 'first turn'
                 and v->'thread'->1->>'content' = 'reply one' and v->'thread'->2->>'content' = 'second turn',
         'detail', v->'thread');
  v := public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000a0',
         'local_date', '2000-01-01', 'content', 'queued earlier', 'created_at', '2000-01-01 11:00:00+00'));
  r := r || jsonb_build_object('test', 'J8 thread for an older turn sent late: only itself',
         'pass', jsonb_array_length(v->'thread') = 1 and v->'thread'->0->>'content' = 'queued earlier',
         'detail', v->'thread');
  v := public.tb_journal_day('2000-01-01');
  r := r || jsonb_build_object('test', 'J8 tb_journal_day order: queued earlier, first turn, reply one, second turn',
         'pass', jsonb_array_length(v->'messages') = 4
                 and v->'messages'->0->>'content' = 'queued earlier' and v->'messages'->1->>'content' = 'first turn'
                 and v->'messages'->2->>'content' = 'reply one' and v->'messages'->3->>'content' = 'second turn'
                 and not (v->'messages'->0 ? 'owner'),
         'detail', v);

  -- J9. suffix and day list
  v := public.tb_journal_day_suffix('2000-01-01', '  Bangkok day 1  ');
  v := public.tb_journal_days(1000);
  select e into v from jsonb_array_elements(v) e where e->>'local_date' = '2000-01-01';
  r := r || jsonb_build_object('test', 'J9 days: test day with 4 messages, trimmed suffix, last_server_ts',
         'pass', (v->>'messages')::int = 4 and v->>'suffix' = 'Bangkok day 1' and v->>'last_server_ts' is not null,
         'detail', v);
  v := public.tb_journal_day('2000-01-01');
  r := r || jsonb_build_object('test', 'J9 tb_journal_day carries the suffix', 'pass', v->>'suffix' = 'Bangkok day 1', 'detail', v->'suffix');

  -- J10. validation
  foreach f in array array[
      'select public.tb_journal_turn(''{"message_id":"00000000-0000-4000-8000-0000000000b1","local_date":"2000-01-01","content":"   ","created_at":"2000-01-01T00:00:00Z"}'')',
      'select public.tb_journal_turn(''{"message_id":"00000000-0000-4000-8000-0000000000b1","local_date":"2000-01-01","content":"x"}'')',
      'select public.tb_journal_turn(''[]'')',
      'select public.tb_journal_reply(''{"reply_to":"00000000-0000-4000-8000-0000000000ff","content":"x"}'')',
      'select public.tb_journal_reply(''{"reply_to":"00000000-0000-4000-8000-0000000000a1","content":""}'')',
      'select public.tb_journal_day_suffix(''2000-01-01'', repeat(''x'', 201))'] loop
    begin
      execute f;
      r := r || jsonb_build_object('test', 'J10 rejects ' || f, 'pass', false, 'detail', 'accepted');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      r := r || jsonb_build_object('test', 'J10 rejects ' || f, 'pass', v_state = '22023', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;

  -- J11. a reply cannot answer an assistant row; a turn cannot reuse a reply's id
  begin
    reset role;
    select id into v_id from travel.journal_messages where reply_to = '00000000-0000-4000-8000-0000000000a1';
    set local role authenticated;
    perform public.tb_journal_reply(jsonb_build_object('reply_to', v_id, 'content', 'x'));
    r := r || jsonb_build_object('test', 'J11 reply to an assistant row rejected', 'pass', false, 'detail', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r := r || jsonb_build_object('test', 'J11 reply to an assistant row rejected', 'pass', v_state = '22023', 'detail', sqlerrm);
  end;
  begin
    perform public.tb_journal_turn(jsonb_build_object('message_id', v_id, 'local_date', '2000-01-01',
      'content', 'x', 'created_at', '2000-01-01 00:00:00+00'));
    r := r || jsonb_build_object('test', 'J11 turn reusing a reply id rejected', 'pass', false, 'detail', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r := r || jsonb_build_object('test', 'J11 turn reusing a reply id rejected', 'pass', v_state = '42501', 'detail', sqlerrm);
  end;

  -- J12. token usage is a SQL query away (SPEC.md 8.6)
  reset role;
  select coalesce(sum(input_tokens), 0) into v_n from travel.journal_messages
   where role = 'assistant' and local_date = '2000-01-01';
  r := r || jsonb_build_object('test', 'J12 token sum by day', 'pass', v_n = 100, 'detail', v_n);

  reset role;
  perform set_config('smoke.results', r::text, true);
end
$smoke$;

select t.ordinality as n, case when (t.e->>'pass')::boolean then 'PASS' else 'FAIL' end as result,
       t.e->>'test' as test, left((t.e->'detail')::text, 160) as detail
from jsonb_array_elements(current_setting('smoke.results')::jsonb) with ordinality as t(e, ordinality)
order by n;

rollback;
