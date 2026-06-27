-- Practice sessions: a named, bounded grouping of a user's practice work.
--
-- A submission with session_id = null belongs to the implicit "root" (ungrouped
-- work) — there is no physical root row. A user explicitly starts a session
-- (snapshotting the current practice settings into `settings`), practices, and
-- ends it; multiple sessions may be active at once and the client decides which
-- one new submissions attach to.
--
-- The aggregate counters are maintained by the submissions trigger
-- (`handle_new_submission` in submissions.sql), so app code only ever inserts a
-- submission and updates session metadata (name/status/ended_at) — the counters
-- maintain themselves, mirroring the submissions → problem_progress model.

create table public.practice_sessions (
  id                 bigint generated always as identity primary key,
  user_id            uuid   references public.profiles(id) on delete cascade not null,
  name               text,                                  -- optional user label
  settings           jsonb  not null default '{}'::jsonb,   -- PracticeSettings snapshot
  -- In-progress problem: the one shown but not yet answered or skipped. Lets a
  -- resume continue that exact problem (with its elapsed time) instead of
  -- generating a new one. Cleared once the problem is answered/skipped (it then
  -- lives in `submissions`). `on delete set null` keeps it robust to problem deletes.
  current_problem_id bigint references public.problems(id) on delete set null,
  current_elapsed_ms integer not null default 0,            -- time already spent on it
  status             text   not null default 'active'
                       check (status in ('active', 'ended')),
  started_at         timestamp with time zone not null default now(),
  ended_at           timestamp with time zone,
  -- trigger-maintained aggregate (mirrors problem_progress counters)
  times_seen         integer not null default 0,   -- all submissions incl. skips
  times_reviewed     integer not null default 0,   -- graded (non-skip) attempts
  times_correct      integer not null default 0,
  times_skipped      integer not null default 0,
  total_time_ms      bigint  not null default 0,
  last_submission_at timestamp with time zone,
  created_at         timestamp with time zone not null default now(),
  updated_at         timestamp with time zone not null default now()
);

create index practice_sessions_user_idx on public.practice_sessions(user_id, status);

-- Enable Row Level Security (RLS)
alter table public.practice_sessions enable row level security;

-- Policies (user-owned; clients manage their own sessions' lifecycle).
create policy "Users can view their own sessions."
  on public.practice_sessions for select
  to authenticated
  using ( auth.uid() = user_id );

create policy "Users can insert their own sessions."
  on public.practice_sessions for insert
  to authenticated
  with check ( auth.uid() = user_id );

create policy "Users can update their own sessions."
  on public.practice_sessions for update
  to authenticated
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

create policy "Users can delete their own sessions."
  on public.practice_sessions for delete
  to authenticated
  using ( auth.uid() = user_id );

-- Grants. Clients may only UPDATE metadata columns; the counter columns are
-- written exclusively by the security-definer submissions trigger. The
-- column-level update grant keeps "counters are read-only to clients" (the same
-- intent as problem_progress) without blocking renames/ends.
grant select, insert, delete on public.practice_sessions to authenticated;
grant update (name, status, ended_at, settings, current_problem_id, current_elapsed_ms, updated_at)
  on public.practice_sessions to authenticated;
grant all on public.practice_sessions to service_role;
