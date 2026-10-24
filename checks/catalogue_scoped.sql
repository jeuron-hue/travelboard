-- travelboard catalogue snapshot, scoped form. Read-only. Same objects and fingerprints as
-- checks/catalogue.sql; travelboard's own objects (schema travel, travel.*, public.tb_*, the
-- tb_photos_* policies, bucket tb-photos) are listed one per row, and everything else is one row:
-- OUTSIDE, its count and a 12-character hash. Run before and after a migration: the OUTSIDE row must
-- not change, and the listed rows must change only as the migration says. Baseline after 0009:
-- OUTSIDE 518, 493804029b51 (24/10/26).
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
  -- cron.job exists only where pg_cron is installed (weatherboard yes, travelboard no).
  -- query_to_xml runs the inner query only when the CASE picks it, so this works in both.
  select 'cron_job', x.jobname, x.fp
  from xmltable('/table/row'
         passing case when to_regclass('cron.job') is not null then query_to_xml(
           'select jobname, md5(concat_ws(''|'', schedule, command, active::text, username, database)) as fp from cron.job',
           false, false, '') else '<table/>'::xml end
         columns jobname text path 'jobname', fp text path 'fp') x
  union all
  select 'storage_bucket', b.id,
         md5(concat_ws('|', b.public::text, b.file_size_limit::text, b.allowed_mime_types::text))
  from storage.buckets b
  union all
  select 'role', r.rolname, md5(concat_ws('|', r.rolsuper, r.rolcanlogin, r.rolbypassrls, r.rolconfig::text))
  from pg_roles r
)
,
scoped as (select kind, name, fp, (name = 'travel' and kind='schema') or name like 'travel.%' or name like 'public.tb\_%' or name like 'storage.objects.tb\_photos\_%' or (kind='storage_bucket' and name='tb-photos') as mine from objs)
select 'OUTSIDE' as kind, count(*)::text as name, left(md5(string_agg(kind||'|'||name||'|'||coalesce(fp,''), ',' order by kind, name)),12) as fp from scoped where not mine
union all
select * from (select kind, name, left(fp,12) from scoped where mine order by kind, name) x;
