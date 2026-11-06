-- Public reads must go through the v_* views only. Supabase's default
-- privileges give anon/authenticated ALL on new tables and views, which is
-- dangerous because views such as v_storm_forts are auto-updatable and run as
-- their owner (bypassing the base table RLS).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

grant select on
  public.v_storm_forts,
  public.v_storm_isles,
  public.v_storm_meta,
  public.v_dungeons,
  public.v_dungeons_meta,
  public.v_dungeons_history,
  public.v_players
to anon, authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function public.upsert_storm_scan(jsonb, jsonb, integer, boolean, timestamptz) to service_role;
grant execute on function public.upsert_dungeons_scan(jsonb, timestamptz) to service_role;

-- Future objects created by postgres must not be born open.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

notify pgrst, 'reload schema';
