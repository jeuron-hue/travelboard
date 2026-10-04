-- travelboard catalogue snapshot. Read-only.
-- Run before and after every migration; diff the two outputs.
-- Each row: kind, object name, md5 fingerprint of its definition and grants.
-- Any added, removed or changed row outside schema travel, public.tb_* and
-- Edge Functions tb-* is a breach of CLAUDE.md rule 1.
with objs as (
  select 'schema' as kind, n.nspname as name,
         md5(concat_ws('|', pg_get_userbyid(n.nspowner), n.nspacl::text)) as fp
  from pg_namespace n
  where n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
  union all
  select 'rel:' || c.relkind::text, n.nspname || '.' || c.relname,
         md5(concat_ws('|', pg_get_userbyid(c.relowner), c.relacl::text,
             c.relrowsecurity::text, c.relforcerowsecurity::text,
             (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod)
                     || ':' || a.attnotnull::text || ':' || coalesce(a.attacl::text,''), ',' order by a.attnum)
              from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
             case when c.relkind in ('v','m') then pg_get_viewdef(c.oid) end))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
  union all
  select 'func', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(concat_ws('|', pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef::text,
             p.proconfig::text, p.prosrc))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog','information_schema')
  union all
  select 'constraint', n.nspname || '.' || c.relname || '.' || k.conname, md5(pg_get_constraintdef(k.oid))
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog','information_schema')
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check))
  from pg_policies
  union all
  select 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid) || t.tgenabled::text)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
  union all
  select 'event_trigger', evtname, md5(concat_ws('|', evtevent, evtenabled::text, evtfoid::regproc::text, evttags::text))
  from pg_event_trigger
  union all
  select 'default_acl', pg_get_userbyid(d.defaclrole) || ':' || coalesce(n.nspname,'*') || ':' || d.defaclobjtype::text,
         md5(d.defaclacl::text)
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  union all
  select 'extension', extname, md5(extversion || '|' || extnamespace::regnamespace::text) from pg_extension
  union all
  select 'publication', p.pubname,
         md5(concat_ws('|', p.puballtables::text, (select string_agg(schemaname||'.'||tablename, ',' order by 1)
                                                    from pg_publication_tables pt where pt.pubname = p.pubname)))
  from pg_publication p
  union all
  select 'cron_job', j.jobname, md5(concat_ws('|', j.schedule, j.command, j.active::text, j.username, j.database))
  from cron.job j
  union all
  select 'role', r.rolname, md5(concat_ws('|', r.rolsuper, r.rolcanlogin, r.rolbypassrls, r.rolconfig::text))
  from pg_roles r
)
select kind, name, fp from objs order by kind, name;
