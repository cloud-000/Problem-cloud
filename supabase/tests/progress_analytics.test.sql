-- Regression contract for the direct-submission progress_breakdown path.
-- submission_facts deliberately remains the independent, window-based oracle.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(45);

insert into public.series (id, name) values
  (-981001, 'test:progress:zeta'),
  (-981002, 'test:progress:alpha');

insert into public.tests (id, series_id, name, sync_key) values
  (-981011, -981001, 'Progress alpha', 'test:progress:t1'),
  (-981012, -981002, 'Progress beta', 'test:progress:t2'),
  (-981013, null, 'Progress without series', 'test:progress:t3');

-- Null test_id and a test with null series_id exercise both left joins.
insert into public.problems
  (id, test_id, n, topic, difficulty, is_computational, statement, sync_key)
values
  (-981101, -981011, 0, 'before',    2, false, 'Before window', 'test:progress:before'),
  (-981102, -981011, 1, 'source',   10, true,  'Other source',  'test:progress:source'),
  (-981103, -981012, 0, 'preceded',  2, false, 'Predecessors',  'test:progress:preceded'),
  (-981104, -981012, 1, 'tie',      10, true,  'Timestamp tie', 'test:progress:tie'),
  (-981105, -981012, 2, 'tries',  null, true,  'UI retries',    'test:progress:tries'),
  (-981106, -981011, 2, 'canonical', 3, false, 'Canonical',     'test:progress:canonical'),
  (-981107, null,    0, null,    null, false, 'No test',       'test:progress:no-test'),
  (-981108, -981013, 0, null,       0, true,  'No series',     'test:progress:no-series'),
  (-981109, null,    1, 'ungraded', 0, false, 'Never graded',  'test:progress:ungraded'),
  (-981111, -981012, 4, 'other-user-only', 6, false, 'Other user', 'test:progress:other');

insert into public.problems
  (id, test_id, n, canonical_id, topic, difficulty, is_computational, sync_key)
values
  (-981110, -981012, 3, -981106, 'alias-only', 9, true, 'test:progress:alias');

insert into auth.users
  (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000098101', 'authenticated', 'authenticated',
   'progress-one@example.test', '{}', '{"username":"progress_analytics_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000098102', 'authenticated', 'authenticated',
   'progress-two@example.test', '{}', '{"username":"progress_analytics_two"}', now(), now());

-- Explicit negative IDs leave the identity sequence alone. IDs decrease as
-- timestamps advance, so min(id) cannot accidentally stand in for earliest.
-- All normal canonicalization/progress/rating triggers stay enabled.
insert into public.submissions
  (id, user_id, problem_id, is_correct, skipped, elapsed_ms, tries_used, source, created_at)
overriding system value
select id, '00000000-0000-0000-0000-000000098101'::uuid,
       problem_id, is_correct, skipped, elapsed_ms, tries_used, source, created_at::timestamptz
from (values
  (-98120101, -981101, false, false, 1000, 0, 'review',   '2026-07-31 23:59:59+00'),
  (-98120102, -981101, true,  false, 2000, 0, 'practice', '2026-08-01 00:00:00+00'),
  (-98120103, -981101, true,  false, 9000, 0, 'practice', '2026-08-03 00:00:00+00'),
  (-98120201, -981102, false, false, 1100, 0, 'library',  '2026-08-01 01:00:00+00'),
  (-98120202, -981102, true,  false, 2200, 0, 'practice', '2026-08-01 02:00:00+00'),
  -- Skips and ungraded non-skips must not consume the first graded position.
  (-98120301, -981103, null,  true,   700, 0, 'review',   '2026-07-31 23:00:00+00'),
  (-98120302, -981103, null,  false,  800, 0, 'library',  '2026-08-01 03:00:00+00'),
  (-98120303, -981103, true,  false, 3000, 0, 'practice', '2026-08-01 04:00:00+00'),
  (-98120304, -981103, false, false, null, 0, 'practice', '2026-08-02 09:00:00+00'),
  -- Insert the larger ID first; the smaller ID wins the timestamp tie.
  (-98120401, -981104, true,  false,  600, 0, 'practice', '2026-08-01 05:00:00+00'),
  (-98120402, -981104, false, false,  400, 0, 'review',   '2026-08-01 05:00:00+00'),
  (-98120501, -981105, true,  false, 4000, 2, 'practice', '2026-08-01 06:00:00+00'),
  (-98120502, -981105, true,  false,    0, 0, 'practice', '2026-08-02 06:00:00+00'),
  -- Submit via the alias, then the canonical; straddle Los Angeles midnight.
  (-98120601, -981110, false, false, 1500, 0, 'library',  '2026-08-01 06:30:00+00'),
  (-98120602, -981106, true,  false, 2500, 0, 'practice', '2026-08-01 07:30:00+00'),
  (-98120701, -981107, true,  false, null, 0, 'practice', '2026-08-02 00:00:00+00'),
  (-98120801, -981108, false, false,  500, 0, null,       '2026-08-02 01:00:00+00'),
  -- No graded row exists for this problem: a lateral inner join would lose it.
  (-98120901, -981109, null,  false,  555, 0, 'practice', '2026-08-01 10:00:00+00'),
  (-98120902, -981109, null,  true,   666, 0, 'practice', '2026-08-02 10:00:00+00')
) as s(id, problem_id, is_correct, skipped, elapsed_ms, tries_used, source, created_at);

-- Earlier work on shared problems must not steal this user's first attempts;
-- the extra bucket also makes accidental cross-user visibility conspicuous.
insert into public.submissions
  (id, user_id, problem_id, is_correct, elapsed_ms, source, created_at)
overriding system value
values
  (-98121001, '00000000-0000-0000-0000-000000098102', -981103, true, 99999, 'practice', '2026-07-30 12:00:00+00'),
  (-98121002, '00000000-0000-0000-0000-000000098102', -981106, true, 99999, 'practice', '2026-07-30 13:00:00+00'),
  (-98121003, '00000000-0000-0000-0000-000000098102', -981111, false, 777, 'review', '2026-08-01 12:00:00+00');

-- Preserve the old aggregation as a test-only oracle. In particular, window
-- numbering in submission_facts happens before these report filters. Do not
-- port the optimized implementation into this helper.
create function pg_temp.facts_breakdown(
  p_dimension text, p_from timestamptz default null, p_to timestamptz default null,
  p_tz text default 'UTC', p_topics text[] default null, p_series bigint[] default null,
  p_difficulty_min integer default null, p_difficulty_max integer default null,
  p_source text default null, p_computational boolean default null
)
returns table (
  bucket_key text, bucket_label text, seen bigint, graded bigint, correct bigint,
  skipped bigint, first_graded bigint, first_correct bigint, distinct_problems bigint,
  graded_time_ms bigint, graded_timed bigint, last_activity timestamptz
)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select
      case p_dimension
        when 'topic' then coalesce(f.topic, 'Untagged')
        when 'series' then coalesce(f.series_id::text, 'none')
        when 'difficulty' then coalesce(f.difficulty::text, '0')
        when 'day' then to_char((f.created_at at time zone p_tz)::date, 'YYYY-MM-DD')
      end as dim_key,
      f.*
    from public.submission_facts f
    where (p_from is null or f.created_at >= p_from)
      and (p_to is null or f.created_at < p_to)
      and (p_topics is null or f.topic = any(p_topics))
      and (p_series is null or f.series_id = any(p_series))
      and (p_difficulty_min is null or f.difficulty >= p_difficulty_min)
      and (p_difficulty_max is null or f.difficulty <= p_difficulty_max)
      and (p_source is null or f.source = p_source)
      and (p_computational is null or f.is_computational = p_computational)
  )
  select dim_key as bucket_key,
    case when p_dimension = 'series' then coalesce(max(series_name), '—') else dim_key end as bucket_label,
    count(*),
    count(*) filter (where not skipped and is_correct is not null),
    count(*) filter (where is_correct),
    count(*) filter (where skipped),
    count(*) filter (where graded_seq = 1),
    count(*) filter (where graded_seq = 1 and is_correct and coalesce(tries_used, 0) = 0),
    count(distinct problem_id),
    coalesce(sum(elapsed_ms) filter (
      where not skipped and is_correct is not null and elapsed_ms is not null
    ), 0)::bigint,
    count(*) filter (where not skipped and is_correct is not null and elapsed_ms is not null),
    max(created_at)
  from base
  where dim_key is not null
  group by dim_key
  order by dim_key;
$$;

grant execute on function pg_temp.facts_breakdown to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000098101', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is(current_user::text, 'authenticated', 'reports run under the actual authenticated role');
select extensions.is((select count(*) from public.submissions), 19::bigint,
  'submission RLS exposes only the first user fixture');

select extensions.results_eq(
  $$select sum(seen)::bigint, sum(graded)::bigint, sum(correct)::bigint,
      sum(first_graded)::bigint, sum(first_correct)::bigint,
      sum(graded_time_ms)::bigint, sum(graded_timed)::bigint
    from public.progress_breakdown('topic')$$,
  $$values (19::bigint, 15::bigint, 9::bigint, 8::bigint, 2::bigint, 27800::bigint, 13::bigint)$$,
  'the first user report totals exclude every other-user submission'
);

-- Independent expected values protect the important semantics even if a
-- future view edit would otherwise make both sides of the oracle agree.
select extensions.results_eq(
  $$select seen, graded, correct, first_graded, first_correct, graded_time_ms, last_activity
    from public.progress_breakdown('topic', p_topics => array['before'],
      p_from => '2026-08-01 00:00:00+00', p_to => '2026-08-03 00:00:00+00')$$,
  $$values (1::bigint, 1::bigint, 1::bigint, 0::bigint, 0::bigint, 2000::bigint,
    '2026-08-01 00:00:00+00'::timestamptz)$$,
  'date bounds are inclusive/exclusive without redefining lifetime-first'
);

select extensions.results_eq(
  $$select graded, correct, first_graded, first_correct from public.progress_breakdown(
    'topic', p_topics => array['source'], p_source => 'practice')$$,
  $$values (1::bigint, 1::bigint, 0::bigint, 0::bigint)$$,
  'a first graded row from an excluded source still owns lifetime-first'
);

select extensions.results_eq(
  $$select seen, graded, correct, skipped, first_graded, first_correct, graded_time_ms, graded_timed
    from public.progress_breakdown('topic', p_topics => array['preceded'])$$,
  $$values (4::bigint, 2::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint, 3000::bigint, 1::bigint)$$,
  'skips, ungraded predecessors, untimed attempts and another user do not consume the clean first solve'
);

select extensions.results_eq(
  $$select graded, correct, first_graded, first_correct from public.progress_breakdown(
    'topic', p_topics => array['tie'])$$,
  $$values (2::bigint, 1::bigint, 1::bigint, 0::bigint)$$,
  'equal timestamps use the smaller ID, not insertion order or correctness'
);

select extensions.results_eq(
  $$select graded, correct, first_graded, first_correct from public.progress_breakdown(
    'topic', p_topics => array['tie'], p_source => 'practice')$$,
  $$values (1::bigint, 1::bigint, 0::bigint, 0::bigint)$$,
  'the timestamp tie-break survives filtering out the winning row'
);

select extensions.results_eq(
  $$select graded, correct, first_graded, first_correct, graded_time_ms, graded_timed
    from public.progress_breakdown('topic', p_topics => array['tries'])$$,
  $$values (2::bigint, 2::bigint, 1::bigint, 0::bigint, 4000::bigint, 2::bigint)$$,
  'UI retries disqualify first-correct; a later clean zero-time solve is timed but not first'
);

select extensions.results_eq(
  $$select seen, graded, correct, skipped, first_graded, first_correct,
      distinct_problems, graded_time_ms, graded_timed, last_activity
    from public.progress_breakdown('topic', p_topics => array['ungraded'])$$,
  $$values (2::bigint, 0::bigint, 0::bigint, 1::bigint, 0::bigint, 0::bigint,
    1::bigint, 0::bigint, 0::bigint, '2026-08-02 10:00:00+00'::timestamptz)$$,
  'never-graded work survives the lookup and affects seen and last activity, but not graded time'
);

select extensions.results_eq(
  $$select bucket_label, seen, graded, correct, first_graded, first_correct,
      distinct_problems, graded_time_ms, graded_timed
    from public.progress_breakdown('topic') where bucket_key = 'Untagged'$$,
  $$values ('Untagged'::text, 2::bigint, 2::bigint, 1::bigint, 2::bigint,
    1::bigint, 2::bigint, 500::bigint, 1::bigint)$$,
  'null topics and missing contest dimensions retain their submissions'
);

select extensions.results_eq(
  $$select bucket_key, bucket_label from public.progress_breakdown('difficulty')$$,
  $$values ('0'::text, '0'::text), ('10', '10'), ('2', '2'), ('3', '3')$$,
  'difficulty uses the null-to-zero label and text-key ordering'
);

select extensions.results_eq(
  $$select bucket_key, bucket_label from public.progress_breakdown('series')$$,
  $$values ('-981001'::text, 'test:progress:zeta'::text),
    ('-981002', 'test:progress:alpha'), ('none', '—')$$,
  'series ordering uses IDs rather than names and labels missing series with a dash'
);

select extensions.is(
  (select problem_id from public.submissions where id = -98120601), (-981106)::bigint,
  'the alias submission is stored on the canonical problem'
);

select extensions.results_eq(
  $$select bucket_key, seen, graded, correct, first_graded, first_correct, distinct_problems
    from public.progress_breakdown('series', p_topics => array['canonical'])$$,
  $$values ('-981001'::text, 2::bigint, 2::bigint, 1::bigint, 1::bigint, 0::bigint, 1::bigint)$$,
  'both placements share one problem and the stored canonical owns the dimensions'
);

select extensions.is_empty(
  $$select * from public.progress_breakdown('topic', p_topics => array['alias-only'])$$,
  'an alias placement does not acquire or duplicate canonical-owned activity'
);

select extensions.results_eq(
  $$select bucket_key, seen, first_graded, graded_time_ms from public.progress_breakdown(
    'day', p_topics => array['canonical'])$$,
  $$values ('2026-08-01'::text, 2::bigint, 1::bigint, 4000::bigint)$$,
  'day bucketing defaults to UTC'
);

select extensions.results_eq(
  $$select bucket_key, seen, first_graded, graded_time_ms from public.progress_breakdown(
    'day', p_tz => 'America/Los_Angeles', p_topics => array['canonical'],
    p_from => '2026-08-01 00:00:00+00', p_to => '2026-08-02 00:00:00+00')$$,
  $$values ('2026-07-31'::text, 1::bigint, 1::bigint, 1500::bigint),
    ('2026-08-01', 1::bigint, 0::bigint, 2500::bigint)$$,
  'timezone changes local day buckets without changing absolute date filters'
);

-- Compare every returned column AND its order. No outer sort may conceal an
-- ordering regression. Named arguments keep individual cases easy to extend.
select extensions.results_eq(
  query, replace(query, 'public.progress_breakdown', 'pg_temp.facts_breakdown'),
  'submission_facts parity: ' || label
)
from (values
  ('topic defaults', $$select * from public.progress_breakdown('topic')$$),
  ('series defaults', $$select * from public.progress_breakdown('series')$$),
  ('difficulty defaults', $$select * from public.progress_breakdown('difficulty')$$),
  ('day defaults', $$select * from public.progress_breakdown('day')$$),
  ('from only', $$select * from public.progress_breakdown('topic', p_from => '2026-08-01 00:00:00+00')$$),
  ('to only', $$select * from public.progress_breakdown('day', p_to => '2026-08-02 00:00:00+00')$$),
  ('date and source', $$select * from public.progress_breakdown('topic', p_from => '2026-08-01 00:00:00+00', p_to => '2026-08-03 00:00:00+00', p_source => 'practice')$$),
  ('topic array', $$select * from public.progress_breakdown('series', p_topics => array['before', 'preceded'])$$),
  ('series array', $$select * from public.progress_breakdown('topic', p_series => array[-981001, -981002]::bigint[])$$),
  ('canonical series', $$select * from public.progress_breakdown('topic', p_series => array[-981001]::bigint[])$$),
  ('alias series', $$select * from public.progress_breakdown('topic', p_series => array[-981002]::bigint[])$$),
  ('difficulty lower bound', $$select * from public.progress_breakdown('difficulty', p_difficulty_min => 0)$$),
  ('difficulty upper bound', $$select * from public.progress_breakdown('topic', p_difficulty_max => 2)$$),
  ('inclusive difficulty bounds', $$select * from public.progress_breakdown('topic', p_difficulty_min => 2, p_difficulty_max => 2)$$),
  ('computational true', $$select * from public.progress_breakdown('topic', p_computational => true)$$),
  ('computational false', $$select * from public.progress_breakdown('series', p_computational => false)$$),
  ('all filters', $$select * from public.progress_breakdown('day', p_from => '2026-08-01 00:00:00+00', p_to => '2026-08-03 00:00:00+00', p_tz => 'America/Los_Angeles', p_topics => array['source', 'tie'], p_series => array[-981001, -981002]::bigint[], p_difficulty_min => 10, p_difficulty_max => 10, p_source => 'practice', p_computational => true)$$),
  ('null source included by default', $$select * from public.progress_breakdown('topic', p_series => null, p_source => null)$$),
  ('empty topics', $$select * from public.progress_breakdown('topic', p_topics => array[]::text[])$$),
  ('empty series', $$select * from public.progress_breakdown('series', p_series => array[]::bigint[])$$),
  ('display labels are not raw topics', $$select * from public.progress_breakdown('topic', p_topics => array['Untagged'])$$),
  ('empty date interval', $$select * from public.progress_breakdown('day', p_from => '2026-08-01 00:00:00+00', p_to => '2026-08-01 00:00:00+00')$$),
  ('unsupported dimension', $$select * from public.progress_breakdown('unsupported')$$),
  ('null dimension', $$select * from public.progress_breakdown(null)$$)
) as cases(label, query);

-- Change only the JWT subject while remaining authenticated. These expectations
-- contain no test-side user predicate that could hide a security-definer leak.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000098102', true);

select extensions.is((select count(*) from public.submissions), 3::bigint,
  'switching authenticated users changes the RLS-visible submissions');

select extensions.results_eq(
  $$select bucket_key, seen, graded, correct, first_graded, first_correct, graded_time_ms
    from public.progress_breakdown('topic')$$,
  $$values ('canonical'::text, 1::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint, 99999::bigint),
    ('other-user-only', 1::bigint, 1::bigint, 0::bigint, 1::bigint, 0::bigint, 777::bigint),
    ('preceded', 1::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint, 99999::bigint)$$,
  'the second user sees exactly their own totals and lifetime-first attempts'
);

select extensions.results_eq(
  $$select * from public.progress_breakdown('topic')$$,
  $$select * from pg_temp.facts_breakdown('topic')$$,
  'the unchanged facts view also agrees under the second user RLS context'
);

select * from extensions.finish();
rollback;
