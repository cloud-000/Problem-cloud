-- Goal scope resolution: the single definition of "which problems does this
-- slice of the catalog contain, and can we grade them?"
--
-- `docs/goals.md` §3–§5 is the product spec; this file is the authoritative
-- implementation of it. Three objects, deliberately layered:
--
--   * `is_gradeable(...)`      — eligibility, as an immutable function (§4).
--   * `canonical_placements`   — one row per (placement, canonical) carrying the
--                                placement's contest coordinates and the
--                                canonical's gradeability (§3).
--   * `goal_scope_canonicals(scope)` — THE resolver. Every goal family goes
--                                through it, so no surface can invent a second
--                                answer to "what is in scope?" (§8).
--
-- Nothing here is goal-specific in its data: it reads only the world-readable
-- catalog (`problems`/`tests`), so it is `security invoker` throughout and adds
-- no new read surface. Goals-owned tables arrive in a later file.

-- Eligibility, defined once (`docs/goals.md` §4). The TypeScript twin is
-- `hasComparableAnswer` (`src/lib/problem-response.ts`) plus the trainer's
-- non-blank-statement floor; this function is the definition and that one is
-- the mirror. `choices` is overloaded — length 1 means the lone element IS the
-- answer key — so the only safe test of a usable key is that `answer_index`
-- actually indexes the array, which is what the range check below does for both
-- the multiple-choice and free-response spellings at once.
--
-- IMMUTABLE (not STABLE) on purpose: it reads no tables, only its arguments, so
-- it can be inlined into a view and used in an index expression later if the
-- denominator ever needs one.
create or replace function public.is_gradeable(
  p_statement     text,
  p_answer_status text,
  p_answer_index  integer,
  p_choices       text[]
) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_statement is not null
     and p_statement <> ''
     and p_answer_status = 'known'
     and p_answer_index is not null
     and p_answer_index >= 0
     and p_answer_index < coalesce(pg_catalog.cardinality(p_choices), 0);
$$;

-- Expression covering index on (id, is_gradeable(...)): lets canonical
-- gradeability lookups resolve via an Index-Only Scan without visiting the
-- heap or detoasting `statement` and `choices`.
create index problems_id_gradeable_idx
  on public.problems (
    id,
    public.is_gradeable(statement, answer_status, answer_index, choices)
  );

-- One row per catalog placement, resolved to the canonical it shares state with.
-- A canonical with no aliases contributes exactly one row; a duplicated problem
-- contributes one row per test it appears under, all carrying the same
-- `canonical_id`.
--
-- Two different rows supply the two different facts, and mixing them up is the
-- bug `docs/goals.md` §4 warns about:
--
--   * contest coordinates (series/division/format/year) and `topic` come from
--     the PLACEMENT — the whole point is that a canonical can be reached
--     through a test it does not itself live under;
--   * `gradeable` comes from the CANONICAL — an alias is its own `problems` row
--     with its own statement and choices, but practice always serves the
--     canonical, so the canonical's answer decides whether the problem can be
--     graded at all.
--
-- Deliberately NOT filtered to gradeable rows: eligibility applies to the set
-- family only (§4), and event families must still resolve scope for work done
-- on a problem whose answer has since been withdrawn.
create or replace view public.canonical_placements
with (security_invoker = on) as
select
  coalesce(p.canonical_id, p.id) as canonical_id,
  p.id                           as placement_id,
  p.test_id,
  t.series_id,
  t.division,
  t.format,
  t.year,
  p.topic,
  public.is_gradeable(c.statement, c.answer_status, c.answer_index, c.choices) as gradeable,
  p.n
from public.problems p
left join public.tests t on t.id = p.test_id
-- The canonical row itself. An inner join is correct: `canonical_id` is a real
-- FK, so this only ever drops a row whose canonical vanished mid-transaction.
join public.problems c on c.id = coalesce(p.canonical_id, p.id);

-- NOTE: pgdelta DROP+CREATEs a view on any body change and does NOT re-emit its
-- grants. Any regenerated migration touching this view must re-add the grant by
-- hand (see supabase/SYNC.md).
grant select on public.canonical_placements to authenticated;

-- THE scope resolver (`docs/goals.md` §3). Takes a `GoalScope` — structurally
-- the practice Track — and answers, for every canonical the scope reaches,
-- whether it is gradeable.
--
--   {"topic": [...], "seriesIds": ["7", ...],
--    "seriesScopes": {"7": {"divisions": [...], "formats": [...],
--                           "problemNumbers": [21, 25],
--                           "yearRange": [2010, 2024]}}}
--
-- Semantics, in the order the WHERE clause states them:
--
--   * a semi-join, not a join: the question is *does this canonical have any
--     placement satisfying the scope?* Joining placements to events instead
--     would fan one submission into N rows and break every count (§3);
--   * series clauses are OR-ed, each AND-ed with its OWN divisions/formats,
--     optional 1-based problemNumbers range (stored as problems.n + 1;
--     matched against the placement's 0-based n), and optional inclusive
--     yearRange on tests.year, so a division, #21–25, or 2010–2024 chosen
--     for one series never filters another with a different vocabulary,
--     number line, or year span (§3). This mirrors `seriesScopeFilter` in
--     `src/lib/trainer.ts`, and where they disagree, THIS is right and the
--     client is the bug;
--   * topic narrows the result across all clauses;
--   * an empty axis means no narrowing on that axis. An empty scope therefore
--     selects the whole catalog, which is the intended reading of a Track with
--     nothing chosen.
--
-- `gradeable` is returned rather than applied: the set family filters on it to
-- build its denominator, and the event families ignore it (§4).
--
-- Returned as a set-returning function rather than a view with a scope column
-- so that a batched, multi-scope family RPC can call it once per scope via
-- LATERAL and still issue one round trip (§8).
create or replace function public.goal_scope_canonicals(p_scope jsonb)
returns table (canonical_id bigint, gradeable boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with scope as (
    select
      coalesce(p_scope -> 'topic',        '[]'::jsonb) as topics,
      coalesce(p_scope -> 'seriesIds',    '[]'::jsonb) as series_ids,
      coalesce(p_scope -> 'seriesScopes', '{}'::jsonb) as series_scopes
  ),
  -- One row per selected series: the OR-ed clauses, each carrying its own
  -- division/format vocabulary, optional 1-based problem-number range, and
  -- optional inclusive year range (§3).
  clauses as (
    select
      sid::bigint as series_id,
      (select pg_catalog.array_agg(d)
         from pg_catalog.jsonb_array_elements_text(
           coalesce(s.series_scopes -> sid -> 'divisions', '[]'::jsonb)) d) as divisions,
      (select pg_catalog.array_agg(f)
         from pg_catalog.jsonb_array_elements_text(
           coalesce(s.series_scopes -> sid -> 'formats', '[]'::jsonb)) f) as formats,
      case
        when pg_catalog.jsonb_typeof(s.series_scopes -> sid -> 'problemNumbers') = 'array'
         and pg_catalog.jsonb_array_length(s.series_scopes -> sid -> 'problemNumbers') = 2
        then (s.series_scopes -> sid -> 'problemNumbers' ->> 0)::integer
      end as n_lo,
      case
        when pg_catalog.jsonb_typeof(s.series_scopes -> sid -> 'problemNumbers') = 'array'
         and pg_catalog.jsonb_array_length(s.series_scopes -> sid -> 'problemNumbers') = 2
        then (s.series_scopes -> sid -> 'problemNumbers' ->> 1)::integer
      end as n_hi,
      case
        when pg_catalog.jsonb_typeof(s.series_scopes -> sid -> 'yearRange') = 'array'
         and pg_catalog.jsonb_array_length(s.series_scopes -> sid -> 'yearRange') = 2
        then (s.series_scopes -> sid -> 'yearRange' ->> 0)::integer
      end as year_lo,
      case
        when pg_catalog.jsonb_typeof(s.series_scopes -> sid -> 'yearRange') = 'array'
         and pg_catalog.jsonb_array_length(s.series_scopes -> sid -> 'yearRange') = 2
        then (s.series_scopes -> sid -> 'yearRange' ->> 1)::integer
      end as year_hi
    from scope s, pg_catalog.jsonb_array_elements_text(s.series_ids) as sid
    -- Scope is user-authored JSON reaching us through a jsonb column, so a
    -- non-numeric id must be skipped rather than raise: one malformed entry
    -- would otherwise fail the whole goals list.
    where sid ~ '^-?[0-9]+$'
  ),
  filters as (
    select
      (select pg_catalog.array_agg(t)
         from pg_catalog.jsonb_array_elements_text(s.topics) t) as topics,
      (select pg_catalog.count(*) from clauses) as clause_count
    from scope s
  ),
  matched as (
    -- Unscoped by series: scan `problems` directly without joining `tests`.
    select distinct coalesce(p.canonical_id, p.id) as canonical_id
    from filters f
    join public.problems p
      on (f.topics is null or p.topic = any(f.topics))
    where f.clause_count = 0

    union

    -- Scoped by one or more series clauses: drive from `clauses` -> `tests`
    -- (`tests_series_scope_idx`) -> `problems` (`problems_test_id_idx`), so a
    -- series-scoped goal only touches placements in the selected series.
    select distinct coalesce(p.canonical_id, p.id) as canonical_id
    from filters f
    join clauses cl on f.clause_count > 0
    join public.tests t
      on t.series_id = cl.series_id
     and (cl.divisions is null or t.division = any(cl.divisions))
     and (cl.formats   is null or t.format   = any(cl.formats))
     and (
       cl.year_lo is null or cl.year_hi is null
       or (t.year is not null and t.year >= cl.year_lo and t.year <= cl.year_hi)
     )
    join public.problems p
      on p.test_id = t.id
     and (f.topics is null or p.topic = any(f.topics))
     and (
       cl.n_lo is null or cl.n_hi is null
       or (p.n >= cl.n_lo - 1 and p.n <= cl.n_hi - 1)
     )
  )
  select
    m.canonical_id,
    public.is_gradeable(c.statement, c.answer_status, c.answer_index, c.choices) as gradeable
  from matched m
  join public.problems c on c.id = m.canonical_id;
$$;

grant execute on function public.is_gradeable(text, text, integer, text[])
  to authenticated;
grant execute on function public.goal_scope_canonicals(jsonb) to authenticated;
