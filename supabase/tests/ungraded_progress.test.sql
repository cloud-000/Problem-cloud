begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(27);

insert into public.problems (id, n, statement, topic, sync_key)
values (-920001, 0, 'Give a proof.', 'Phase 2 test', 'test:ungraded-progress');

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '00000000-0000-0000-0000-000000092001',
  'authenticated',
  'authenticated',
  'ungraded-progress@example.test',
  '{}'::jsonb,
  '{"username":"ungraded_progress_test"}'::jsonb,
  now(),
  now()
);

insert into public.submissions (
  user_id,
  problem_id,
  answer,
  is_correct,
  skipped,
  elapsed_ms,
  source,
  session_id,
  created_at
) values (
  '00000000-0000-0000-0000-000000092001',
  -920001,
  'Proof text',
  null,
  false,
  1234,
  'practice',
  (select id from public.practice_sessions
    where user_id = '00000000-0000-0000-0000-000000092001' and is_root),
  '2026-08-08 12:00:00+00'
);

select extensions.is(
  (select times_seen from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  1,
  'an ungraded non-skip counts as seen'
);

select extensions.is(
  (select times_reviewed from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  0,
  'an ungraded non-skip does not count as reviewed'
);

select extensions.is(
  (select times_correct from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  0,
  'an ungraded non-skip does not count as correct'
);

select extensions.is(
  (select times_skipped from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  0,
  'an ungraded non-skip does not count as skipped'
);

select extensions.is(
  (select total_time_ms from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  1234::bigint,
  'an ungraded non-skip still contributes elapsed time'
);

select extensions.is(
  (select last_reviewed_at from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  null::timestamptz,
  'an ungraded non-skip does not set last_reviewed_at'
);

select extensions.is(
  (select last_correct from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  null::boolean,
  'an ungraded non-skip does not set last_correct'
);

select extensions.is(
  (select interval_days from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  0,
  'an ungraded non-skip does not advance the SM-2 interval'
);

select extensions.is(
  (select next_review_at from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  null::timestamptz,
  'an ungraded non-skip does not schedule a review'
);

select extensions.is(
  (select times_seen from public.practice_sessions
    where user_id = '00000000-0000-0000-0000-000000092001' and is_root),
  1,
  'the session aggregate counts an ungraded non-skip as seen'
);

select extensions.is(
  (select times_reviewed from public.practice_sessions
    where user_id = '00000000-0000-0000-0000-000000092001' and is_root),
  0,
  'the session aggregate does not count an ungraded non-skip as reviewed'
);

select extensions.is(
  (select times_correct from public.practice_sessions
    where user_id = '00000000-0000-0000-0000-000000092001' and is_root),
  0,
  'the session aggregate does not count an ungraded non-skip as correct'
);

select extensions.is(
  (select count(*) from public.player_ratings
    where user_id = '00000000-0000-0000-0000-000000092001'),
  0::bigint,
  'an ungraded non-skip creates no player rating row'
);

select extensions.is(
  (select count(*) from public.problem_ratings where problem_id = -920001),
  0::bigint,
  'an ungraded non-skip creates no problem rating row'
);

select extensions.is(
  (select count(*) from public.player_rating_history
    where user_id = '00000000-0000-0000-0000-000000092001'),
  0::bigint,
  'an ungraded non-skip creates no player rating history row'
);

select extensions.is(
  (select count(*) from public.problem_rating_history where problem_id = -920001),
  0::bigint,
  'an ungraded non-skip creates no problem rating history row'
);

select extensions.is(
  (select graded_seq from public.submission_facts
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  null::bigint,
  'analytics do not assign a graded sequence to an ungraded non-skip'
);

select extensions.is(
  (select graded from public.progress_breakdown('topic')
    where bucket_key = 'Phase 2 test'),
  0::bigint,
  'analytics do not count an ungraded non-skip as graded'
);

-- Surround another ungraded response with a known outcome. This verifies that
-- ungraded work preserves an existing review/SM-2 state instead of resetting it.
insert into public.submissions (
  user_id, problem_id, answer, is_correct, skipped, elapsed_ms, source, session_id, created_at
) values (
  '00000000-0000-0000-0000-000000092001',
  -920001,
  'Known response',
  true,
  false,
  2000,
  'practice',
  (select id from public.practice_sessions
    where user_id = '00000000-0000-0000-0000-000000092001' and is_root),
  '2026-08-08 12:01:00+00'
), (
  '00000000-0000-0000-0000-000000092001',
  -920001,
  'More proof text',
  null,
  false,
  3000,
  'practice',
  (select id from public.practice_sessions
    where user_id = '00000000-0000-0000-0000-000000092001' and is_root),
  '2026-08-08 12:02:00+00'
);

select extensions.is(
  (select times_seen from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  3,
  'mixed progress counts every submission as seen'
);

select extensions.is(
  (select times_reviewed from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  1,
  'mixed progress counts only the known outcome as reviewed'
);

select extensions.is(
  (select last_correct from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  true,
  'a later ungraded response preserves the last graded outcome'
);

select extensions.is(
  (select last_reviewed_at from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  '2026-08-08 12:01:00+00'::timestamptz,
  'a later ungraded response preserves the last reviewed timestamp'
);

select extensions.is(
  (select times_seen from public.practice_sessions
    where user_id = '00000000-0000-0000-0000-000000092001' and is_root),
  3,
  'mixed session progress counts every submission as seen'
);

select extensions.is(
  (select times_reviewed from public.practice_sessions
    where user_id = '00000000-0000-0000-0000-000000092001' and is_root),
  1,
  'mixed session progress counts only the known outcome as reviewed'
);

select extensions.is(
  (select graded_seq from public.submission_facts
    where user_id = '00000000-0000-0000-0000-000000092001'
      and problem_id = -920001 and is_correct is true),
  1::bigint,
  'ungraded responses do not consume the first graded sequence number'
);

select extensions.is(
  (select count(*) from public.player_rating_history
    where user_id = '00000000-0000-0000-0000-000000092001'),
  1::bigint,
  'only the known outcome in a mixed sequence creates rating history'
);

create temporary table live_progress_snapshot as
select to_jsonb(pp) - 'created_at' - 'updated_at' as value
from public.problem_progress pp
where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001;

select public.recompute_problem_progress(
  '00000000-0000-0000-0000-000000092001',
  -920001
);

select extensions.is(
  (select to_jsonb(pp) - 'created_at' - 'updated_at'
    from public.problem_progress pp
    where user_id = '00000000-0000-0000-0000-000000092001' and problem_id = -920001),
  (select value from live_progress_snapshot),
  'progress replay exactly matches the live ungraded fold'
);

select * from extensions.finish();

rollback;
