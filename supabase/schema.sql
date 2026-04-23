-- Birdcage MVP schema
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) = 6),
  status text not null default 'active' check (status in ('active', 'ended')),
  created_by_token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  ended_at timestamptz
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  claim_token text,
  created_at timestamptz not null default now()
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  hole_number int not null check (hole_number between 1 and 18),
  strokes int check (strokes is null or (strokes between 1 and 20)),
  created_at timestamptz not null default now(),
  unique (player_id, hole_number)
);

create index if not exists idx_sessions_code on public.sessions(code);
create index if not exists idx_sessions_expires on public.sessions(expires_at);
create index if not exists idx_players_session on public.players(session_id);
create index if not exists idx_scores_session on public.scores(session_id);
create index if not exists idx_scores_player on public.scores(player_id);

alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.scores;

alter table public.sessions enable row level security;
alter table public.players enable row level security;
alter table public.scores enable row level security;

-- MVP: fully open policies for no-login access.
-- Tighten later with token-aware RPCs when hardening.
drop policy if exists "open sessions" on public.sessions;
create policy "open sessions" on public.sessions for all using (true) with check (true);

drop policy if exists "open players" on public.players;
create policy "open players" on public.players for all using (true) with check (true);

drop policy if exists "open scores" on public.scores;
create policy "open scores" on public.scores for all using (true) with check (true);
