-- Realm castles are the seeds the official dungeon discovery/full scan uses.
alter table public.players add column if not exists castles_realm jsonb;

-- Small key/value store for collector checkpoints (dungeon init, discovery...).
create table if not exists public.scrape_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.scrape_state enable row level security;
revoke all on public.scrape_state from anon, authenticated;
grant all on public.scrape_state to service_role;

notify pgrst, 'reload schema';
