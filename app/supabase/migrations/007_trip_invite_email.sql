-- Track who was emailed and allow owners to look up crew emails for re-invites.

alter table public.trip_invites
  add column if not exists invited_email text,
  add column if not exists invited_user_id uuid references public.profiles (id) on delete set null;

create index if not exists trip_invites_invited_user_id_idx on public.trip_invites (invited_user_id);

-- Return auth email for a past crew member the caller has shared a trip with.
create or replace function public.get_user_email_for_invite(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  found_email text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.trip_members me
    join public.trip_members them on them.trip_id = me.trip_id
    where me.user_id = uid and them.user_id = p_user_id
  ) and not exists (
    select 1 from public.trips t
    where t.owner_id = uid
      and exists (
        select 1 from public.trip_members m
        where m.trip_id = t.id and m.user_id = p_user_id
      )
  ) and not exists (
    select 1 from public.trips t
    where t.owner_id = p_user_id
      and exists (
        select 1 from public.trip_members m
        where m.trip_id = t.id and m.user_id = uid
      )
  ) then
    raise exception 'Not allowed to look up this user';
  end if;

  select u.email into found_email from auth.users u where u.id = p_user_id;
  return found_email;
end;
$$;

grant execute on function public.get_user_email_for_invite(uuid) to authenticated;
