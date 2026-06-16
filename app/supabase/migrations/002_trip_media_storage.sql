-- TripReport: Supabase Storage bucket + policies for trip-media
-- Run in Supabase SQL Editor after 001_initial_schema.sql (safe to re-run).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-media',
  'trip-media',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Trip members read trip media" on storage.objects;
create policy "Trip members read trip media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'trip-media'
    and (storage.foldername(name))[1]::uuid in (
      select tm.trip_id from public.trip_members tm where tm.user_id = auth.uid()
      union
      select t.id from public.trips t where t.owner_id = auth.uid()
    )
  );

drop policy if exists "Trip members upload trip media" on storage.objects;
create policy "Trip members upload trip media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'trip-media'
    and (storage.foldername(name))[1]::uuid in (
      select tm.trip_id from public.trip_members tm where tm.user_id = auth.uid()
      union
      select t.id from public.trips t where t.owner_id = auth.uid()
    )
  );

drop policy if exists "Trip members update trip media" on storage.objects;
create policy "Trip members update trip media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'trip-media'
    and (storage.foldername(name))[1]::uuid in (
      select tm.trip_id from public.trip_members tm where tm.user_id = auth.uid()
      union
      select t.id from public.trips t where t.owner_id = auth.uid()
    )
  );
