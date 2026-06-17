-- Let the real owner sync when trips.owner_id drifted but trip_members still lists them as owner.
-- Run in Supabase SQL Editor after 004 (safe to re-run).

create or replace function public.upsert_trip_for_owner(
  p_id uuid,
  p_name text,
  p_status text,
  p_start_date date,
  p_end_date date,
  p_types text[],
  p_location text,
  p_privacy text,
  p_payload jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  existing_owner uuid;
  updated_at timestamptz := now();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.profiles (id, display_name)
  values (uid, 'User')
  on conflict (id) do nothing;

  select owner_id into existing_owner from public.trips where id = p_id;

  if existing_owner is not null then
    if existing_owner = uid then
      null;
    elsif existing_owner not in (select id from auth.users) then
      update public.trips set owner_id = uid where id = p_id;
    elsif exists (
      select 1 from public.trip_members tm
      where tm.trip_id = p_id and tm.user_id = uid and tm.role = 'owner'
    ) then
      update public.trips set owner_id = uid where id = p_id;
    else
      raise exception 'Trip is owned by another account';
    end if;
  end if;

  insert into public.trips (
    id, owner_id, name, status, start_date, end_date, types, location, privacy, payload, updated_at
  ) values (
    p_id,
    uid,
    p_name,
    coalesce(p_status, 'planning'),
    p_start_date,
    p_end_date,
    coalesce(p_types, '{}'),
    p_location,
    coalesce(p_privacy, 'friends'),
    coalesce(p_payload, '{}'::jsonb),
    updated_at
  )
  on conflict (id) do update set
    name = excluded.name,
    status = excluded.status,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    types = excluded.types,
    location = excluded.location,
    privacy = excluded.privacy,
    payload = excluded.payload,
    updated_at = excluded.updated_at,
    owner_id = uid;

  insert into public.trip_members (trip_id, user_id, role)
  values (p_id, uid, 'owner')
  on conflict (trip_id, user_id) do update set role = excluded.role;

  return updated_at;
end;
$$;

grant execute on function public.upsert_trip_for_owner(
  uuid, text, text, date, date, text[], text, text, jsonb
) to authenticated;

-- Reclaim rows where owner_id is an old anonymous id but a real owner member exists.
update public.trips t
set owner_id = tm.user_id
from public.trip_members tm
where t.id = tm.trip_id
  and tm.role = 'owner'
  and tm.user_id in (select id from auth.users)
  and (t.owner_id not in (select id from auth.users) or t.owner_id is distinct from tm.user_id);
