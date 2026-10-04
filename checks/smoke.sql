-- travelboard smoke tests (SPEC.md 11). Run through the Supabase connector as postgres.
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

  reset role;
  perform set_config('smoke.results', r::text, true);
end
$smoke$;

select t.ordinality as n, case when (t.e->>'pass')::boolean then 'PASS' else 'FAIL' end as result,
       t.e->>'test' as test, t.e->'detail' as detail
from jsonb_array_elements(current_setting('smoke.results')::jsonb) with ordinality as t(e, ordinality)
order by n;

rollback;
