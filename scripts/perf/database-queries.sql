-- Read-only database probes; no app server or build is needed.
-- Run against local Supabase:
-- psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -X -f scripts/perf/database-queries.sql
-- Optionally pass -v user_id=<uuid>; otherwise use the local user with the most submissions.
\set ON_ERROR_STOP on
\pset pager off

begin read only;
\if :{?user_id}
\else
  select coalesce(
    (select user_id from public.submissions group by user_id order by count(*) desc limit 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  )::text as user_id \gset
\endif
select set_config('request.jwt.claim.sub', :'user_id', true) as caller \gset
set local role authenticated;

-- The Library's first page: should stop at 20 entries in problems_n_id_idx.
explain (analyze, buffers)
select problem_id from public.user_problem_index
order by n, problem_id limit 20;

-- Offset pagination still walks the offset, but should avoid a catalog heap scan/sort.
explain (analyze, buffers)
select problem_id from public.user_problem_index
order by n, problem_id limit 20 offset 1000;

-- The all-time Progress snapshot also benefits from the narrow catalog index.
explain (analyze, buffers)
select * from public.problem_state_summary();

-- Measure the actual filtered RPC. SET search_path keeps its internal plan opaque;
-- use the function body when investigating individual scan/join nodes.
explain (analyze, buffers)
select * from public.progress_breakdown('day', now() - interval '7 days');

rollback;
