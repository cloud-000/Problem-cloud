-- Seed a baseline 'overall' rating (1500 / RD 350) for every problem.
-- Idempotent: problems that already have a row are left untouched, so this is
-- safe to re-run after new problems are synced in. Player rating rows are
-- created by recompute_ratings(); this snippet only makes every problem
-- joinable at the seed rating before any play data exists.
insert into public.problem_ratings (problem_id, scope, rating, rd)
select id, 'overall', 1500, 350
from public.problems
on conflict (problem_id, scope) do nothing;
