-- Synthetic submissions that exercise the live (v3) per-submission Glicko:
-- time-effort, struggle-then-solve weighting, repeat-decay, the symmetric MCQ
-- guess guard, and the already-solved-encounter skip. Each effect is isolated
-- on its own problem(s) so it can be read cleanly.
--
-- v3 rates LIVE: every insert below fires the annotate + rating triggers, so
-- ratings exist as soon as the transaction commits — no recompute needed.
-- Running `select recompute_ratings();` afterward must reproduce the exact
-- same ratings (the live-fold ≡ replay determinism check).
--
-- Inserts are chronological per (user, problem) pair — required for the live
-- path (the annotate trigger derives encounter state from the latest prior
-- row) and for live/replay agreement (replay orders by created_at, id).
--
-- Idempotent: wipes prior synthetic users (email domain @synthetic.test) and
-- their submissions/progress via cascade, then rebuilds. This is a MANUAL
-- verification tool — it is not part of `supabase db reset` (do not add it to
-- seed.sql). NOTE: the wipe deletes users, not their rated effects on problem
-- ratings/stats — run `select recompute_ratings();` after the wipe-and-reseed
-- to rebuild from the log if you need pristine problem ratings.
--
-- Problems (short MCQ statements). If your local DB lacks these ids, swap them
-- for any MCQ problems.
--   P_TIME    = 7056  5 warm-up solvers set the time normalizer (EWMA needs
--                     min_solves=5), then 6 test solvers, times 3–60s
--                     → test solvers' ratings strictly decrease with time
--   P_ATTEMPT = 6480  clean solve vs solve-after-3-misses (time signal off)
--                     → clean gain > struggle net gain > 0
--   P_REPEAT  = 7048  same user solves 3× 8 days apart vs 3 distinct problems
--                     (7721/6811/7160) → re-solves gain less; also one extra
--                     same-encounter re-solve that must NOT be rated
--   P_GUESS   = 7120  5 warm-ups, then fast(1.2s)/slow(2.5s) × win/loss
--                     → sub-floor attempts move ratings less, both directions

begin;

-- 1. Clean slate for synthetic users (cascade clears submissions + progress).
delete from auth.users where email like '%@synthetic.test';

-- 2. Create synthetic users; handle_new_user makes their profiles. The id is
--    derived deterministically from the username (md5) so the submission inserts
--    below can reference it without a lookup.
do $$
declare
  uname  text;
  unames text[] := array[
    'twarm_1','twarm_2','twarm_3','twarm_4','twarm_5',
    'time_3','time_5','time_8','time_12','time_25','time_60',
    'attempt_first','attempt_struggle',
    'repeat_same','repeat_varied',
    'gwarm_1','gwarm_2','gwarm_3','gwarm_4','gwarm_5',
    'guess_win_slow','guess_win_fast','guess_loss_slow','guess_loss_fast'
  ];
begin
  foreach uname in array unames loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      md5('synth::' || uname)::uuid, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', uname || '@synthetic.test',
      crypt('password', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', 'synth_' || uname), now(), now()
    );
  end loop;
end $$;

-- 3. Submissions. `source='library'`, session_id null (no session plumbing
--    needed). is_correct is authoritative for rating; selected_choice is
--    cosmetic. Fixed timestamps keep the run deterministic; VALUES order = id
--    order = live rating order.
insert into public.submissions
  (user_id, problem_id, selected_choice, is_correct, skipped, elapsed_ms, source, created_at)
values
  -- P_TIME (7056) warm-ups: 5 solves at 10s → solve_count = 5,
  -- ln_time_ewma = ln(10s). The time signal turns ON for everyone after these.
  (md5('synth::twarm_1')::uuid, 7056, 0, true, false, 10000, 'library', timestamptz '2026-06-01 12:00:00+00'),
  (md5('synth::twarm_2')::uuid, 7056, 0, true, false, 10000, 'library', timestamptz '2026-06-01 12:01:00+00'),
  (md5('synth::twarm_3')::uuid, 7056, 0, true, false, 10000, 'library', timestamptz '2026-06-01 12:02:00+00'),
  (md5('synth::twarm_4')::uuid, 7056, 0, true, false, 10000, 'library', timestamptz '2026-06-01 12:03:00+00'),
  (md5('synth::twarm_5')::uuid, 7056, 0, true, false, 10000, 'library', timestamptz '2026-06-01 12:04:00+00'),

  -- P_TIME test solvers, fast → slow (so the problem-rating drift from earlier
  -- wins pushes in the same direction as the time effort: later + slower ⇒
  -- smaller gain). Expect ratings strictly decreasing from time_3 to time_60.
  (md5('synth::time_3')::uuid,  7056, 0, true, false,  3000, 'library', timestamptz '2026-06-02 12:00:00+00'),
  (md5('synth::time_5')::uuid,  7056, 0, true, false,  5000, 'library', timestamptz '2026-06-02 12:01:00+00'),
  (md5('synth::time_8')::uuid,  7056, 0, true, false,  8000, 'library', timestamptz '2026-06-02 12:02:00+00'),
  (md5('synth::time_12')::uuid, 7056, 0, true, false, 12000, 'library', timestamptz '2026-06-02 12:03:00+00'),
  (md5('synth::time_25')::uuid, 7056, 0, true, false, 25000, 'library', timestamptz '2026-06-02 12:04:00+00'),
  (md5('synth::time_60')::uuid, 7056, 0, true, false, 60000, 'library', timestamptz '2026-06-02 12:05:00+00'),

  -- P_ATTEMPT (6480): clean first-try solve vs solve-after-3-misses (one
  -- encounter — all within 30 min). Only 2 solves ⇒ time signal off ⇒ the
  -- wrong attempts are decisive-score losses at retry weight
  -- (0.3, 0.15, 0.075) and the resolving solve is a full-weight win.
  -- Expect: attempt_first gain > attempt_struggle net gain > 0.
  (md5('synth::attempt_first')::uuid,    6480, 0, true,  false, 8000, 'library', timestamptz '2026-06-01 12:00:00+00'),
  (md5('synth::attempt_struggle')::uuid, 6480, 1, false, false, 5000, 'library', timestamptz '2026-06-01 12:00:00+00'),
  (md5('synth::attempt_struggle')::uuid, 6480, 2, false, false, 6000, 'library', timestamptz '2026-06-01 12:03:00+00'),
  (md5('synth::attempt_struggle')::uuid, 6480, 3, false, false, 5000, 'library', timestamptz '2026-06-01 12:07:00+00'),
  (md5('synth::attempt_struggle')::uuid, 6480, 0, true,  false, 7000, 'library', timestamptz '2026-06-01 12:11:00+00'),

  -- P_REPEAT (7048): same user solves it 3× 8 days apart ⇒ 3 encounters,
  -- weights 1 / 0.5 / 0.25. The 12:05 re-solve is in the SAME encounter as the
  -- 12:00 solve ⇒ must be ignored entirely (no rating row, no match count).
  -- Control `repeat_varied` solves 3 DISTINCT problems once each (full weight).
  -- Expect: repeat_varied ends clearly higher than repeat_same.
  (md5('synth::repeat_same')::uuid, 7048, 0, true, false, 10000, 'library', timestamptz '2026-06-01 12:00:00+00'),
  (md5('synth::repeat_same')::uuid, 7048, 0, true, false,  4000, 'library', timestamptz '2026-06-01 12:05:00+00'),
  (md5('synth::repeat_same')::uuid, 7048, 0, true, false, 10000, 'library', timestamptz '2026-06-09 12:00:00+00'),
  (md5('synth::repeat_same')::uuid, 7048, 0, true, false, 10000, 'library', timestamptz '2026-06-17 12:00:00+00'),
  (md5('synth::repeat_varied')::uuid, 7721, 0, true, false, 10000, 'library', timestamptz '2026-06-01 12:00:00+00'),
  (md5('synth::repeat_varied')::uuid, 6811, 0, true, false, 10000, 'library', timestamptz '2026-06-09 12:00:00+00'),
  (md5('synth::repeat_varied')::uuid, 7160, 0, true, false, 10000, 'library', timestamptz '2026-06-17 12:00:00+00'),

  -- P_GUESS (7120) warm-ups: 5 genuine solvers set the normalizer (~9.7s).
  (md5('synth::gwarm_1')::uuid, 7120, 0, true, false,  6000, 'library', timestamptz '2026-06-01 12:00:00+00'),
  (md5('synth::gwarm_2')::uuid, 7120, 0, true, false,  8000, 'library', timestamptz '2026-06-01 12:01:00+00'),
  (md5('synth::gwarm_3')::uuid, 7120, 0, true, false, 10000, 'library', timestamptz '2026-06-01 12:02:00+00'),
  (md5('synth::gwarm_4')::uuid, 7120, 0, true, false, 12000, 'library', timestamptz '2026-06-01 12:03:00+00'),
  (md5('synth::gwarm_5')::uuid, 7120, 0, true, false, 15000, 'library', timestamptz '2026-06-01 12:04:00+00'),

  -- P_GUESS tests: the guard fires below guess_floor_ms (2s), scaling weight
  -- for wins AND losses. 2.5s attempts are the unguarded controls with nearly
  -- the same time effort, so the weight scale is the only difference.
  -- Expect: |Δ(guess_win_fast)| < |Δ(guess_win_slow)| and
  --         |Δ(guess_loss_fast)| < |Δ(guess_loss_slow)|.
  (md5('synth::guess_win_slow')::uuid,  7120, 0, true,  false, 2500, 'library', timestamptz '2026-06-02 12:00:00+00'),
  (md5('synth::guess_win_fast')::uuid,  7120, 0, true,  false, 1200, 'library', timestamptz '2026-06-02 12:01:00+00'),
  (md5('synth::guess_loss_slow')::uuid, 7120, 1, false, false, 2500, 'library', timestamptz '2026-06-02 12:02:00+00'),
  (md5('synth::guess_loss_fast')::uuid, 7120, 1, false, false, 1200, 'library', timestamptz '2026-06-02 12:03:00+00');

commit;
