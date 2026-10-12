-- Apply after 008. Atomic union of immutable changes; old payload writers are blocked.
create or replace function public.guard_trip_change_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.payload->'_sync'->>'version' = '2'
     and new.payload is distinct from old.payload
     and coalesce(current_setting('tripreport.sync_v2', true), '') <> 'on' then
    raise exception 'This trip uses sync v2. Update TripReport before editing.';
  end if;
  return new;
end $$;
drop trigger if exists guard_trip_change_history on public.trips;
create trigger guard_trip_change_history before update on public.trips
for each row execute function public.guard_trip_change_history();

create or replace function public.sync_trip_changes(
  p_id uuid, p_ops jsonb, p_metadata jsonb, p_legacy_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.trips%rowtype;
  combined jsonb;
  stamp timestamptz := clock_timestamp();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 150000
     or octet_length(p_ops::text) > 50000000 then raise exception 'Invalid or oversized history'; end if;
  -- Serialize both creation and updates, including a previously absent trip.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into t from public.trips where id = p_id for update;
  if t.id is null then
    insert into public.profiles(id, display_name) values(uid,'User') on conflict(id) do nothing;
    insert into public.trips(id,owner_id,name,status,privacy,payload)
      values(p_id,uid,coalesce(p_metadata->>'name','Trip'),'planning','friends','{}');
    insert into public.trip_members(trip_id,user_id,role) values(p_id,uid,'owner')
      on conflict(trip_id,user_id) do nothing;
    select * into t from public.trips where id=p_id;
  elsif t.owner_id <> uid and not exists(
    select 1 from public.trip_members where trip_id=p_id and user_id=uid and role in ('owner','contributor')
  ) then raise exception 'Trip contributor access required'; end if;
  if coalesce(t.payload->'_sync'->>'version','') <> '2'
     and t.updated_at is distinct from p_legacy_updated_at and p_legacy_updated_at is not null then
    raise exception using message='Legacy trip changed; retry sync', errcode='40001';
  end if;
  -- A caller must first read an existing legacy snapshot, never replace it blindly.
  if coalesce(t.payload->'_sync'->>'version','') <> '2'
     and t.payload <> '{}'::jsonb and p_legacy_updated_at is null then
    raise exception using message='Read legacy trip before sync', errcode='40001';
  end if;
  combined := coalesce(t.payload->'_sync'->'ops','[]'::jsonb) || p_ops;
  if exists(select 1 from jsonb_array_elements(combined) o
    where jsonb_typeof(o->'id') is distinct from 'string'
      or jsonb_typeof(o->'parents') is distinct from 'array'
      or jsonb_typeof(o->'recordId') is distinct from 'string'
      or jsonb_typeof(o->'field') is distinct from 'string'
      or coalesce(o->>'collection','') not in ('trip','locations','events','entries','track','trackSessions','collaborators','gearItems','meals','expenses','expenseGroups','shoppingItems')
      or o->>'field' in ('__proto__','constructor','prototype')
      or (o->>'collection'='trip' and (o->>'recordId'<>p_id::text or o->>'field' not in
        ('name','types','location','startDate','endDate','privacy','status','startedAt','endedAt','coverPhoto','mapArea','offlineRegions','recap','timeZone')))
  ) then raise exception 'Invalid change'; end if;
  if exists(select 1 from jsonb_array_elements(combined) o group by o->>'id'
    having count(distinct o)>1) then raise exception 'Change ID collision'; end if;
  select coalesce(jsonb_agg(o order by o->>'id'),'[]'::jsonb) into combined
    from (select distinct o from jsonb_array_elements(combined) o) unique_ops;
  if jsonb_array_length(combined) > 150000 or octet_length(combined::text) > 50000000 then
    raise exception 'Merged history exceeds capacity; existing cloud data was preserved';
  end if;
  if exists (
    select 1 from jsonb_array_elements(combined) child,
      lateral jsonb_array_elements_text(child->'parents') as ancestry(parent_id)
    where not exists (
      select 1 from jsonb_array_elements(combined) parent
      where parent->>'id'=parent_id
        and parent->>'collection'=child->>'collection'
        and parent->>'recordId'=child->>'recordId'
        and parent->>'field'=child->>'field'
        and parent->>'id'<>child->>'id'
    )
  ) then raise exception 'Invalid change ancestry'; end if;
  perform set_config('tripreport.sync_v2','on',true);
  if t.payload->'_sync'->'ops' is distinct from combined then
    update public.trips set payload=jsonb_build_object('_sync',jsonb_build_object('version',2,'ops',combined)),
      name=coalesce(p_metadata->>'name',name), updated_at=stamp where id=p_id;
  end if;
  perform set_config('tripreport.sync_v2','off',true);
  return jsonb_build_object('ops',combined,'ownerId',t.owner_id,'updatedAt',stamp);
end $$;
revoke all on function public.sync_trip_changes(uuid,jsonb,jsonb,timestamptz) from public;
grant execute on function public.sync_trip_changes(uuid,jsonb,jsonb,timestamptz) to authenticated;

-- Media IDs are immutable. Content-addressed paths make upload retries safe.
alter table public.media_objects add column if not exists sha256 text;
alter table public.media_objects add column if not exists thumb_sha256 text;
create or replace function public.guard_media_contents()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.sha256 is not null and (new.sha256 is distinct from old.sha256
    or new.trip_id is distinct from old.trip_id or new.storage_path is distinct from old.storage_path
    or new.thumb_sha256 is distinct from old.thumb_sha256) then
    raise exception 'Attachment contents are immutable. Use a new media ID.';
  end if;
  return new;
end $$;
drop trigger if exists guard_media_contents on public.media_objects;
create trigger guard_media_contents before update on public.media_objects
for each row execute function public.guard_media_contents();
