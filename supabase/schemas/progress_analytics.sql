-- Progress analytics: a read-only reporting layer over the submissions log.
--
-- Nothing here stores state — `submissions` is the fact table and everything
-- below is a projection of it. Two objects:
--
--   * `submission_facts` — one row per submission with every analytics dimension
--     (topic / difficulty / series / test) pre-joined and attempt-ordering
--     resolved, so "first-attempt accuracy" is derivable. Backs timeline/list
--     drill-downs directly.
--   * `progress_breakdown(...)` — a single parameterized `group by` over that
--     view. Returns raw counts (not ratios); callers derive accuracy / avg time.
--     One primitive powers the Topic lens, difficulty calibration, and the
--     weakness ranking that feeds the "drill this" loop.
--
-- Both run as the invoker, so `submissions` RLS (user_id = auth.uid()) applies
-- transparently. Do NOT make either `security definer` — that would expose every
-- user's data through the report.

-- Flat, RLS-scoped fact table: one row per submission with all dimensions joined
-- and per-(user, problem) attempt ordering.
create or replace view public.submission_facts
with (security_invoker = on) as
select
  s.id            as submission_id,
  s.user_id,
  s.problem_id,
  -- problem dimensions
  p.topic,
  p.difficulty,
  p.is_computational,
  p.verified,
  -- contest dimensions
  t.id            as test_id,
  t.name          as test_name,
  se.id           as series_id,
  se.name         as series_name,
  -- interaction facts
  s.source,
  s.session_id,
  s.is_correct,
  s.skipped,
  s.flagged,
  s.elapsed_ms,
  s.tries_used,
  s.created_at,
  -- 1,2,3… over all submissions for this problem (skips included).
  row_number() over (
    partition by s.user_id, s.problem_id
    order by s.created_at, s.id
  ) as attempt_seq,
  -- 1,2,3… over graded (non-skip) attempts only; null on skips. `graded_seq = 1`
  -- is the user's first real attempt at the problem — the basis for
  -- first-attempt accuracy (a skip must not be miscounted as that first try).
  -- True first-try accuracy pairs this with `tries_used = 0`: graded_seq picks the
  -- first *encounter*, tries_used confirms it was nailed on the first *try* within
  -- it (multi-try practice can burn wrong tries that never became their own rows).
  case when not s.skipped then
    row_number() over (
      partition by s.user_id, s.problem_id, s.skipped
      order by s.created_at, s.id
    )
  end as graded_seq
from public.submissions s
join public.problems p on p.id = s.problem_id
left join public.tests  t  on t.id  = p.test_id
left join public.series se on se.id = t.series_id;

grant select on public.submission_facts to authenticated;

-- One group-by over submission_facts, parameterized by dimension + filters.
-- Returns raw counts; the client derives accuracy / first-accuracy / avg time
-- (keeps division-by-zero out of SQL and the metric mix flexible per surface).
--
-- p_dimension: 'topic' | 'series' | 'difficulty' | 'day'. For 'series' the
-- bucket_key is the series id (stable) and bucket_label the series name; for the
-- others key and label coincide. 'day' buckets by the user's local date (p_tz).
create or replace function public.progress_breakdown(
  p_dimension      text,
  p_from           timestamptz default null,
  p_to             timestamptz default null,
  p_tz             text        default 'UTC',
  p_topics         text[]      default null,
  p_series         bigint[]    default null,
  p_difficulty_min integer     default null,
  p_difficulty_max integer     default null,
  p_source         text        default null,
  p_computational  boolean     default null
)
returns table (
  bucket_key        text,
  bucket_label      text,
  seen              bigint,   -- all submissions (incl. skips)
  graded            bigint,   -- non-skip attempts
  correct           bigint,   -- graded attempts that were correct
  skipped           bigint,
  first_graded      bigint,   -- problems attempted (graded) for the first time
  first_correct     bigint,   -- solved on the very first try (first encounter, tries_used = 0)
  distinct_problems bigint,
  graded_time_ms    bigint,   -- sum(elapsed) over timed graded attempts
  graded_timed      bigint,   -- count for the avg-time denominator
  last_activity     timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select
      case p_dimension
        when 'topic'      then coalesce(f.topic, 'Untagged')
        when 'series'     then coalesce(f.series_id::text, 'none')
        when 'difficulty' then coalesce(f.difficulty::text, '0')
        when 'day'        then to_char((f.created_at at time zone p_tz)::date, 'YYYY-MM-DD')
      end as dim_key,
      f.series_name,
      f.problem_id,
      f.skipped,
      f.is_correct,
      f.graded_seq,
      f.tries_used,
      f.elapsed_ms,
      f.created_at
    from public.submission_facts f
    where (p_from is null or f.created_at >= p_from)
      and (p_to   is null or f.created_at <  p_to)
      and (p_topics is null or f.topic = any(p_topics))
      and (p_series is null or f.series_id = any(p_series))
      and (p_difficulty_min is null or f.difficulty >= p_difficulty_min)
      and (p_difficulty_max is null or f.difficulty <= p_difficulty_max)
      and (p_source is null or f.source = p_source)
      and (p_computational is null or f.is_computational = p_computational)
  )
  select
    dim_key as bucket_key,
    case when p_dimension = 'series'
      then coalesce(max(series_name), '—')
      else dim_key
    end as bucket_label,
    count(*)                                                        as seen,
    count(*) filter (where not skipped)                            as graded,
    count(*) filter (where is_correct)                             as correct,
    count(*) filter (where skipped)                                as skipped,
    count(*) filter (where graded_seq = 1)                         as first_graded,
    count(*) filter (where graded_seq = 1 and is_correct and coalesce(tries_used, 0) = 0) as first_correct,
    count(distinct problem_id)                                     as distinct_problems,
    coalesce(sum(elapsed_ms) filter (where not skipped and elapsed_ms is not null), 0) as graded_time_ms,
    count(*) filter (where not skipped and elapsed_ms is not null) as graded_timed,
    max(created_at)                                                as last_activity
  from base
  where dim_key is not null
  group by dim_key
  order by dim_key;
$$;

grant execute on function public.progress_breakdown to authenticated;
