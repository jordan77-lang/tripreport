-- TripReport initial schema (idempotent — safe to re-run)
-- Run in Supabase SQL Editor: Dashboard → SQL → New query → Run

-- ── Profiles ────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert to authenticated with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- ── Trips ───────────────────────────────────────────────────────────────────

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  name text not null,
  status text not null default 'planning'
    check (status in ('planning', 'active', 'completed', 'archived')),
  start_date date,
  end_date date,
  types text[] not null default '{}',
  location text,
  privacy text not null default 'friends'
    check (privacy in ('private', 'friends', 'public')),
  payload jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists trips_owner_id_idx on public.trips (owner_id);
create index if not exists trips_updated_at_idx on public.trips (updated_at desc);

alter table public.trips enable row level security;

-- ── Trip members ──────────────────────────────────────────────────────────────

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'contributor'
    check (role in ('owner', 'contributor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index if not exists trip_members_user_id_idx on public.trip_members (user_id);

-- ── Invites ─────────────────────────────────────────────────────────────────

create table if not exists public.trip_invites (
  code text primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'contributor'
    check (role in ('contributor', 'viewer')),
  expires_at timestamptz,
  max_uses int,
  uses int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists trip_invites_trip_id_idx on public.trip_invites (trip_id);

-- ── Access helper (avoids recursive RLS) ────────────────────────────────────

create or replace function public.is_trip_member(trip uuid, member uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.trips t where t.id = trip and t.owner_id = member
  ) or exists (
    select 1 from public.trip_members m where m.trip_id = trip and m.user_id = member
  );
$$;

grant execute on function public.is_trip_member(uuid, uuid) to authenticated;

-- ── Trip RLS ────────────────────────────────────────────────────────────────

drop policy if exists "Members can view trips" on public.trips;
create policy "Members can view trips"
  on public.trips for select to authenticated
  using (public.is_trip_member(id));

drop policy if exists "Owner can insert trips" on public.trips;
create policy "Owner can insert trips"
  on public.trips for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "Contributors can update trips" on public.trips;
create policy "Contributors can update trips"
  on public.trips for update to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.trip_members m
      where m.trip_id = trips.id and m.user_id = auth.uid() and m.role in ('owner', 'contributor')
    )
  );

drop policy if exists "Owner can delete trips" on public.trips;
create policy "Owner can delete trips"
  on public.trips for delete to authenticated
  using (owner_id = auth.uid());

alter table public.trip_members enable row level security;

drop policy if exists "Members can view trip membership" on public.trip_members;
create policy "Members can view trip membership"
  on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists "Owner can add members" on public.trip_members;
create policy "Owner can add members"
  on public.trip_members for insert to authenticated
  with check (
    exists (select 1 from public.trips t where t.id = trip_members.trip_id and t.owner_id = auth.uid())
    or user_id = auth.uid()
  );

drop policy if exists "Owner can update members" on public.trip_members;
create policy "Owner can update members"
  on public.trip_members for update to authenticated
  using (
    exists (select 1 from public.trips t where t.id = trip_members.trip_id and t.owner_id = auth.uid())
  );

drop policy if exists "Owner or self can remove membership" on public.trip_members;
create policy "Owner or self can remove membership"
  on public.trip_members for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.trips t where t.id = trip_members.trip_id and t.owner_id = auth.uid())
  );

alter table public.trip_invites enable row level security;

drop policy if exists "Anyone authenticated can read invites" on public.trip_invites;
create policy "Anyone authenticated can read invites"
  on public.trip_invites for select to authenticated using (true);

drop policy if exists "Owner can create invites" on public.trip_invites;
create policy "Owner can create invites"
  on public.trip_invites for insert to authenticated
  with check (
    exists (select 1 from public.trips t where t.id = trip_invites.trip_id and t.owner_id = auth.uid())
  );

drop policy if exists "Owner can update invites" on public.trip_invites;
create policy "Owner can update invites"
  on public.trip_invites for update to authenticated
  using (
    exists (select 1 from public.trips t where t.id = trip_invites.trip_id and t.owner_id = auth.uid())
  );

-- ── Join by code ────────────────────────────────────────────────────────────

create or replace function public.join_trip_by_code(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.trip_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into inv from public.trip_invites where code = upper(trim(invite_code));
  if not found then raise exception 'Invalid invite code'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception 'Invite expired'; end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then raise exception 'Invite has reached max uses'; end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (inv.trip_id, auth.uid(), inv.role)
  on conflict (trip_id, user_id) do update set role = excluded.role;

  update public.trip_invites set uses = uses + 1 where code = inv.code;
  return inv.trip_id;
end;
$$;

grant execute on function public.join_trip_by_code(text) to authenticated;

-- ── Media metadata ──────────────────────────────────────────────────────────

create table if not exists public.media_objects (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  mime_type text,
  byte_size bigint,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create index if not exists media_objects_trip_id_idx on public.media_objects (trip_id);
alter table public.media_objects enable row level security;

drop policy if exists "Members can view media metadata" on public.media_objects;
create policy "Members can view media metadata"
  on public.media_objects for select to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists "Contributors can insert media metadata" on public.media_objects;
create policy "Contributors can insert media metadata"
  on public.media_objects for insert to authenticated
  with check (uploaded_by = auth.uid() and public.is_trip_member(trip_id));

-- ── Offline map regions ─────────────────────────────────────────────────────

create table if not exists public.map_regions (
  id text primary key,
  name text not null,
  description text,
  river text,
  bounds jsonb not null,
  center jsonb not null,
  default_zoom int not null default 10,
  pmtiles_path text,
  size_mb int,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.map_regions enable row level security;

drop policy if exists "Anyone can read active map regions" on public.map_regions;
create policy "Anyone can read active map regions"
  on public.map_regions for select to authenticated, anon
  using (active = true);

insert into public.map_regions (
  id, name, description, river, bounds, center, default_zoom, pmtiles_path, sort_order
) values (
  'main-salmon-river',
  'Main Salmon River',
  'Wilderness section from Corn Creek (launch) through Riggins area. Preload before July 20 launch.',
  'Salmon River',
  '{"sw":{"lat":44.95,"lng":-116.55},"ne":{"lat":46.05,"lng":-114.15}}'::jsonb,
  '{"lat":45.45,"lng":-115.35}'::jsonb,
  9,
  '/maps/main-salmon-river.pmtiles',
  1
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  river = excluded.river,
  bounds = excluded.bounds,
  center = excluded.center,
  default_zoom = excluded.default_zoom,
  pmtiles_path = excluded.pmtiles_path,
  sort_order = excluded.sort_order,
  active = true;

-- ── Photo storage bucket: run 002_trip_media_storage.sql next ───────────────
