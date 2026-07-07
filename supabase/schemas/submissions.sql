-- Submission log + per-user-per-problem progress (SM-2 spaced repetition).
--
-- `submissions` is an append-only event log: one row per interaction (a graded
-- answer or a skip). `problem_progress` is a per-(user, problem) aggregate that
-- carries review state. The `handle_new_submission` trigger maintains
-- `problem_progress` from each inserted submission, so app code only ever
-- inserts a submission — the aggregate (and SM-2 schedule) maintains itself.

-- Append-only log of every problem interaction.
create table public.submissions (
  id              bigint generated always as identity primary key,
  user_id         uuid   references public.profiles(id) on delete cascade not null,
  problem_id      bigint references public.problems(id) on delete cascade not null,
  selected_choice integer,                 -- null for skips / non-MCQ
  is_correct      boolean,                  -- null when skipped
  skipped         boolean not null default false,
  flagged         boolean not null default false,
  elapsed_ms      integer,                  -- time spent on this attempt
  source          text,                     -- 'practice' | 'library' | 'review'
  session_id      bigint references public.practice_sessions(id) on delete set null,
  -- Derived rating annotations, filled by the set_submission_encounter trigger
  -- (see ratings.sql); clients never send them. Null on skips. `encounter` is
  -- the 1-based encounter index k for this (user, problem) pair, `attempt` the
  -- 1-based attempt index within that encounter, `encounter_ms` the cumulative
  -- graded time (ms) within the encounter up to and including this attempt.
  encounter       integer,
  attempt         integer,
  encounter_ms    bigint,
  created_at      timestamp with time zone default now() not null
);

create index submissions_user_problem_idx on public.submissions(user_id, problem_id);
create index submissions_user_created_idx on public.submissions(user_id, created_at desc);
create index submissions_session_idx on public.submissions(session_id) where session_id is not null;

-- A Test-format session records exactly one graded submission per problem, all
-- inserted in a single batch at submit time. This partial unique index makes that
-- submit idempotent: a retried submit (a reload after the session-end failed, or
-- a second tab) collides with the constraint and the whole batch rolls back,
-- instead of duplicating every row and double-counting progress. Practice/review
-- submissions (other `source` values) are intentionally unconstrained — they are
-- an append-only log of repeated attempts.
create unique index submissions_test_session_problem_uidx
  on public.submissions(session_id, problem_id)
  where source = 'test';

-- Per-(user, problem) aggregate + SM-2 scheduling state.
create table public.problem_progress (
  user_id            uuid   references public.profiles(id) on delete cascade not null,
  problem_id         bigint references public.problems(id) on delete cascade not null,
  -- counters
  times_seen         integer not null default 0,   -- all submissions incl. skips
  times_reviewed     integer not null default 0,   -- graded (non-skip) attempts
  times_correct      integer not null default 0,
  times_skipped      integer not null default 0,
  total_time_ms      bigint  not null default 0,
  last_submission_at timestamp with time zone,
  last_reviewed_at   timestamp with time zone,
  last_correct       boolean,                       -- outcome of last graded attempt
  -- SM-2 scheduling
  ease_factor        real    not null default 2.5,
  interval_days      integer not null default 0,
  repetitions        integer not null default 0,
  next_review_at     timestamp with time zone,
  -- convenience (used by the Explore indicator)
  solved             boolean generated always as (times_correct > 0) stored,
  created_at         timestamp with time zone default now() not null,
  updated_at         timestamp with time zone default now() not null,
  primary key (user_id, problem_id)
);

create index problem_progress_user_idx   on public.problem_progress(user_id);
create index problem_progress_review_idx on public.problem_progress(user_id, next_review_at);

-- Maintain problem_progress from each inserted submission, applying SM-2 on
-- graded attempts. Runs as `security definer` so it can write problem_progress
-- even though `authenticated` has no direct write grant (same model as
-- handle_new_user writing profiles).
create or replace function public.handle_new_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prog public.problem_progress;
  q  integer;  -- SM-2 quality 0..5
  ef real;
  reps integer;
  iv integer;
begin
  select * into prog
  from public.problem_progress
  where user_id = new.user_id and problem_id = new.problem_id;

  if not found then
    prog.ease_factor := 2.5;
    prog.interval_days := 0;
    prog.repetitions := 0;
    prog.times_seen := 0;
    prog.times_reviewed := 0;
    prog.times_correct := 0;
    prog.times_skipped := 0;
    prog.total_time_ms := 0;
  end if;

  -- Always-updated counters.
  prog.times_seen := prog.times_seen + 1;
  prog.total_time_ms := prog.total_time_ms + coalesce(new.elapsed_ms, 0);
  prog.last_submission_at := new.created_at;

  if new.skipped then
    -- Skips do not advance the SM-2 schedule.
    prog.times_skipped := prog.times_skipped + 1;
  else
    prog.times_reviewed := prog.times_reviewed + 1;
    prog.last_reviewed_at := new.created_at;
    prog.last_correct := coalesce(new.is_correct, false);

    if coalesce(new.is_correct, false) then
      prog.times_correct := prog.times_correct + 1;
      q := 5;
    else
      q := 2;
    end if;

    ef := prog.ease_factor;
    reps := prog.repetitions;
    iv := prog.interval_days;

    if q < 3 then
      reps := 0;
      iv := 1;
    else
      if reps = 0 then
        iv := 1;
      elsif reps = 1 then
        iv := 6;
      else
        iv := round(iv * ef)::integer;
      end if;
      reps := reps + 1;
    end if;

    -- Update ease factor, clamped at 1.3.
    ef := ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if ef < 1.3 then
      ef := 1.3;
    end if;

    prog.ease_factor := ef;
    prog.repetitions := reps;
    prog.interval_days := iv;
    prog.next_review_at := new.created_at + (iv || ' days')::interval;
  end if;

  insert into public.problem_progress (
    user_id, problem_id, times_seen, times_reviewed, times_correct,
    times_skipped, total_time_ms, last_submission_at, last_reviewed_at,
    last_correct, ease_factor, repetitions, interval_days, next_review_at,
    created_at, updated_at
  ) values (
    new.user_id, new.problem_id, prog.times_seen, prog.times_reviewed,
    prog.times_correct, prog.times_skipped, prog.total_time_ms,
    prog.last_submission_at, prog.last_reviewed_at, prog.last_correct,
    prog.ease_factor, prog.repetitions, prog.interval_days, prog.next_review_at,
    now(), now()
  )
  on conflict (user_id, problem_id) do update set
    times_seen = excluded.times_seen,
    times_reviewed = excluded.times_reviewed,
    times_correct = excluded.times_correct,
    times_skipped = excluded.times_skipped,
    total_time_ms = excluded.total_time_ms,
    last_submission_at = excluded.last_submission_at,
    last_reviewed_at = excluded.last_reviewed_at,
    last_correct = excluded.last_correct,
    ease_factor = excluded.ease_factor,
    repetitions = excluded.repetitions,
    interval_days = excluded.interval_days,
    next_review_at = excluded.next_review_at,
    updated_at = now();

  -- Bump the session aggregate when this submission belongs to a session.
  -- Runs as security definer, so it can write the trigger-owned counter columns
  -- despite clients only holding a column-level update grant on metadata.
  if new.session_id is not null then
    update public.practice_sessions set
      times_seen         = times_seen + 1,
      times_reviewed     = times_reviewed + (case when new.skipped then 0 else 1 end),
      times_correct      = times_correct
                             + (case when not new.skipped and coalesce(new.is_correct, false)
                                     then 1 else 0 end),
      times_skipped      = times_skipped + (case when new.skipped then 1 else 0 end),
      total_time_ms      = total_time_ms + coalesce(new.elapsed_ms, 0),
      last_submission_at = new.created_at,
      updated_at         = now()
    where id = new.session_id;
  end if;

  -- Update last active status for the user
  update public.profiles set
    last_active_at = now()
  where id = new.user_id;

  return new;
end;
$$;

create or replace trigger on_submission_created
  after insert on public.submissions
  for each row
  execute function public.handle_new_submission();

-- Enable Row Level Security (RLS)
alter table public.submissions      enable row level security;
alter table public.problem_progress enable row level security;

-- Policies for public.submissions (user-owned; append-only — no update/delete).
create policy "Users can view their own submissions."
  on public.submissions for select
  to authenticated
  using ( auth.uid() = user_id );

create policy "Users can insert their own submissions."
  on public.submissions for insert
  to authenticated
  with check ( auth.uid() = user_id );

-- Policies for public.problem_progress (read-only to clients; trigger writes).
create policy "Users can view their own progress."
  on public.problem_progress for select
  to authenticated
  using ( auth.uid() = user_id );

-- Grant permissions for roles
grant select, insert on public.submissions to authenticated;
grant all on public.submissions to service_role;

grant select on public.problem_progress to authenticated;
grant all on public.problem_progress to service_role;
