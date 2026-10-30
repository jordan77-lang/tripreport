-- Adds 'dessert' and 'happy-hour' meal slots to the shared saved-meal catalog.
-- Run in Supabase SQL Editor after 001–010 (safe to re-run).

alter table public.saved_meals drop constraint if exists saved_meals_slot_check;
alter table public.saved_meals
  add constraint saved_meals_slot_check
  check (slot in ('breakfast', 'lunch', 'happy-hour', 'dinner', 'dessert', 'snack'));

create or replace function public.upsert_saved_meal(
  p_name text,
  p_slot text,
  p_ingredients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  meal_key text := lower(btrim(coalesce(p_name, '')));
  display_name text := btrim(coalesce(p_name, ''));
  next_slot text := coalesce(nullif(btrim(coalesce(p_slot, '')), ''), 'dinner');
  incoming jsonb := coalesce(p_ingredients, '[]'::jsonb);
  existing jsonb := '[]'::jsonb;
  merged jsonb := '[]'::jsonb;
  result jsonb;
  item jsonb;
  ing_name text;
  ing_key text;
  seen text[] := '{}';
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if meal_key = '' then
    raise exception 'Meal name is required';
  end if;
  if next_slot not in ('breakfast', 'lunch', 'happy-hour', 'dinner', 'dessert', 'snack') then
    next_slot := 'dinner';
  end if;

  select s.ingredients into existing
  from public.saved_meals s
  where s.name_key = meal_key;
  if existing is null then
    existing := '[]'::jsonb;
  end if;

  for item in
    select value from jsonb_array_elements(existing || incoming)
  loop
    ing_name := btrim(coalesce(item->>'name', ''));
    ing_key := lower(ing_name);
    if ing_key = '' or ing_key = any (seen) then
      continue;
    end if;
    seen := array_append(seen, ing_key);
    merged := merged || jsonb_build_array(
      jsonb_build_object('name', ing_name, 'qty', coalesce(item->>'qty', ''))
    );
    insert into public.saved_ingredients (name_key, name, created_by)
    values (ing_key, ing_name, uid)
    on conflict (name_key) do update
      set name = excluded.name;
  end loop;

  insert into public.saved_meals (name, name_key, slot, ingredients, created_by, updated_at)
  values (display_name, meal_key, next_slot, merged, uid, now())
  on conflict (name_key) do update
    set name = excluded.name,
        slot = excluded.slot,
        ingredients = excluded.ingredients,
        updated_at = now();

  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'nameKey', s.name_key,
    'slot', s.slot,
    'ingredients', s.ingredients,
    'updatedAt', (extract(epoch from s.updated_at) * 1000)
  )
  into result
  from public.saved_meals s
  where s.name_key = meal_key;

  return result;
end;
$$;

grant execute on function public.upsert_saved_meal(text, text, jsonb) to authenticated;
