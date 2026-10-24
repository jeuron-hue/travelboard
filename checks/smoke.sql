-- travelboard smoke tests (SPEC.md 11). Run through the Supabase connector as postgres.
-- Tests 1 to 11 cover M0 (migrations 0001, 0002); J1 to J12 cover M2 (migrations 0003, 0004);
-- P1 to P10 cover M1.1 (migrations 0005, 0006: photo fields, bucket tb-photos and its policies),
-- including a second synthetic uid that exists only in the request claims; P11 to P13 cover the
-- "Claude sees this" switch (migration 0007, SPEC.md 7A.6 item 11). T1 to T14 cover M1.2 (migration
-- 0008, SPEC.md 7B.5 items 1, 6, 7, 9 and the RPC side of 2, 4, 5, 8, 10) with three synthetic
-- users A, B and C inserted into auth.users and travel.people inside the transaction, so the
-- real link between Gary and Eric is never touched or relied on.
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
  v_other  uuid := gen_random_uuid();          -- a second synthetic user, claims only
  v_oclaims text;
  v_pid    uuid := '00000000-0000-4000-8000-0000000000d1';
  v_a      uuid := gen_random_uuid();          -- M1.2: synthetic travellers A, B, C (rolled back)
  v_b      uuid := gen_random_uuid();
  v_c      uuid := gen_random_uuid();
  v_ca     text;
  v_cb     text;
  v_cc     text;
  v_sh     uuid := '00000000-0000-4000-8000-0000000000a5';   -- A's shared capture with a photo
  v_un     uuid := '00000000-0000-4000-8000-0000000000a6';   -- A's unshared capture with a photo
  v_off    uuid := '00000000-0000-4000-8000-0000000000a7';   -- A's shared capture, photo switched off for Claude
  v_del    uuid := '00000000-0000-4000-8000-0000000000a8';   -- A's shared capture, deleted
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
  r := r || jsonb_build_object('test', 'pull: rows carry owner, the caller (0008)',
         'pass', ((public.tb_captures_since(null, null))->'rows'->0->>'owner')::uuid = v_uid, 'detail', null);
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

  -- ================= M1.1 photos (migrations 0005, 0006). Test day 2000-01-02 holds no real rows.
  reset role;
  v_oclaims := json_build_object('sub', v_other, 'role', 'authenticated')::text;
  set local role authenticated;
  perform set_config('request.jwt.claims', v_claims, true);

  -- P1. photo fields round-trip through upsert and pull
  v := public.tb_capture_upsert(jsonb_build_object('id', v_pid, 'body', '', 'kind', 'note',
         'captured_at', '2000-01-02 06:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-02',
         'updated_at', '2000-01-02 06:00:00+00', 'photo_path', v_uid::text || '/' || v_pid::text || '.jpg',
         'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 245000));
  select e into v from jsonb_array_elements((public.tb_captures_since(null, null))->'rows') e where (e->>'id')::uuid = v_pid;
  r := r || jsonb_build_object('test', 'P1 photo fields stored and pulled (photo-only capture)',
         'pass', v->>'photo_path' = v_uid::text || '/' || v_pid::text || '.jpg' and (v->>'photo_w')::int = 1280
                 and (v->>'photo_h')::int = 960 and (v->>'photo_bytes')::int = 245000 and v->>'body' = '', 'detail', v);
  -- P2. a photo_path that is not the caller's own <uid>/<id>.jpg is rejected
  foreach f in array array[v_other::text || '/' || v_pid::text || '.jpg', v_uid::text || '/' || gen_random_uuid()::text || '.jpg', 'x.jpg'] loop
    begin
      perform public.tb_capture_upsert(jsonb_build_object('id', v_pid, 'body', 'x', 'kind', 'note',
        'captured_at', '2000-01-02 06:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-02',
        'updated_at', '2000-01-02 07:00:00+00', 'photo_path', f));
      r := r || jsonb_build_object('test', 'P2 rejects photo_path ' || left(f, 12), 'pass', false, 'detail', 'accepted');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      r := r || jsonb_build_object('test', 'P2 rejects photo_path ' || left(f, 12), 'pass', v_state = '22023', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;
  -- P3. Remove: a newer row with null photo fields clears them
  v := public.tb_capture_upsert(jsonb_build_object('id', v_pid, 'body', 'removed', 'kind', 'note',
         'captured_at', '2000-01-02 06:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-02',
         'updated_at', '2000-01-02 08:00:00+00'));
  reset role;
  select count(*) into v_n from travel.captures where id = v_pid and photo_path is null and photo_w is null and photo_bytes is null;
  set local role authenticated;
  r := r || jsonb_build_object('test', 'P3 removing the photo clears the four fields', 'pass', (v->>'applied')::boolean and v_n = 1, 'detail', v);
  perform public.tb_capture_upsert(jsonb_build_object('id', v_pid, 'body', 'with photo', 'kind', 'note',
    'captured_at', '2000-01-02 06:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-02',
    'updated_at', '2000-01-02 09:00:00+00', 'photo_path', v_uid::text || '/' || v_pid::text || '.jpg',
    'photo_w', 960, 'photo_h', 1280, 'photo_bytes', 200000));
  -- P4. tb_journal_turn gives tb-journal each capture's photo_path; tb_journal_reply stores cache counts
  v := public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000e1',
         'local_date', '2000-01-02', 'content', 'photo turn', 'created_at', '2000-01-02 12:00:00+00'));
  r := r || jsonb_build_object('test', 'P4 tb_journal_turn captures carry photo_path',
         'pass', v->'captures'->0->>'photo_path' = v_uid::text || '/' || v_pid::text || '.jpg', 'detail', v->'captures');
  v := public.tb_journal_reply(jsonb_build_object('reply_to', '00000000-0000-4000-8000-0000000000e1', 'content', 'r',
         'model', 'claude-sonnet-5-5', 'input_tokens', 50, 'output_tokens', 5, 'cache_write_tokens', 3200, 'cache_read_tokens', 0));
  r := r || jsonb_build_object('test', 'P4 tb_journal_reply stores cache_write_tokens and cache_read_tokens',
         'pass', (v->'reply'->>'cache_write_tokens')::int = 3200 and (v->'reply'->>'cache_read_tokens')::int = 0, 'detail', v->'reply');

  -- P5. bucket tb-photos: private, 2 MB, JPEG only
  reset role;
  select count(*) into v_n from storage.buckets
   where id = 'tb-photos' and not public and file_size_limit = 2097152 and allowed_mime_types = array['image/jpeg'];
  r := r || jsonb_build_object('test', 'P5 bucket tb-photos private, 2 MB, image/jpeg only', 'pass', v_n = 1, 'detail', v_n);
  -- P6. exactly three policies for the bucket, authenticated only, none for delete
  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname in ('tb_photos_select', 'tb_photos_insert', 'tb_photos_update')
     and roles = array['authenticated']::name[];
  r := r || jsonb_build_object('test', 'P6 tb_photos_select, _insert, _update for authenticated only',
         'pass', v_n = 3 and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                                          and (qual like '%tb-photos%' or with_check like '%tb-photos%') and cmd = 'DELETE'), 'detail', v_n);

  -- Two objects, one in each user's folder (written as postgres, rolled back with the rest).
  insert into storage.objects (bucket_id, name) values
    ('tb-photos', v_uid::text || '/' || v_pid::text || '.jpg'),
    ('tb-photos', v_other::text || '/00000000-0000-4000-8000-0000000000d2.jpg');
  -- P7. read: own folder only; anon nothing
  set local role authenticated;
  perform set_config('request.jwt.claims', v_claims, true);
  select count(*) into v_n from storage.objects where bucket_id = 'tb-photos' and name like '%-0000000000d_.jpg';
  r := r || jsonb_build_object('test', 'P7 Gary reads his own photo and not the other user''s',
         'pass', v_n = 1 and exists (select 1 from storage.objects where name = v_uid::text || '/' || v_pid::text || '.jpg'), 'detail', v_n);
  perform set_config('request.jwt.claims', v_oclaims, true);
  select count(*) into v_n from storage.objects where bucket_id = 'tb-photos' and name like v_uid::text || '/%';
  r := r || jsonb_build_object('test', 'P7 a second synthetic uid cannot read Gary''s folder', 'pass', v_n = 0, 'detail', v_n);
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from storage.objects where bucket_id = 'tb-photos';
  reset role;
  r := r || jsonb_build_object('test', 'P7 anon reads nothing in tb-photos', 'pass', v_n = 0, 'detail', v_n);
  -- P8. write: own folder only
  set local role authenticated;
  perform set_config('request.jwt.claims', v_claims, true);
  begin
    insert into storage.objects (bucket_id, name) values ('tb-photos', v_uid::text || '/00000000-0000-4000-8000-0000000000d3.jpg');
    r := r || jsonb_build_object('test', 'P8 Gary uploads into his own folder', 'pass', true, 'detail', null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r := r || jsonb_build_object('test', 'P8 Gary uploads into his own folder', 'pass', false, 'detail', v_state || ' ' || sqlerrm);
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('tb-photos', v_other::text || '/00000000-0000-4000-8000-0000000000d4.jpg');
    r := r || jsonb_build_object('test', 'P8 Gary cannot write into another folder', 'pass', false, 'detail', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r := r || jsonb_build_object('test', 'P8 Gary cannot write into another folder', 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
  end;
  update storage.objects set user_metadata = '{"retry":1}' where bucket_id = 'tb-photos' and name = v_uid::text || '/' || v_pid::text || '.jpg';
  get diagnostics v_n = row_count;
  r := r || jsonb_build_object('test', 'P8 Gary can overwrite his own file (upsert on retry)', 'pass', v_n = 1, 'detail', v_n);
  update storage.objects set user_metadata = '{"x":1}' where bucket_id = 'tb-photos' and name like v_other::text || '/%';
  get diagnostics v_n = row_count;
  r := r || jsonb_build_object('test', 'P8 Gary cannot overwrite another user''s file', 'pass', v_n = 0, 'detail', v_n);
  -- P9. no delete, even of his own file
  begin
    delete from storage.objects where bucket_id = 'tb-photos' and name = v_uid::text || '/' || v_pid::text || '.jpg';
    get diagnostics v_n = row_count;
  exception when others then
    v_n := 0;
  end;
  reset role;
  r := r || jsonb_build_object('test', 'P9 Gary cannot delete his own photo (no delete policy)',
         'pass', v_n = 0 and exists (select 1 from storage.objects where name = v_uid::text || '/' || v_pid::text || '.jpg'), 'detail', v_n);
  -- P10. anon cannot write
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into storage.objects (bucket_id, name) values ('tb-photos', v_uid::text || '/00000000-0000-4000-8000-0000000000d5.jpg');
    reset role;
    r := r || jsonb_build_object('test', 'P10 anon cannot upload', 'pass', false, 'detail', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    r := r || jsonb_build_object('test', 'P10 anon cannot upload', 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
  end;

  -- P11 to P13: "Claude sees this" (migration 0007). Test day 2000-01-03.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', v_claims, true);
  perform public.tb_captures_upsert(jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f1', 'body', 'switch on by default', 'kind', 'note',
      'captured_at', '2000-01-03 06:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-03', 'updated_at', '2000-01-03 06:00:00+00',
      'photo_path', v_uid::text || '/00000000-0000-4000-8000-0000000000f1.jpg', 'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 1000),
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f2', 'body', 'switched off', 'kind', 'note',
      'captured_at', '2000-01-03 07:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-03', 'updated_at', '2000-01-03 07:00:00+00',
      'photo_path', v_uid::text || '/00000000-0000-4000-8000-0000000000f2.jpg', 'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 1000,
      'photo_to_claude', false)));
  select jsonb_object_agg(e->>'id', e->'photo_to_claude') into v
    from jsonb_array_elements((public.tb_captures_since(null, null))->'rows') e where e->>'local_date' = '2000-01-03';
  r := r || jsonb_build_object('test', 'P11 photo_to_claude defaults to true and stores false; pulled with the row',
         'pass', v->>'00000000-0000-4000-8000-0000000000f1' = 'true' and v->>'00000000-0000-4000-8000-0000000000f2' = 'false', 'detail', v);
  v := public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000e2',
         'local_date', '2000-01-03', 'content', 'switch turn', 'created_at', '2000-01-03 12:00:00+00'));
  r := r || jsonb_build_object('test', 'P12 tb_journal_turn: photo_path for the switched-on photo, none for the switched-off one, both captures listed',
         'pass', jsonb_array_length(v->'captures') = 2
                 and v->'captures'->0->>'photo_path' = v_uid::text || '/00000000-0000-4000-8000-0000000000f1.jpg'
                 and v->'captures'->1->'photo_path' = 'null'::jsonb and v->'captures'->1->>'body' = 'switched off'
                 and not (v->'captures'->1 ? 'photo_to_claude'), 'detail', v->'captures');
  -- an app from before the switch edits the switched-off row: the switch stays off
  perform public.tb_capture_upsert(jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f2', 'body', 'edited by an older app',
    'kind', 'note', 'captured_at', '2000-01-03 07:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-03',
    'updated_at', '2000-01-03 08:00:00+00', 'photo_path', v_uid::text || '/00000000-0000-4000-8000-0000000000f2.jpg',
    'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 1000));
  reset role;
  select count(*) into v_n from travel.captures where id = '00000000-0000-4000-8000-0000000000f2' and not photo_to_claude and body = 'edited by an older app';
  set local role authenticated;
  perform set_config('request.jwt.claims', v_claims, true);
  perform public.tb_capture_upsert(jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f2', 'body', 'switched back on',
    'kind', 'note', 'captured_at', '2000-01-03 07:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-03',
    'updated_at', '2000-01-03 09:00:00+00', 'photo_path', v_uid::text || '/00000000-0000-4000-8000-0000000000f2.jpg',
    'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 1000, 'photo_to_claude', true));
  reset role;
  select v_n + count(*) into v_n from travel.captures where id = '00000000-0000-4000-8000-0000000000f2' and photo_to_claude;
  r := r || jsonb_build_object('test', 'P13 a row without the field keeps the stored switch; an explicit true turns it back on',
         'pass', v_n = 2, 'detail', v_n);

  -- ================= M1.2 two travellers (migration 0008). Test day 2000-01-04 holds no real rows.
  reset role;

  -- T1. anon cannot execute any of the new functions
  foreach f in array array[
      'select public.tb_linked(gen_random_uuid())',
      'select public.tb_link_state(gen_random_uuid())',
      'select public.tb_partner_add(gen_random_uuid())',
      'select public.tb_partner_remove(gen_random_uuid())',
      'select public.tb_partner_captures()',
      'select public.tb_can_read_photo(''x'')'] loop
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '', true);
      execute f;
      reset role;
      r := r || jsonb_build_object('test', 'T1 anon denied: ' || f, 'pass', false, 'detail', 'call succeeded');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      r := r || jsonb_build_object('test', 'T1 anon denied: ' || f, 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;

  -- T2. anon and authenticated cannot read the new tables directly
  foreach f in array array['anon:people', 'anon:partner_adds', 'authenticated:people', 'authenticated:partner_adds'] loop
    begin
      execute format('set local role %I', split_part(f, ':', 1));
      perform set_config('request.jwt.claims', case when f like 'authenticated%' then v_claims else '' end, true);
      execute format('select 1 from travel.%I limit 1', split_part(f, ':', 2));
      reset role;
      r := r || jsonb_build_object('test', 'T2 direct read denied ' || f, 'pass', false, 'detail', 'select succeeded');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      r := r || jsonb_build_object('test', 'T2 direct read denied ' || f, 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;

  -- T3. every tb_ function: SECURITY DEFINER, search_path travel, public, no anon or PUBLIC execute
  select count(*) filter (where p.prosecdef and p.proconfig = array['search_path=travel, public']
                            and not has_function_privilege('anon', p.oid, 'execute')
                            and has_function_privilege('authenticated', p.oid, 'execute')
                            and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)),
         count(*)
    into v_n, v_pages
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'tb\_%';
  r := r || jsonb_build_object('test', 'T3 all 15 tb_ functions: definer, search_path, grants',
         'pass', v_n = 15 and v_pages = 15, 'detail', jsonb_build_object('ok', v_n, 'total', v_pages));

  -- T4. the two travellers, and the new column's default
  select count(*) into v_n from travel.people p join auth.users u on u.id = p.uid
   where (u.email = 'gary@travelboard.local' and p.display_name = 'Gary' and p.journal_prompt = 'journal')
      or (u.email = 'eric@travelboard.local' and p.display_name = 'Eric' and p.journal_prompt = 'journal-eric');
  r := r || jsonb_build_object('test', 'T4 people: Gary (journal), Eric (journal-eric)', 'pass', v_n = 2, 'detail', v_n);
  select count(*) into v_n from information_schema.columns
   where table_schema = 'travel' and table_name = 'captures' and column_name = 'shared'
     and is_nullable = 'NO' and column_default = 'false' and data_type = 'boolean';
  r := r || jsonb_build_object('test', 'T4 captures.shared boolean not null default false', 'pass', v_n = 1, 'detail', v_n);

  -- Synthetic travellers A, B, C (postgres, rolled back with the rest).
  insert into auth.users (id, email, aud, role) values
    (v_a, 'smoke-a@travelboard.invalid', 'authenticated', 'authenticated'),
    (v_b, 'smoke-b@travelboard.invalid', 'authenticated', 'authenticated'),
    (v_c, 'smoke-c@travelboard.invalid', 'authenticated', 'authenticated');
  insert into travel.people (uid, display_name, journal_prompt) values
    (v_a, 'Smoke A', 'journal'), (v_b, 'Smoke B', 'journal-eric'), (v_c, 'Smoke C', 'journal');
  v_ca := json_build_object('sub', v_a, 'role', 'authenticated')::text;
  v_cb := json_build_object('sub', v_b, 'role', 'authenticated')::text;
  v_cc := json_build_object('sub', v_c, 'role', 'authenticated')::text;

  -- A's captures on 2000-01-04: shared with a photo, unshared with a photo, shared with the photo
  -- switched off for Claude, shared but deleted. B has one of its own.
  set local role authenticated;
  perform set_config('request.jwt.claims', v_ca, true);
  perform public.tb_captures_upsert(jsonb_build_array(
    jsonb_build_object('id', v_sh, 'body', 'A shared', 'kind', 'note', 'captured_at', '2000-01-04 06:00:00+00',
      'tz', 'Asia/Bangkok', 'local_date', '2000-01-04', 'updated_at', '2000-01-04 06:00:00+00', 'shared', true,
      'photo_path', v_a::text || '/' || v_sh::text || '.jpg', 'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 1000),
    jsonb_build_object('id', v_un, 'body', 'A unshared', 'kind', 'note', 'captured_at', '2000-01-04 07:00:00+00',
      'tz', 'Asia/Bangkok', 'local_date', '2000-01-04', 'updated_at', '2000-01-04 07:00:00+00',
      'photo_path', v_a::text || '/' || v_un::text || '.jpg', 'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 1000),
    jsonb_build_object('id', v_off, 'body', 'A shared, photo not for Claude', 'kind', 'journal', 'captured_at', '2000-01-04 08:00:00+00',
      'tz', 'Asia/Bangkok', 'local_date', '2000-01-04', 'updated_at', '2000-01-04 08:00:00+00', 'shared', true,
      'photo_path', v_a::text || '/' || v_off::text || '.jpg', 'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 1000,
      'photo_to_claude', false),
    jsonb_build_object('id', v_del, 'body', 'A shared then deleted', 'kind', 'note', 'captured_at', '2000-01-04 09:00:00+00',
      'tz', 'Asia/Bangkok', 'local_date', '2000-01-04', 'updated_at', '2000-01-04 09:00:00+00', 'shared', true,
      'deleted_at', '2000-01-04 09:00:00+00')));
  v := public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000a9',
         'local_date', '2000-01-04', 'content', 'A private journal turn', 'created_at', '2000-01-04 12:00:00+00'));
  perform public.tb_journal_reply(jsonb_build_object('reply_to', '00000000-0000-4000-8000-0000000000a9', 'content', 'A private reply'));
  perform public.tb_journal_day_suffix('2000-01-04', 'A title');
  perform set_config('request.jwt.claims', v_cb, true);
  perform public.tb_capture_upsert(jsonb_build_object('id', '00000000-0000-4000-8000-0000000000b5', 'body', 'B own',
    'kind', 'note', 'captured_at', '2000-01-04 10:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-04',
    'updated_at', '2000-01-04 10:00:00+00'));
  reset role;
  -- Photo objects in A's folder (postgres): one per capture with a photo, and one with no capture.
  insert into storage.objects (bucket_id, name) values
    ('tb-photos', v_a::text || '/' || v_sh::text || '.jpg'),
    ('tb-photos', v_a::text || '/' || v_un::text || '.jpg'),
    ('tb-photos', v_a::text || '/' || v_off::text || '.jpg'),
    ('tb-photos', v_a::text || '/00000000-0000-4000-8000-0000000000aa.jpg');

  -- T5 (item 1). Not linked: B sees nothing of A's, by any route
  set local role authenticated;
  perform set_config('request.jwt.claims', v_cb, true);
  v := public.tb_partner_captures();
  r := r || jsonb_build_object('test', 'T5 not linked: tb_partner_captures() returns nothing', 'pass', v = '[]'::jsonb, 'detail', v);
  v := public.tb_captures_since(null, null);
  r := r || jsonb_build_object('test', 'T5 not linked: B pulls only its own rows',
         'pass', not exists (select 1 from jsonb_array_elements(v->'rows') e where (e->>'owner')::uuid <> v_b)
                 and exists (select 1 from jsonb_array_elements(v->'rows') e where e->>'body' = 'B own'), 'detail', jsonb_array_length(v->'rows'));
  select count(*) into v_n from storage.objects where bucket_id = 'tb-photos' and name like v_a::text || '/%';
  r := r || jsonb_build_object('test', 'T5 not linked: B reads no photo in A''s folder', 'pass', v_n = 0, 'detail', v_n);
  v := public.tb_whoami();
  r := r || jsonb_build_object('test', 'T5 whoami: B''s name, A listed with link none, B not in its own list',
         'pass', v->>'display_name' = 'Smoke B'
                 and exists (select 1 from jsonb_array_elements(v->'people') e where (e->>'uid')::uuid = v_a and e->>'link' = 'none' and e->>'name' = 'Smoke A')
                 and not exists (select 1 from jsonb_array_elements(v->'people') e where (e->>'uid')::uuid = v_b),
         'detail', v);

  -- T6 (item 2). A adds B: one direction only, nothing shared yet
  perform set_config('request.jwt.claims', v_ca, true);
  v := public.tb_partner_add(v_b);
  r := r || jsonb_build_object('test', 'T6 A adds B: A sees added_by_me', 'pass', v->>'link' = 'added_by_me', 'detail', v);
  perform set_config('request.jwt.claims', v_cb, true);
  select e into v from jsonb_array_elements((public.tb_whoami())->'people') e where (e->>'uid')::uuid = v_a;
  r := r || jsonb_build_object('test', 'T6 B sees added_me; not linked; still nothing shared',
         'pass', v->>'link' = 'added_me' and not public.tb_linked(v_a) and public.tb_partner_captures() = '[]'::jsonb, 'detail', v);
  v := public.tb_partner_add(v_a);
  r := r || jsonb_build_object('test', 'T6 B adds A: live', 'pass', v->>'link' = 'live' and public.tb_linked(v_a), 'detail', v);
  perform set_config('request.jwt.claims', v_ca, true);
  r := r || jsonb_build_object('test', 'T6 A sees live too', 'pass', public.tb_linked(v_b), 'detail', null);
  -- validation: self, a uid that is not a person
  foreach f in array array['self', 'stranger'] loop
    begin
      perform public.tb_partner_add(case when f = 'self' then v_a else gen_random_uuid() end);
      r := r || jsonb_build_object('test', 'T6 add rejects ' || f, 'pass', false, 'detail', 'accepted');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      r := r || jsonb_build_object('test', 'T6 add rejects ' || f, 'pass', v_state = '22023', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;

  -- T7 (items 3, 4). Linked: B gets A's shared, live captures only, labelled
  perform set_config('request.jwt.claims', v_cb, true);
  v := public.tb_partner_captures();
  r := r || jsonb_build_object('test', 'T7 linked: B gets A''s 2 shared live captures with owner and owner_name, not the unshared or deleted one',
         'pass', jsonb_array_length(v) = 2 and v->0->>'id' = v_sh::text and v->1->>'id' = v_off::text
                 and v->0->>'owner_name' = 'Smoke A' and (v->0->>'owner')::uuid = v_a and (v->0->>'shared')::boolean
                 and v->0->>'photo_path' = v_a::text || '/' || v_sh::text || '.jpg', 'detail', v);
  v := public.tb_captures_since(null, null);
  r := r || jsonb_build_object('test', 'T7 linked: A''s rows still never come through B''s own pull',
         'pass', not exists (select 1 from jsonb_array_elements(v->'rows') e where (e->>'owner')::uuid <> v_b), 'detail', null);

  -- T8 (item 7). Storage while linked
  select count(*) into v_n from storage.objects where bucket_id = 'tb-photos' and name = v_a::text || '/' || v_sh::text || '.jpg';
  r := r || jsonb_build_object('test', 'T8 B reads A''s shared photo', 'pass', v_n = 1, 'detail', v_n);
  select count(*) into v_n from storage.objects where bucket_id = 'tb-photos' and name like v_a::text || '/%';
  r := r || jsonb_build_object('test', 'T8 B reads only the 2 shared photos in A''s folder: not the unshared one, not a file with no capture',
         'pass', v_n = 2 and not exists (select 1 from storage.objects where name = v_a::text || '/' || v_un::text || '.jpg'), 'detail', v_n);
  begin
    insert into storage.objects (bucket_id, name) values ('tb-photos', v_a::text || '/00000000-0000-4000-8000-0000000000ab.jpg');
    r := r || jsonb_build_object('test', 'T8 B cannot write into A''s folder', 'pass', false, 'detail', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r := r || jsonb_build_object('test', 'T8 B cannot write into A''s folder', 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
  end;
  update storage.objects set user_metadata = '{"x":1}' where bucket_id = 'tb-photos' and name = v_a::text || '/' || v_sh::text || '.jpg';
  get diagnostics v_n = row_count;
  r := r || jsonb_build_object('test', 'T8 B cannot overwrite A''s shared photo', 'pass', v_n = 0, 'detail', v_n);
  begin
    delete from storage.objects where bucket_id = 'tb-photos' and name = v_a::text || '/' || v_sh::text || '.jpg';
    get diagnostics v_n = row_count;
  exception when others then
    v_n := 0;
  end;
  r := r || jsonb_build_object('test', 'T8 B cannot delete A''s shared photo', 'pass', v_n = 0, 'detail', v_n);
  r := r || jsonb_build_object('test', 'T8 tb_can_read_photo: shared yes; unshared, own, malformed no',
         'pass', public.tb_can_read_photo(v_a::text || '/' || v_sh::text || '.jpg')
                 and not public.tb_can_read_photo(v_a::text || '/' || v_un::text || '.jpg')
                 and not public.tb_can_read_photo(v_b::text || '/00000000-0000-4000-8000-0000000000b5.jpg')
                 and not public.tb_can_read_photo('../' || v_sh::text || '.jpg'), 'detail', null);
  perform set_config('request.jwt.claims', v_cc, true);
  select count(*) into v_n from storage.objects where bucket_id = 'tb-photos' and name like v_a::text || '/%';
  r := r || jsonb_build_object('test', 'T8 a third uid (C, not linked) reads nothing in A''s folder and gets no partner rows',
         'pass', v_n = 0 and public.tb_partner_captures() = '[]'::jsonb, 'detail', v_n);
  perform set_config('request.jwt.claims', v_claims, true);
  select count(*) into v_n from storage.objects where bucket_id = 'tb-photos' and name like v_a::text || '/%';
  r := r || jsonb_build_object('test', 'T8 Gary (not linked to A) reads nothing in A''s folder', 'pass', v_n = 0, 'detail', v_n);

  -- T9 (item 6). B cannot edit or delete A's capture, single or batch, even with a newer updated_at
  perform set_config('request.jwt.claims', v_cb, true);
  foreach f in array array['edit', 'delete', 'batch'] loop
    begin
      v := jsonb_build_object('id', v_sh, 'body', 'B was here', 'kind', 'note', 'captured_at', '2000-01-04 06:00:00+00',
             'tz', 'Asia/Bangkok', 'local_date', '2000-01-04', 'updated_at', '2001-01-01 00:00:00+00', 'shared', false);
      if f = 'delete' then v := v || jsonb_build_object('deleted_at', '2001-01-01 00:00:00+00'); end if;
      if f = 'batch' then perform public.tb_captures_upsert(jsonb_build_array(v)); else perform public.tb_capture_upsert(v); end if;
      r := r || jsonb_build_object('test', 'T9 B cannot ' || f || ' A''s capture', 'pass', false, 'detail', 'accepted');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      r := r || jsonb_build_object('test', 'T9 B cannot ' || f || ' A''s capture', 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
    end;
  end loop;
  reset role;
  select count(*) into v_n from travel.captures where id = v_sh and body = 'A shared' and shared and deleted_at is null and owner = v_a;
  r := r || jsonb_build_object('test', 'T9 A''s capture unchanged', 'pass', v_n = 1, 'detail', v_n);

  -- T10 (item 9). Journals stay private: B cannot see or touch A's thread
  set local role authenticated;
  perform set_config('request.jwt.claims', v_cb, true);
  v := public.tb_journal_day('2000-01-04');
  r := r || jsonb_build_object('test', 'T10 B''s tb_journal_day for the day: no messages of A, no title of A',
         'pass', jsonb_array_length(v->'messages') = 0 and coalesce(v->>'suffix', '') = '', 'detail', v);
  v := public.tb_journal_days(1000);
  r := r || jsonb_build_object('test', 'T10 B''s tb_journal_days does not list A''s day',
         'pass', not exists (select 1 from jsonb_array_elements(v) e where e->>'local_date' = '2000-01-04'), 'detail', null);
  begin
    perform public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000a9',
      'local_date', '2000-01-04', 'content', 'B tries A''s turn', 'created_at', '2000-01-04 12:00:00+00'));
    r := r || jsonb_build_object('test', 'T10 B cannot open A''s turn (and so cannot read its reply)', 'pass', false, 'detail', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r := r || jsonb_build_object('test', 'T10 B cannot open A''s turn (and so cannot read its reply)', 'pass', v_state = '42501', 'detail', v_state || ' ' || sqlerrm);
  end;
  begin
    perform public.tb_journal_reply(jsonb_build_object('reply_to', '00000000-0000-4000-8000-0000000000a9', 'content', 'B replies'));
    r := r || jsonb_build_object('test', 'T10 B cannot reply to A''s turn', 'pass', false, 'detail', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r := r || jsonb_build_object('test', 'T10 B cannot reply to A''s turn', 'pass', v_state = '22023', 'detail', v_state || ' ' || sqlerrm);
  end;

  -- T11 (item 10, SQL side). B's journal turn: own capture plus A's shared ones, labelled; the
  -- unshared and deleted ones absent; the switched-off photo's path withheld; B's prompt; B's thread only
  v := public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000b9',
         'local_date', '2000-01-04', 'content', 'B journal turn', 'created_at', '2000-01-04 13:00:00+00'));
  r := r || jsonb_build_object('test', 'T11 B''s turn: me is Smoke B with journal-eric; thread is B''s turn alone',
         'pass', v->'me'->>'display_name' = 'Smoke B' and v->'me'->>'journal_prompt' = 'journal-eric'
                 and jsonb_array_length(v->'thread') = 1 and v->'thread'->0->>'content' = 'B journal turn', 'detail', v->'me');
  r := r || jsonb_build_object('test', 'T11 B''s turn: captures are A shared, A shared (photo off), B own; labelled; unshared and deleted absent',
         'pass', jsonb_array_length(v->'captures') = 3
                 and v->'captures'->0->>'body' = 'A shared' and v->'captures'->0->>'owner_name' = 'Smoke A' and not (v->'captures'->0->>'own')::boolean
                 and v->'captures'->0->>'photo_path' = v_a::text || '/' || v_sh::text || '.jpg'
                 and v->'captures'->1->>'body' = 'A shared, photo not for Claude' and v->'captures'->1->'photo_path' = 'null'::jsonb
                 and v->'captures'->2->>'body' = 'B own' and (v->'captures'->2->>'own')::boolean and v->'captures'->2->>'owner_name' = 'Smoke B',
         'detail', v->'captures');
  perform set_config('request.jwt.claims', v_ca, true);
  v := public.tb_journal_turn(jsonb_build_object('message_id', '00000000-0000-4000-8000-0000000000ac',
         'local_date', '2000-01-04', 'content', 'A second turn', 'created_at', '2000-01-04 14:00:00+00'));
  r := r || jsonb_build_object('test', 'T11 A''s turn: A''s 3 live captures (the unshared one too), not B''s unshared own; A''s thread only',
         'pass', jsonb_array_length(v->'captures') = 3 and v->'me'->>'journal_prompt' = 'journal'
                 and not exists (select 1 from jsonb_array_elements(v->'captures') e where e->>'body' = 'B own')
                 and not exists (select 1 from jsonb_array_elements(v->'thread') e where e->>'content' like 'B %'),
         'detail', v->'captures');

  -- T12 (items 4, 5). Unsharing removes a capture and its photo from B; sharing an older one adds it
  perform public.tb_capture_upsert(jsonb_build_object('id', v_sh, 'body', 'A shared', 'kind', 'note', 'captured_at', '2000-01-04 06:00:00+00',
    'tz', 'Asia/Bangkok', 'local_date', '2000-01-04', 'updated_at', '2000-01-04 15:00:00+00', 'shared', false,
    'photo_path', v_a::text || '/' || v_sh::text || '.jpg', 'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 1000));
  perform public.tb_capture_upsert(jsonb_build_object('id', v_un, 'body', 'A unshared', 'kind', 'note', 'captured_at', '2000-01-04 07:00:00+00',
    'tz', 'Asia/Bangkok', 'local_date', '2000-01-04', 'updated_at', '2000-01-04 15:00:00+00', 'shared', true,
    'photo_path', v_a::text || '/' || v_un::text || '.jpg', 'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 1000));
  perform set_config('request.jwt.claims', v_cb, true);
  v := public.tb_partner_captures();
  select count(*) into v_n from storage.objects where bucket_id = 'tb-photos' and name = v_a::text || '/' || v_sh::text || '.jpg';
  r := r || jsonb_build_object('test', 'T12 switched off: gone from B''s set and its photo refused; the older one switched on appears',
         'pass', v_n = 0 and not exists (select 1 from jsonb_array_elements(v) e where e->>'id' = v_sh::text)
                 and exists (select 1 from jsonb_array_elements(v) e where e->>'id' = v_un::text), 'detail', v);
  -- an app from before M1.2 (no shared field) edits a shared row: it stays shared
  perform set_config('request.jwt.claims', v_ca, true);
  perform public.tb_capture_upsert(jsonb_build_object('id', v_un, 'body', 'A unshared, edited by an older app', 'kind', 'note',
    'captured_at', '2000-01-04 07:00:00+00', 'tz', 'Asia/Bangkok', 'local_date', '2000-01-04', 'updated_at', '2000-01-04 16:00:00+00',
    'photo_path', v_a::text || '/' || v_un::text || '.jpg', 'photo_w', 1280, 'photo_h', 960, 'photo_bytes', 1000));
  reset role;
  select count(*) into v_n from travel.captures where id = v_un and shared and body like '%older app';
  r := r || jsonb_build_object('test', 'T12 a row without the shared field keeps the stored value', 'pass', v_n = 1, 'detail', v_n);

  -- T13 (item 8). Either side removes the link: nothing visible both ways; adding again restores the still-shared
  set local role authenticated;
  perform set_config('request.jwt.claims', v_cb, true);
  perform public.tb_partner_captures();
  v := public.tb_partner_remove(v_a);
  r := r || jsonb_build_object('test', 'T13 B removes the link: B now added_me', 'pass', v->>'link' = 'added_me', 'detail', v);
  select count(*) into v_n from storage.objects where bucket_id = 'tb-photos' and name like v_a::text || '/%';
  r := r || jsonb_build_object('test', 'T13 after removal B gets no partner rows and no photo of A''s',
         'pass', public.tb_partner_captures() = '[]'::jsonb and v_n = 0 and not public.tb_linked(v_a), 'detail', v_n);
  perform set_config('request.jwt.claims', v_ca, true);
  r := r || jsonb_build_object('test', 'T13 A sees added_by_me and no partner rows',
         'pass', public.tb_link_state(v_b) = 'added_by_me' and public.tb_partner_captures() = '[]'::jsonb, 'detail', null);
  reset role;
  select count(*) into v_n from travel.partner_adds where adder = v_b and added = v_a and removed_at is not null;
  r := r || jsonb_build_object('test', 'T13 removal sets removed_at, row kept', 'pass', v_n = 1, 'detail', v_n);
  set local role authenticated;
  perform set_config('request.jwt.claims', v_cb, true);
  v := public.tb_partner_add(v_a);
  r := r || jsonb_build_object('test', 'T13 B adds A again: live, A''s still-shared captures back',
         'pass', v->>'link' = 'live' and jsonb_array_length(public.tb_partner_captures()) = 2, 'detail', public.tb_partner_captures());
  perform set_config('request.jwt.claims', v_ca, true);
  v := public.tb_partner_remove(v_b);
  perform set_config('request.jwt.claims', v_cb, true);
  r := r || jsonb_build_object('test', 'T13 A removes the link: B gets nothing either way',
         'pass', v->>'link' = 'added_me' and public.tb_partner_captures() = '[]'::jsonb, 'detail', v);
  reset role;
  select count(*) into v_n from travel.partner_adds where adder = v_b and added = v_a and removed_at is null;
  r := r || jsonb_build_object('test', 'T13 re-adding cleared removed_at', 'pass', v_n = 1, 'detail', v_n);

  -- T14. tb_whoami and tb_link_state need a signed-in caller; the photo helper says no without one
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  r := r || jsonb_build_object('test', 'T14 tb_can_read_photo is false with no auth.uid()',
         'pass', not public.tb_can_read_photo(v_a::text || '/' || v_sh::text || '.jpg'), 'detail', null);
  begin
    perform public.tb_partner_captures();
    r := r || jsonb_build_object('test', 'T14 tb_partner_captures needs auth.uid()', 'pass', false, 'detail', 'accepted');
  exception when others then
    r := r || jsonb_build_object('test', 'T14 tb_partner_captures needs auth.uid()', 'pass', sqlerrm = 'not authenticated', 'detail', sqlerrm);
  end;
  reset role;

  reset role;
  perform set_config('smoke.results', r::text, true);
end
$smoke$;

select t.ordinality as n, case when (t.e->>'pass')::boolean then 'PASS' else 'FAIL' end as result,
       t.e->>'test' as test, left((t.e->'detail')::text, 160) as detail
from jsonb_array_elements(current_setting('smoke.results')::jsonb) with ordinality as t(e, ordinality)
order by n;

rollback;
