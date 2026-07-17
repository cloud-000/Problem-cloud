-- Caller-scoped catalog read model. Loaded LAST (after both submissions.sql and
-- ratings.sql) because it sits atop both: it flattens per-user progress AND the
-- live Glicko problem rating beside each catalog problem. Keeping it here avoids
-- a circular file dependency -- submissions.sql cannot reference problem_ratings
-- (defined later in ratings.sql), and ratings.sql's triggers need the submissions
-- table, so neither file can host a view spanning both.

-- Filter-oriented read model: one row per catalog problem with the current
-- caller's factual, scheduling, mastery and plan state flattened beside it.
-- This is not a second source of truth; every state column comes from
-- problem_progress and missing rows are normalized to zero activity/null intent.
create or replace view public.user_problem_index
with (security_invoker = on) as
select
  p.id as problem_id,
  p.n,
  p.test_id,
  t.series_id,
  t.division,
  t.format,
  p.topic,
  p.tags,
  p.difficulty,
  -- Live Glicko difficulty: the canonical's overall-scope problem rating (the
  -- authored `p.difficulty` column is dead -- every row is 0). NULL until the
  -- problem earns its first graded submission. The library Difficulty slider
  -- filters on this; see fetchProblems in src/lib/library.ts.
  pr.rating,
  p.quality,
  p.verified,
  p.is_computational,
  p.answer_index,
  (p.statement is not null) as has_statement,
  (p.choices is not null) as has_choices,
  (coalesce(cardinality(p.official_solutions), 0) > 0) as has_solution,
  coalesce(pp.times_seen, 0) as times_seen,
  coalesce(pp.times_reviewed, 0) as times_reviewed,
  coalesce(pp.times_correct, 0) as times_correct,
  coalesce(pp.times_skipped, 0) as times_skipped,
  coalesce(pp.total_time_ms, 0) as total_time_ms,
  pp.last_submission_at,
  pp.last_reviewed_at,
  pp.last_correct,
  pp.next_review_at,
  coalesce(pp.solved, false) as solved,
  pp.mastery,
  pp.engagement,
  coalesce(pp.engagement = 'ignored', false) as is_ignored,
  -- The canonical this row shares state with (NULL when it is its own canonical).
  -- NOTE: pgdelta recreates this view (DROP+CREATE, never CREATE OR REPLACE) on any
  -- body change, which DROPS the grant below. The generated migration must re-add
  -- `grant select ... to authenticated` by hand -- pgdelta will not re-emit an
  -- otherwise-unchanged grant after the DROP.
  p.canonical_id
from public.problems p
left join public.tests t on t.id = p.test_id
-- Progress is keyed on the canonical, so an alias placement reflects the shared
-- progress of the real problem (submissions are canonicalized on insert, so an
-- alias never accrues its own progress row anyway).
left join public.problem_progress pp
  on pp.problem_id = coalesce(p.canonical_id, p.id) and pp.user_id = auth.uid()
-- Rating is keyed on the canonical too, so an alias placement reflects the shared
-- problem's live Glicko difficulty. `problem_ratings` is world-readable.
left join public.problem_ratings pr
  on pr.problem_id = coalesce(p.canonical_id, p.id) and pr.scope = 'overall';

grant select on public.user_problem_index to authenticated;

-- Current all-time snapshot for the Progress page. Factual time-ranged analytics
-- remain backed only by submission_facts/progress_breakdown.
create or replace function public.problem_state_summary(
  p_series_id bigint default null
) returns table (
  total bigint,
  unseen bigint,
  seen bigint,
  attempted bigint,
  skipped_only bigint,
  review_due bigint,
  unassessed bigint,
  needs_work bigint,
  learning bigint,
  confident bigint,
  no_plan bigint,
  working bigint,
  revisit bigint,
  later bigint,
  ignored bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*),
    count(*) filter (where i.times_seen = 0),
    count(*) filter (where i.times_seen > 0),
    count(*) filter (where i.times_reviewed > 0),
    count(*) filter (where i.times_seen > 0 and i.times_reviewed = 0),
    count(*) filter (where i.next_review_at <= now()),
    count(*) filter (where i.mastery is null),
    count(*) filter (where i.mastery = 'needs_work'),
    count(*) filter (where i.mastery = 'learning'),
    count(*) filter (where i.mastery = 'confident'),
    count(*) filter (where i.engagement is null),
    count(*) filter (where i.engagement = 'working'),
    count(*) filter (where i.engagement = 'revisit'),
    count(*) filter (where i.engagement = 'later'),
    count(*) filter (where i.engagement = 'ignored')
  from public.user_problem_index i
  where p_series_id is null or i.series_id = p_series_id;
$$;

grant execute on function public.problem_state_summary(bigint) to authenticated;
