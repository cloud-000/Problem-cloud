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
  created_at      timestamp with time zone default now() not null
);

create index submissions_user_problem_idx on public.submissions(user_id, problem_id);
create index submissions_user_created_idx on public.submissions(user_id, created_at desc);

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
