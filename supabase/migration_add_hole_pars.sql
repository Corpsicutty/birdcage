-- Add per-hole par list (default all 3). Run once on existing Birdcage projects.

alter table public.sessions
  add column if not exists hole_pars int[] not null default (array_fill(3, array[9])::int[]);
