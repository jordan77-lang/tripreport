-- Allow voice attachments alongside existing image types. Preserve custom types.
-- Run after 002_trip_media_storage.sql. Existing membership policies are unchanged.
update storage.buckets
set allowed_mime_types = array(
  select distinct mime
  from unnest(allowed_mime_types || array[
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav',
    'audio/x-wav', 'audio/aac', 'audio/flac', 'audio/x-m4a', 'audio/3gpp'
  ]) as mime
)
where id = 'trip-media' and allowed_mime_types is not null;
