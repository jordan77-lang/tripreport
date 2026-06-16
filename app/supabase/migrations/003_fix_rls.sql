-- Fix "new row violates row-level security" for trips, invites, and storage.
-- Run in Supabase SQL Editor after 001 and 002 (safe to re-run).

-- ── Auto-create profile when a user signs up ────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for accounts created before this trigger existed.
insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
    split_part(coalesce(u.email, 'user'), '@', 1)
  )
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- ── Owner check (security definer — not blocked by trips RLS) ───────────────

create or replace function public.is_trip_owner(trip_id uuid, user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.trips t
    where t.id = trip_id and t.owner_id = user_id
  );
$$;

grant execute on function public.is_trip_owner(uuid, uuid) to authenticated;

-- ── Trips: owners can always read their own rows ────────────────────────────

drop policy if exists "Owners can view own trips" on public.trips;
create policy "Owners can view own trips"
  on public.trips for select to authenticated
  using (owner_id = auth.uid());

-- ── Trip members: easier owner self-insert after trip create ──────────────────

drop policy if exists "Owner can add members" on public.trip_members;
create policy "Owner can add members"
  on public.trip_members for insert to authenticated
  with check (
    public.is_trip_owner(trip_id)
    or user_id = auth.uid()
  );

-- ── Invites: use security definer owner check ───────────────────────────────

drop policy if exists "Owner can create invites" on public.trip_invites;
create policy "Owner can create invites"
  on public.trip_invites for insert to authenticated
  with check (public.is_trip_owner(trip_id));

drop policy if exists "Owner can update invites" on public.trip_invites;
create policy "Owner can update invites"
  on public.trip_invites for update to authenticated
  using (public.is_trip_owner(trip_id));

-- ── Storage: use security definer membership check ──────────────────────────

drop policy if exists "Trip members read trip media" on storage.objects;
create policy "Trip members read trip media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'trip-media'
    and public.is_trip_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Trip members upload trip media" on storage.objects;
create policy "Trip members upload trip media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'trip-media'
    and public.is_trip_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Trip members update trip media" on storage.objects;
create policy "Trip members update trip media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'trip-media'
    and public.is_trip_member((storage.foldername(name))[1]::uuid)
  );

-- ── Fix trips uploaded with wrong owner_id (anonymous device id) ──────────────
-- Only run if you created trips before the app fix; safe when no rows match.

-- Uncomment and replace YOUR_USER_UUID if invites still fail after the above:
-- update public.trips set owner_id = 'YOUR_USER_UUID' where owner_id not in (select id from auth.users);
