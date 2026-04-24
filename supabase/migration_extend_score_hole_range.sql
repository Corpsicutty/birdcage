-- Allow more than 18 holes in a round (long / multi-loop courses).
-- Replace the hole_number range check with 1..99.

do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'scores'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%hole_number%';
  if cname is not null then
    execute format('alter table public.scores drop constraint %I', cname);
  end if;
end $$;

alter table public.scores
  add constraint scores_hole_number_check check (hole_number between 1 and 99);
