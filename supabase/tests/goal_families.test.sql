-- The four family evaluators (`docs/goals.md` §6, §8).
--
-- Each family gets its own series so one family's fixture can never leak into
-- another's counts, and every request array is deliberately more than one
-- element long: a batched RPC that returned rows only for non-empty results
-- would pass every single-request test and silently misalign a real goals list.
--
-- Ids are negative throughout so the fixture can never collide with synced
-- catalog content.

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(22);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into public.series (id, name) values
  (-930001, 'test:goal-families:set-alpha'),
  (-930002, 'test:goal-families:set-beta'),
  (-930003, 'test:goal-families:window'),
  (-930004, 'test:goal-families:streak'),
  (-930005, 'test:goal-families:streak-yesterday'),
  (-930006, 'test:goal-families:streak-stale');

insert into public.tests (id, series_id, name, sync_key) values
  (-930011, -930001, 'set alpha test',        'test:goal-families:t1'),
  (-930012, -930002, 'set beta test',         'test:goal-families:t2'),
  (-930013, -930003, 'window test',           'test:goal-families:t3'),
  (-930014, -930004, 'streak test',           'test:goal-families:t4'),
  (-930015, -930005, 'streak yesterday test', 'test:goal-families:t5'),
  (-930016, -930006, 'streak stale test',     'test:goal-families:t6');

-- Set family. a3 is deliberately ungradeable while carrying real work, so it
-- can only be excluded by the eligibility rule and not by absence of activity.
insert into public.problems
  (id, test_id, n, statement, choices, answer_index, answer_status, sync_key) values
  (-930101, -930011, 0, 'a1', '{a,b,c,d,e}', 0, 'known',          'test:goal-families:a1'),
  (-930102, -930011, 1, 'a2', '{a,b,c,d,e}', 1, 'known',          'test:goal-families:a2'),
  (-930103, -930011, 2, 'a3', null,         -1, 'source_missing', 'test:goal-families:a3'),
  (-930105, -930012, 0, 'b1', '{a,b,c,d,e}', 2, 'known',          'test:goal-families:b1');

-- The duplicated problem: canonical under alpha, alias under beta. All work
-- below is submitted against the ALIAS, so every assertion about it is really
-- an assertion that canonicalization and scope resolution agree (§5).
insert into public.problems
  (id, test_id, n, statement, choices, answer_index, answer_status, canonical_id, sync_key) values
  (-930201, -930011, 3, 'dup', '{a,b,c,d,e}', 3, 'known', null,     'test:goal-families:d1'),
  (-930202, -930012, 1, 'dup', '{a,b,c,d,e}', 3, 'known', -930201,  'test:goal-families:d2');

-- Window/volume family.
insert into public.problems
  (id, test_id, n, statement, choices, answer_index, answer_status, sync_key) values
  (-930301, -930013, 0, 'w1', '{a,b,c,d,e}', 0, 'known', 'test:goal-families:w1'),
  (-930302, -930013, 1, 'w2', '{a,b,c,d,e}', 1, 'known', 'test:goal-families:w2'),
  (-930303, -930013, 2, 'w3', '{a,b,c,d,e}', 2, 'known', 'test:goal-families:w3');

-- Streak family: one problem per scenario, revisited across days.
insert into public.problems
  (id, test_id, n, statement, choices, answer_index, answer_status, sync_key) values
  (-930401, -930014, 0, 's1', '{a,b,c,d,e}', 0, 'known', 'test:goal-families:s1'),
  (-930402, -930015, 0, 's2', '{a,b,c,d,e}', 0, 'known', 'test:goal-families:s2'),
  (-930403, -930016, 0, 's3', '{a,b,c,d,e}', 0, 'known', 'test:goal-families:s3');

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000093001',
  'authenticated', 'authenticated', 'goal-families@example.test',
  '{}'::jsonb, '{"username":"goal_families_test"}'::jsonb, now(), now()
);

-- A second student, whose work sits in the same scopes and must never appear in
-- the first student's numbers. Every function here is security invoker, so this
-- is a live check that RLS is what scopes the report.
insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000093002',
  'authenticated', 'authenticated', 'goal-families-other@example.test',
  '{}'::jsonb, '{"username":"goal_families_other"}'::jsonb, now(), now()
);

create or replace function pg_temp.root_session(p_user uuid)
returns bigint language sql stable as $$
  select id from public.practice_sessions where user_id = p_user and is_root;
$$;

-- Set-family work. a1 correct, a2 wrong, a3 correct-but-ungradeable, and the
-- duplicate answered through its alias placement.
insert into public.submissions
  (user_id, problem_id, answer, is_correct, skipped, elapsed_ms, source, session_id, created_at)
values
  ('00000000-0000-0000-0000-000000093001', -930101, 'x', true,  false, 1000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093001'), '2026-08-01 10:00:00+00'),
  ('00000000-0000-0000-0000-000000093001', -930102, 'x', false, false, 1000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093001'), '2026-08-01 10:01:00+00'),
  ('00000000-0000-0000-0000-000000093001', -930103, 'x', true,  false, 1000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093001'), '2026-08-01 10:02:00+00'),
  ('00000000-0000-0000-0000-000000093001', -930202, 'x', true,  false, 1000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093001'), '2026-08-01 10:03:00+00');

-- The other student solves everything in sight.
insert into public.submissions
  (user_id, problem_id, answer, is_correct, skipped, elapsed_ms, source, session_id, created_at)
values
  ('00000000-0000-0000-0000-000000093002', -930101, 'x', true, false, 1000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093002'), '2026-08-01 10:00:00+00'),
  ('00000000-0000-0000-0000-000000093002', -930105, 'x', true, false, 1000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093002'), '2026-08-01 10:00:00+00'),
  ('00000000-0000-0000-0000-000000093002', -930301, 'x', true, false, 9999, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093002'), '2026-08-02 10:00:00+00');

-- Window/volume work, in a fixed order so recency is unambiguous:
--   10:00 w1 correct  1000ms   fresh
--   10:01 w2 wrong    2000ms   fresh
--   10:02 w3 correct  3000ms   fresh
--   10:03 w1 wrong    4000ms   repeat
--   10:04 w2 correct  5000ms   repeat
--   10:05 w1 skipped           not an attempt at all
insert into public.submissions
  (user_id, problem_id, answer, is_correct, skipped, elapsed_ms, source, session_id, created_at)
values
  ('00000000-0000-0000-0000-000000093001', -930301, 'x', true,  false, 1000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093001'), '2026-08-02 10:00:00+00'),
  ('00000000-0000-0000-0000-000000093001', -930302, 'x', false, false, 2000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093001'), '2026-08-02 10:01:00+00'),
  ('00000000-0000-0000-0000-000000093001', -930303, 'x', true,  false, 3000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093001'), '2026-08-02 10:02:00+00'),
  ('00000000-0000-0000-0000-000000093001', -930301, 'x', false, false, 4000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093001'), '2026-08-02 10:03:00+00'),
  ('00000000-0000-0000-0000-000000093001', -930302, 'x', true,  false, 5000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093001'), '2026-08-02 10:04:00+00'),
  ('00000000-0000-0000-0000-000000093001', -930301, null, null, true,  6000, 'practice',
   pg_temp.root_session('00000000-0000-0000-0000-000000093001'), '2026-08-02 10:05:00+00');

-- Streak work, anchored to the caller's today so the assertions hold whenever
-- the suite runs. Noon UTC keeps every submission inside its intended day.
create or replace function pg_temp.day_at(p_days_ago integer)
returns timestamptz language sql stable as $$
  select (((pg_catalog.now() at time zone 'UTC')::date - p_days_ago)::timestamp
          + time '12:00') at time zone 'UTC';
$$;

-- streak scope: today x2, yesterday x3, two-days-ago x1, three-days-ago x2.
-- At perDay = 2 the thin day breaks the run; at perDay = 1 nothing does.
insert into public.submissions
  (user_id, problem_id, answer, is_correct, skipped, elapsed_ms, source, session_id, created_at)
select
  '00000000-0000-0000-0000-000000093001', -930401, 'x', true, false, 1000, 'practice',
  pg_temp.root_session('00000000-0000-0000-0000-000000093001'),
  pg_temp.day_at(d) + (make_interval(mins => i))
from (values (0, 2), (1, 3), (2, 1), (3, 2)) as spec(d, n),
     lateral generate_series(1, spec.n) as i;

-- streak-yesterday scope: yesterday and the day before, nothing today.
insert into public.submissions
  (user_id, problem_id, answer, is_correct, skipped, elapsed_ms, source, session_id, created_at)
select
  '00000000-0000-0000-0000-000000093001', -930402, 'x', true, false, 1000, 'practice',
  pg_temp.root_session('00000000-0000-0000-0000-000000093001'),
  pg_temp.day_at(d)
from (values (1), (2)) as spec(d);

-- streak-stale scope: nothing more recent than two days ago.
insert into public.submissions
  (user_id, problem_id, answer, is_correct, skipped, elapsed_ms, source, session_id, created_at)
select
  '00000000-0000-0000-0000-000000093001', -930403, 'x', true, false, 1000, 'practice',
  pg_temp.root_session('00000000-0000-0000-0000-000000093001'),
  pg_temp.day_at(d)
from (values (2), (3)) as spec(d);

-- Everything below runs as the first student, through RLS, exactly as the app
-- will call it.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000093001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- ---------------------------------------------------------------------------
-- Set family
-- ---------------------------------------------------------------------------

-- Three requests, the middle one matching nothing: a family RPC that dropped
-- empty results would shift beta's row onto index 1 and every later assertion
-- would still "pass" against the wrong goal.
create temporary view set_result as
  select * from public.goal_set_progress('[
    {"scope": {"seriesIds": ["-930001"]}},
    {"scope": {"seriesIds": ["-930999"]}},
    {"scope": {"seriesIds": ["-930002"]}}
  ]'::jsonb);

select extensions.is(
  (select eligible_total from set_result where idx = 0),
  3::bigint,
  'the denominator counts eligible canonicals only'
);

select extensions.is(
  (select attempted from set_result where idx = 0),
  3::bigint,
  'attempted excludes an ineligible problem the student actually worked'
);

select extensions.is(
  (select solved from set_result where idx = 0),
  2::bigint,
  'solved counts canonicals with at least one correct attempt'
);

select extensions.is(
  (select array[attempted, solved, eligible_total] from set_result where idx = 1),
  array[0, 0, 0]::bigint[],
  'a scope matching nothing still returns its own row'
);

select extensions.is(
  (select eligible_total from set_result where idx = 2),
  2::bigint,
  'request indices survive an empty result in the middle of the batch'
);

-- The duplicate was answered under beta and counts under beta, even though its
-- canonical row lives under alpha — and it counted under alpha too (above),
-- without ever being counted twice.
select extensions.is(
  (select attempted from set_result where idx = 2),
  1::bigint,
  'work on a duplicated problem counts under both of its placements'
);

-- ---------------------------------------------------------------------------
-- Window family
-- ---------------------------------------------------------------------------

create temporary view window_result as
  select * from public.goal_window_progress('[
    {"scope": {"seriesIds": ["-930003"]}, "sampleSize": 10},
    {"scope": {"seriesIds": ["-930003"]}, "sampleSize": 2}
  ]'::jsonb);

select extensions.is(
  (select array[fresh_sample, fresh_correct] from window_result where idx = 0),
  array[3, 2]::bigint[],
  'the fresh window counts each problem''s first graded attempt only'
);

select extensions.is(
  (select array[graded_sample, graded_correct] from window_result where idx = 0),
  array[5, 3]::bigint[],
  'the graded window counts repeats and excludes skips'
);

select extensions.is(
  (select array[timed_sample, timed_total_ms::bigint] from window_result where idx = 0),
  array[3, 9000]::bigint[],
  'the timed window sums correct attempts only'
);

-- A sample smaller than the history is the real test: it must take the most
-- RECENT N, and each window must take its own N independently.
select extensions.is(
  (select array[fresh_sample, fresh_correct] from window_result where idx = 1),
  array[2, 1]::bigint[],
  'the fresh window takes the most recent N first attempts'
);

select extensions.is(
  (select array[graded_sample, graded_correct] from window_result where idx = 1),
  array[2, 1]::bigint[],
  'the graded window takes the most recent N attempts'
);

select extensions.is(
  (select array[timed_sample, timed_total_ms::bigint] from window_result where idx = 1),
  array[2, 8000]::bigint[],
  'the timed window takes the most recent N correct attempts'
);

-- ---------------------------------------------------------------------------
-- Accumulation family
-- ---------------------------------------------------------------------------

create temporary view volume_result as
  select * from public.goal_volume_progress('[
    {"scope": {"seriesIds": ["-930003"]}, "from": null, "to": null},
    {"scope": {"seriesIds": ["-930003"]},
     "from": "2026-08-02T10:02:00Z", "to": "2026-08-02T10:05:00Z"}
  ]'::jsonb);

select extensions.is(
  (select graded_submissions from volume_result where idx = 0),
  5::bigint,
  'volume counts every graded attempt including repeats, and no skips'
);

select extensions.is(
  (select graded_submissions from volume_result where idx = 1),
  3::bigint,
  'volume honours a half-open period'
);

-- ---------------------------------------------------------------------------
-- Period family
-- ---------------------------------------------------------------------------

create temporary view streak_result as
  select * from public.goal_streak_progress('[
    {"scope": {"seriesIds": ["-930004"]}, "timeZone": "UTC", "perDay": 2},
    {"scope": {"seriesIds": ["-930004"]}, "timeZone": "UTC", "perDay": 1},
    {"scope": {"seriesIds": ["-930005"]}, "timeZone": "UTC", "perDay": 1},
    {"scope": {"seriesIds": ["-930006"]}, "timeZone": "UTC", "perDay": 1},
    {"scope": {"seriesIds": ["-930004"]}, "timeZone": "Not/AZone", "perDay": 2}
  ]'::jsonb);

select extensions.is(
  (select streak_days from streak_result where idx = 0),
  2::bigint,
  'a day below the per-day threshold breaks the streak'
);

select extensions.is(
  (select today_count from streak_result where idx = 0),
  2::bigint,
  'today''s count comes back alongside the streak'
);

select extensions.is(
  (select streak_days from streak_result where idx = 1),
  4::bigint,
  'the same days form a longer streak at a lower threshold'
);

select extensions.is(
  (select array[streak_days, today_count] from streak_result where idx = 2),
  array[2, 0]::bigint[],
  'a day still in progress does not break a streak'
);

select extensions.is(
  (select streak_days from streak_result where idx = 3),
  0::bigint,
  'a streak whose last day is older than yesterday is over'
);

select extensions.is(
  (select streak_days from streak_result where idx = 4),
  2::bigint,
  'an unknown timezone falls back instead of failing the whole batch'
);

-- ---------------------------------------------------------------------------
-- Cross-cutting
-- ---------------------------------------------------------------------------

select extensions.is(
  (select count(*) from public.goal_set_progress('[]'::jsonb)),
  0::bigint,
  'an empty request array returns no rows'
);

-- The other student solved b1 and w1; neither may appear here.
select extensions.is(
  (select array[attempted, solved] from set_result where idx = 2),
  array[1, 1]::bigint[],
  'another student''s work is invisible through RLS'
);

select * from extensions.finish();

rollback;
