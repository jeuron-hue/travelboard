-- travelboard migration 0006: Storage bucket tb-photos and its policies (SPEC.md D4, 7A.1)
-- Touches only the bucket tb-photos and three policies tb_photos_* on storage.objects.
-- Private bucket, 2 MB per file, JPEG only. Each policy admits role authenticated to its own
-- folder only: the first path segment must be the caller's uid ('<uid>/<capture id>.jpg').
-- select: read own photos. insert: upload. update: a retried upload (upsert) overwrites its
-- own file. No delete policy: photos are never deleted (CLAUDE.md rule 8). anon gets nothing.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tb-photos', 'tb-photos', false, 2097152, array['image/jpeg']);

create policy tb_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'tb-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy tb_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tb-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy tb_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'tb-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'tb-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
