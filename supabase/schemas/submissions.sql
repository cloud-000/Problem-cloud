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
  -- Multi-try practice: how many wrong attempts the user burned before this
  -- recorded (final) outcome. 0 = solved/answered on the first try. Client-sent
  -- (the trainer only logs a problem's final outcome, so intermediate wrong
  -- tries never become their own rows — this preserves the first-try signal that
  -- would otherwise be lost). Analytics-only: the rating pipeline ignores it and
  -- keys off `attempt`/`encounter` instead (see ratings.sql, docs/ratings.md §5).
  tries_used      integer not null default 0,
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

-- Per-(user, problem) factual aggregate + SM-2 scheduling + user-owned
-- organization. A row may exist with times_seen = 0 when a user classifies an
-- unseen problem; row existence is therefore not an activity signal.
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
  -- Explicit personal organization. These are never inferred from submissions
  -- or SM-2 and are writable only through the narrow RPCs below.
  mastery             text check (mastery in ('needs_work', 'learning', 'confident')),
  engagement          text check (engagement in ('working', 'revisit', 'later', 'ignored')),
  -- convenience (used by the Explore indicator)
  solved             boolean generated always as (times_correct > 0) stored,
  created_at         timestamp with time zone default now() not null,
  updated_at         timestamp with time zone default now() not null,
  primary key (user_id, problem_id)
);

create index problem_progress_user_idx   on public.problem_progress(user_id);
create index problem_progress_review_idx on public.problem_progress(user_id, next_review_at);
create index problem_progress_mastery_idx
  on public.problem_progress(user_id, mastery, problem_id);
create index problem_progress_engagement_idx
  on public.problem_progress(user_id, engagement, problem_id);

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

-- Set or clear the caller's explicit mastery assessment. The function may
-- create a zero-activity row, but can never mutate factual or SM-2 columns.
create or replace function public.set_problem_mastery(
  p_problem_id bigint,
  p_mastery text
) returns table (problem_id bigint, mastery text, engagement text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_mastery is not null
     and p_mastery not in ('needs_work', 'learning', 'confident') then
    raise exception 'invalid mastery';
  end if;

  insert into public.problem_progress (user_id, problem_id, mastery)
  values (v_user_id, p_problem_id, p_mastery)
  on conflict on constraint problem_progress_pkey do update
    set mastery = excluded.mastery;

  delete from public.problem_progress pp
  where pp.user_id = v_user_id
    and pp.problem_id = p_problem_id
    and pp.times_seen = 0
    and pp.mastery is null
    and pp.engagement is null;

  return query
  select p_problem_id, pp.mastery, pp.engagement
  from public.problem_progress pp
  where pp.user_id = v_user_id and pp.problem_id = p_problem_id;
  if not found then
    return query select p_problem_id, null::text, null::text;
  end if;
end;
$$;

-- Set or clear the caller's explicit next-step plan. Kept separate from
-- mastery so each axis can be saved and rolled back independently.
create or replace function public.set_problem_engagement(
  p_problem_id bigint,
  p_engagement text
) returns table (problem_id bigint, mastery text, engagement text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_engagement is not null
     and p_engagement not in ('working', 'revisit', 'later', 'ignored') then
    raise exception 'invalid engagement';
  end if;

  insert into public.problem_progress (user_id, problem_id, engagement)
  values (v_user_id, p_problem_id, p_engagement)
  on conflict on constraint problem_progress_pkey do update
    set engagement = excluded.engagement;

  delete from public.problem_progress pp
  where pp.user_id = v_user_id
    and pp.problem_id = p_problem_id
    and pp.times_seen = 0
    and pp.mastery is null
    and pp.engagement is null;

  return query
  select p_problem_id, pp.mastery, pp.engagement
  from public.problem_progress pp
  where pp.user_id = v_user_id and pp.problem_id = p_problem_id;
  if not found then
    return query select p_problem_id, null::text, null::text;
  end if;
end;
$$;

revoke all on function public.set_problem_mastery(bigint, text) from public;
revoke all on function public.set_problem_engagement(bigint, text) from public;
grant execute on function public.set_problem_mastery(bigint, text) to authenticated;
grant execute on function public.set_problem_engagement(bigint, text) to authenticated;

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
  coalesce(pp.engagement = 'ignored', false) as is_ignored
from public.problems p
left join public.tests t on t.id = p.test_id
left join public.problem_progress pp
  on pp.problem_id = p.id and pp.user_id = auth.uid();

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
