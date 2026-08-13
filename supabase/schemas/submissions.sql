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
  -- The solver's free-text response for non-MCQ (computational / free-response)
  -- problems; null for MCQ (the choice is in selected_choice) and skips. Persisted
  -- so a graded answer stays auditable/re-gradable: grading happens in the client
  -- (answersMatch: lexical, then numeric value -- never symbolic algebra)
  -- and the stored correct answer can carry unit labels/LaTeX, so keeping the raw
  -- response lets a later re-grade + recompute_ratings repair a grading change, and
  -- lets the results screen show what was typed after a reload.
  answer          text,
  is_correct      boolean,                  -- null when ungraded, including skips
  skipped         boolean not null default false,
  flagged         boolean not null default false,
  elapsed_ms      integer,                  -- time spent on this attempt
  source          text,                     -- 'practice' | 'library' | 'review'
  session_id      bigint references public.practice_sessions(id) on delete set null,
  -- Browser-owned idempotency key used only by the closed offline sync RPC.
  -- The ordinary online insert path leaves it null.
  client_key      uuid,
  -- Bounded occurrence metadata for display/audit. Rating, progress, encounter,
  -- and session ordering continue to use server receipt-order created_at.
  occurred_at     timestamp with time zone,
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
create unique index submissions_user_client_key_uidx
  on public.submissions(user_id, client_key) where client_key is not null;

comment on column public.submissions.is_correct is
  'Grading outcome: true for correct, false for incorrect, and null for ungraded submissions (including skips).';

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

-- Canonicalize duplicate problems at the source. If the submitted problem is an
-- ALIAS (problems.canonical_id set), rewrite problem_id to the canonical BEFORE
-- any other trigger sees the row, so a single real-world problem has ONE shared
-- rating and ONE shared per-user progress no matter which test placement the user
-- solved it under (e.g. AMC 10A #18 vs AMC 12A #12). Everything downstream
-- (encounter annotation, SM-2 progress, Glicko rating) then keys off the
-- canonical with zero further changes.
--
-- Ordering is load-bearing: Postgres fires BEFORE-row triggers in trigger-NAME
-- order, and set_submission_encounter's trigger is `on_submission_annotate`, so
-- this trigger's name MUST sort before it ('a_' < 'on_'). Do not rename without
-- preserving that order.
create or replace function public.canonicalize_submission_problem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical bigint;
begin
  select canonical_id into v_canonical
  from public.problems
  where id = new.problem_id;
  if v_canonical is not null then
    new.problem_id := v_canonical;
  end if;
  return new;
end;
$$;

create or replace trigger a_canonicalize_submission
  before insert on public.submissions
  for each row
  execute function public.canonicalize_submission_problem();

-- Per-(user, problem) factual aggregate + SM-2 scheduling + user-owned
-- organization. A row may exist with times_seen = 0 when a user classifies an
-- unseen problem; row existence is therefore not an activity signal.
create table public.problem_progress (
  user_id            uuid   references public.profiles(id) on delete cascade not null,
  problem_id         bigint references public.problems(id) on delete cascade not null,
  -- counters
  times_seen         integer not null default 0,   -- all submissions incl. skips
  times_reviewed     integer not null default 0,   -- graded attempts (non-skip, known outcome)
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

-- Keep every progress write on the real problem's shared-state owner. Normal
-- submission writes already arrive canonicalized by a_canonicalize_submission,
-- and the organization RPCs below resolve the id explicitly so they can return
-- it to the caller. This trigger is defense in depth for service-role/internal
-- inserts and any future write path.
create or replace function public.canonicalize_problem_progress_problem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical bigint;
begin
  select canonical_id into v_canonical
  from public.problems
  where id = new.problem_id;
  if v_canonical is not null then
    new.problem_id := v_canonical;
  end if;
  return new;
end;
$$;

create or replace trigger a_canonicalize_problem_progress
  before insert or update of problem_id on public.problem_progress
  for each row
  execute function public.canonicalize_problem_progress_problem();

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
  elsif new.is_correct is not null then
    -- Ungraded non-skips count as seen, but do not become reviews or alter SM-2.
    prog.times_reviewed := prog.times_reviewed + 1;
    prog.last_reviewed_at := new.created_at;
    prog.last_correct := new.is_correct;

    if new.is_correct then
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
      times_reviewed     = times_reviewed
                             + (case when not new.skipped and new.is_correct is not null
                                     then 1 else 0 end),
      times_correct      = times_correct
                             + (case when not new.skipped and new.is_correct is true
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
  v_problem_id bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_mastery is not null
     and p_mastery not in ('needs_work', 'learning', 'confident') then
    raise exception 'invalid mastery';
  end if;

  select coalesce(p.canonical_id, p.id) into v_problem_id
  from public.problems p
  where p.id = p_problem_id;
  if not found then
    raise exception 'problem % not found', p_problem_id;
  end if;

  insert into public.problem_progress (user_id, problem_id, mastery)
  values (v_user_id, v_problem_id, p_mastery)
  on conflict on constraint problem_progress_pkey do update
    set mastery = excluded.mastery;

  delete from public.problem_progress pp
  where pp.user_id = v_user_id
    and pp.problem_id = v_problem_id
    and pp.times_seen = 0
    and pp.mastery is null
    and pp.engagement is null;

  return query
  select v_problem_id, pp.mastery, pp.engagement
  from public.problem_progress pp
  where pp.user_id = v_user_id and pp.problem_id = v_problem_id;
  if not found then
    return query select v_problem_id, null::text, null::text;
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
  v_problem_id bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_engagement is not null
     and p_engagement not in ('working', 'revisit', 'later', 'ignored') then
    raise exception 'invalid engagement';
  end if;

  select coalesce(p.canonical_id, p.id) into v_problem_id
  from public.problems p
  where p.id = p_problem_id;
  if not found then
    raise exception 'problem % not found', p_problem_id;
  end if;

  insert into public.problem_progress (user_id, problem_id, engagement)
  values (v_user_id, v_problem_id, p_engagement)
  on conflict on constraint problem_progress_pkey do update
    set engagement = excluded.engagement;

  delete from public.problem_progress pp
  where pp.user_id = v_user_id
    and pp.problem_id = v_problem_id
    and pp.times_seen = 0
    and pp.mastery is null
    and pp.engagement is null;

  return query
  select v_problem_id, pp.mastery, pp.engagement
  from public.problem_progress pp
  where pp.user_id = v_user_id and pp.problem_id = v_problem_id;
  if not found then
    return query select v_problem_id, null::text, null::text;
  end if;
end;
$$;

revoke all on function public.set_problem_mastery(bigint, text) from public;
revoke all on function public.set_problem_engagement(bigint, text) from public;
grant execute on function public.set_problem_mastery(bigint, text) to authenticated;
grant execute on function public.set_problem_engagement(bigint, text) to authenticated;

-- The `user_problem_index` view and its `problem_state_summary` consumer moved to
-- schemas/user_problem_index.sql -- the view now joins problem_ratings (ratings.sql,
-- loaded after this file), so it must live in a file loaded after both.

-- ---------------------------------------------------------------------------
-- Duplicate-problem backfill (one-time, admin-only).
--
-- Rebuilds a single (user, problem) problem_progress row by REPLAYING that pair's
-- submissions in chronological order through the exact SM-2 recurrence that
-- handle_new_submission applies live — the progress analogue of
-- recompute_ratings(). User-owned intent columns (mastery/engagement) are
-- preserved (the on-conflict update omits them). Used by
-- canonicalize_existing_user_data() below to merge an alias's history into its
-- canonical, and reusable as a general repair tool.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_problem_progress(
  p_user_id uuid,
  p_problem_id bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        record;
  ts       integer := 0;   -- times_seen
  tr       integer := 0;   -- times_reviewed
  tc       integer := 0;   -- times_correct
  tk       integer := 0;   -- times_skipped
  ttime    bigint  := 0;   -- total_time_ms
  last_sub timestamptz;
  last_rev timestamptz;
  last_cor boolean;
  ef       real    := 2.5;
  reps     integer := 0;
  iv       integer := 0;
  nra      timestamptz;
  q        integer;
begin
  for s in
    select elapsed_ms, skipped, is_correct, created_at
    from public.submissions
    where user_id = p_user_id and problem_id = p_problem_id
    order by created_at asc, id asc
  loop
    ts    := ts + 1;
    ttime := ttime + coalesce(s.elapsed_ms, 0);
    last_sub := s.created_at;
    if s.skipped then
      tk := tk + 1;                         -- skips don't advance SM-2
    elsif s.is_correct is not null then
      -- Ungraded non-skips count as seen, but do not become reviews or alter SM-2.
      tr := tr + 1;
      last_rev := s.created_at;
      last_cor := s.is_correct;
      if s.is_correct then
        tc := tc + 1; q := 5;
      else
        q := 2;
      end if;
      if q < 3 then
        reps := 0; iv := 1;
      else
        if reps = 0 then iv := 1;
        elsif reps = 1 then iv := 6;
        else iv := round(iv * ef)::integer;
        end if;
        reps := reps + 1;
      end if;
      ef := ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
      if ef < 1.3 then ef := 1.3; end if;
      nra := s.created_at + (iv || ' days')::interval;
    end if;
  end loop;

  if ts = 0 then
    return;   -- no submissions for this pair; leave any intent-only row untouched
  end if;

  insert into public.problem_progress (
    user_id, problem_id, times_seen, times_reviewed, times_correct,
    times_skipped, total_time_ms, last_submission_at, last_reviewed_at,
    last_correct, ease_factor, repetitions, interval_days, next_review_at,
    created_at, updated_at
  ) values (
    p_user_id, p_problem_id, ts, tr, tc, tk, ttime, last_sub, last_rev,
    last_cor, ef, reps, iv, nra, now(), now()
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
  -- mastery/engagement omitted above => user-owned intent survives the rebuild.
end;
$$;

-- One-time migration of EXISTING user data onto canonical problems. Safe to run
-- only AFTER a content sync has populated problems.canonical_id (i.e. the scraper
-- has emitted canonical_sync_key). Idempotent: re-running is a near no-op because
-- submissions are already canonical. Steps:
--   1. Repoint historical submissions from each alias to its canonical.
--   2. Drop the now-stale alias-keyed progress + rating rows (rebuilt below).
--   3. Replay progress for every affected (user, canonical) pair.
--   4. recompute_ratings() to rebuild all ratings from the corrected log.
-- Before dropping alias rows, mastery and engagement are merged independently
-- onto the canonical. The most recently updated non-null value wins; ties prefer
-- the canonical row. This preserves the user's latest explicit choice regardless
-- of which test placement they used.
create or replace function public.canonicalize_existing_user_data()
returns table (
  submissions_moved      bigint,
  progress_rebuilt       bigint,
  alias_progress_dropped bigint,
  alias_ratings_dropped  bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved   bigint := 0;
  v_rebuilt bigint := 0;
  v_prog    bigint := 0;
  v_rat     bigint := 0;
  r         record;
begin
  -- Affected (user, canonical) pairs, captured BEFORE repointing.
  create temporary table _affected_pairs on commit drop as
  select distinct s.user_id, p.canonical_id as problem_id
  from public.submissions s
  join public.problems p on p.id = s.problem_id
  where p.canonical_id is not null;

  -- Merge explicit user intent before deleting alias progress. Mastery and
  -- engagement are selected independently because either axis may be null.
  create temporary table _merged_alias_intent on commit drop as
  with mapped as (
    select pp.user_id,
           pp.problem_id as source_problem_id,
           coalesce(p.canonical_id, p.id) as problem_id,
           pp.mastery,
           pp.engagement,
           pp.updated_at
    from public.problem_progress pp
    join public.problems p on p.id = pp.problem_id
  ), affected as (
    select distinct user_id, problem_id
    from mapped
    where source_problem_id <> problem_id
  )
  select m.user_id,
         m.problem_id,
         (array_agg(m.mastery order by m.updated_at desc,
                    (m.source_problem_id = m.problem_id) desc,
                    m.source_problem_id desc)
            filter (where m.mastery is not null))[1] as mastery,
         (array_agg(m.engagement order by m.updated_at desc,
                    (m.source_problem_id = m.problem_id) desc,
                    m.source_problem_id desc)
            filter (where m.engagement is not null))[1] as engagement
  from mapped m
  join affected a using (user_id, problem_id)
  group by m.user_id, m.problem_id;

  with moved as (
    update public.submissions s
    set problem_id = p.canonical_id
    from public.problems p
    where p.id = s.problem_id and p.canonical_id is not null
    returning 1
  )
  select pg_catalog.count(*) into v_moved from moved;

  insert into public.problem_progress (user_id, problem_id, mastery, engagement)
  select user_id, problem_id, mastery, engagement
  from _merged_alias_intent
  on conflict on constraint problem_progress_pkey do update
    set mastery = excluded.mastery,
        engagement = excluded.engagement,
        updated_at = now();

  with d as (
    delete from public.problem_progress pp
    using public.problems p
    where p.id = pp.problem_id and p.canonical_id is not null
    returning 1
  )
  select pg_catalog.count(*) into v_prog from d;

  with d as (
    delete from public.problem_ratings rr
    using public.problems p
    where p.id = rr.problem_id and p.canonical_id is not null
    returning 1
  )
  select pg_catalog.count(*) into v_rat from d;

  delete from public.problem_rating_stats st
  using public.problems p
  where p.id = st.problem_id and p.canonical_id is not null;

  delete from public.problem_rating_history h
  using public.problems p
  where p.id = h.problem_id and p.canonical_id is not null;

  for r in select user_id, problem_id from _affected_pairs loop
    perform public.recompute_problem_progress(r.user_id, r.problem_id);
    v_rebuilt := v_rebuilt + 1;
  end loop;

  perform public.recompute_ratings();

  return query select v_moved, v_rebuilt, v_prog, v_rat;
end;
$$;

revoke all on function public.recompute_problem_progress(uuid, bigint) from public;
revoke all on function public.canonicalize_existing_user_data() from public;
grant execute on function public.recompute_problem_progress(uuid, bigint) to service_role;
grant execute on function public.canonicalize_existing_user_data() to service_role;
