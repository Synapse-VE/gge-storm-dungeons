-- ============================================================================
-- RPCs de escritura para el collector (service_role)
-- ============================================================================

create or replace function public.upsert_storm_scan(
  p_forts jsonb,
  p_isles jsonb,
  p_radius integer,
  p_complete boolean default false,
  p_scan_started timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storm_forts
    (kid, position_x, position_y, isle_id, victory_count, is_visible, available_at)
  select
    4,
    (f->>'position_x')::smallint,
    (f->>'position_y')::smallint,
    (f->>'isle_id')::smallint,
    coalesce((f->>'victory_count')::smallint, 0),
    coalesce((f->>'is_visible')::boolean, true),
    (f->>'available_at')::timestamptz
  from jsonb_array_elements(coalesce(p_forts, '[]'::jsonb)) as f
  on conflict (kid, position_x, position_y) do update set
    isle_id = excluded.isle_id,
    victory_count = excluded.victory_count,
    is_visible = excluded.is_visible,
    available_at = case
      when excluded.available_at <= now() and storm_forts.available_at <= storm_forts.updated_at
        then storm_forts.available_at
      else excluded.available_at
    end,
    available_since_observed = case
      when not (excluded.available_at <= now()) then false
      when storm_forts.available_at <= storm_forts.updated_at then storm_forts.available_since_observed
      else true
    end,
    last_available_seconds = case
      when not (excluded.available_at <= now())
        and storm_forts.available_at <= storm_forts.updated_at
        and storm_forts.available_since_observed
        then round(extract(epoch from storm_forts.updated_at + (now() - storm_forts.updated_at) / 2 - storm_forts.available_at))::integer
      else storm_forts.last_available_seconds
    end,
    updated_at = now();

  insert into public.storm_isles
    (kid, position_x, position_y, object_id, isle_id, occupier_id, state, available_at)
  select
    4,
    (i->>'position_x')::smallint,
    (i->>'position_y')::smallint,
    (i->>'object_id')::integer,
    (i->>'isle_id')::smallint,
    nullif((i->>'occupier_id')::bigint, 0),
    coalesce((i->>'state')::smallint, 0),
    (i->>'available_at')::timestamptz
  from jsonb_array_elements(coalesce(p_isles, '[]'::jsonb)) as i
  on conflict (kid, position_x, position_y) do update set
    object_id = excluded.object_id,
    isle_id = excluded.isle_id,
    occupier_id = excluded.occupier_id,
    state = excluded.state,
    available_at = case
      when excluded.state = 0 and storm_isles.available_at <= excluded.available_at
        then storm_isles.available_at
      else excluded.available_at
    end,
    available_since_observed = case
      when excluded.state <> 0 then false
      when storm_isles.state = 0 then storm_isles.available_since_observed
      else true
    end,
    last_available_seconds = case
      when excluded.state <> 0
        and storm_isles.state = 0
        and storm_isles.available_since_observed
        then round(extract(epoch from storm_isles.updated_at + (now() - storm_isles.updated_at) / 2 - storm_isles.available_at))::integer
      else storm_isles.last_available_seconds
    end,
    updated_at = now();

  if p_complete then
    delete from public.storm_forts where updated_at < p_scan_started;
    delete from public.storm_isles where updated_at < p_scan_started;
  end if;

  insert into public.storm_meta (id, scan_radius, last_scan_at)
  values (true, p_radius, now())
  on conflict (id) do update set
    scan_radius = excluded.scan_radius,
    last_scan_at = excluded.last_scan_at;
end;
$$;

revoke all on function public.upsert_storm_scan(jsonb, jsonb, integer, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_storm_scan(jsonb, jsonb, integer, boolean, timestamptz) to service_role;

-- ----------------------------------------------------------------------------
-- Dungeons: upsert del barrido y del historial de ataques
-- ----------------------------------------------------------------------------

create or replace function public.upsert_dungeons_scan(
  p_dungeons jsonb,
  p_scan_started timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row_dungeon jsonb;
  previous_record public.dungeons%rowtype;
  new_attack_at timestamptz;
  new_attacker bigint;
  new_global timestamptz;
  old_global timestamptz;
begin
  for row_dungeon in select * from jsonb_array_elements(coalesce(p_dungeons, '[]'::jsonb))
  loop
    new_attack_at := (row_dungeon->>'last_attack_at')::timestamptz;
    new_attacker := nullif((row_dungeon->>'last_attacker_id')::bigint, 0);
    new_global := (row_dungeon->>'global_available_at')::timestamptz;

    select * into previous_record
    from public.dungeons
    where kid = (row_dungeon->>'kid')::smallint
      and position_x = (row_dungeon->>'position_x')::smallint
      and position_y = (row_dungeon->>'position_y')::smallint;

    if not found then
      insert into public.dungeons
        (kid, position_x, position_y, player_id, attack_count, last_attack_at,
         previous_attack_at, last_attacker_id, global_available_at, player_available_at, updated_at)
      values
        ((row_dungeon->>'kid')::smallint,
         (row_dungeon->>'position_x')::smallint,
         (row_dungeon->>'position_y')::smallint,
         new_attacker,
         coalesce((row_dungeon->>'attack_count')::integer, 0),
         new_attack_at,
         null,
         new_attacker,
         coalesce(new_global, now()),
         (row_dungeon->>'player_available_at')::timestamptz,
         now());
      if new_attack_at is not null and new_attacker is not null then
        insert into public.dungeons_history (kid, position_x, position_y, player_id, attacked_at)
        values ((row_dungeon->>'kid')::smallint, (row_dungeon->>'position_x')::smallint,
                (row_dungeon->>'position_y')::smallint, new_attacker, new_attack_at);
      end if;
    else
      old_global := previous_record.global_available_at;
      update public.dungeons d set
        attack_count = case
          when new_attack_at is not null and (previous_record.last_attack_at is null or new_attack_at > previous_record.last_attack_at)
            then previous_record.attack_count + 1
          else previous_record.attack_count
        end,
        previous_attack_at = case
          when new_attack_at is not null and (previous_record.last_attack_at is null or new_attack_at > previous_record.last_attack_at)
            then previous_record.last_attack_at
          else previous_record.previous_attack_at
        end,
        last_attack_at = greatest(coalesce(previous_record.last_attack_at, new_attack_at), new_attack_at),
        last_attacker_id = case
          when new_attack_at is not null and (previous_record.last_attack_at is null or new_attack_at > previous_record.last_attack_at)
            then new_attacker
          else previous_record.last_attacker_id
        end,
        player_id = case
          when new_attack_at is not null and (previous_record.last_attack_at is null or new_attack_at > previous_record.last_attack_at)
            then new_attacker
          else previous_record.player_id
        end,
        global_available_at = greatest(coalesce(old_global, new_global), coalesce(new_global, old_global)),
        player_available_at = coalesce((row_dungeon->>'player_available_at')::timestamptz, previous_record.player_available_at),
        updated_at = now()
      where d.kid = previous_record.kid
        and d.position_x = previous_record.position_x
        and d.position_y = previous_record.position_y;

      if new_attack_at is not null and new_attacker is not null
         and (previous_record.last_attack_at is null or new_attack_at > previous_record.last_attack_at) then
        insert into public.dungeons_history (kid, position_x, position_y, player_id, attacked_at)
        values (previous_record.kid, previous_record.position_x, previous_record.position_y, new_attacker, new_attack_at);
      end if;
    end if;
  end loop;

  insert into public.storm_meta (id) values (true) on conflict (id) do nothing;
end;
$$;

revoke all on function public.upsert_dungeons_scan(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_dungeons_scan(jsonb, timestamptz) to service_role;
