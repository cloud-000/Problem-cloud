-- User-submitted feedback on problems.
--
-- A generic, append-only collection of suggestions/corrections users send in to
-- help improve the problem database. `type` discriminates the kind of feedback;
-- the first use is 'answer_suggestion' — a proposed correct choice (+ optional
-- solution steps) for a problem that currently has no recorded answer
-- (`problems.answer_index = -1` or null). Submitters can read their own rows;
-- admins (admin_rank > 0) can read everything to review and act on it.

create table public.user_submitted_feedback (
  id           bigint generated always as identity primary key,
  user_id      uuid   references public.profiles(id) on delete cascade not null,
  problem_id   bigint references public.problems(id) on delete cascade not null,
  type         text   not null,                -- e.g. 'answer_suggestion'
  answer_index integer,                        -- suggested correct choice (into problems.choices)
  steps        text,                           -- free-text solution steps
  created_at   timestamp with time zone default now() not null
);

create index user_submitted_feedback_problem_idx
  on public.user_submitted_feedback(problem_id);
create index user_submitted_feedback_user_created_idx
  on public.user_submitted_feedback(user_id, created_at desc);

-- Enable Row Level Security (RLS)
alter table public.user_submitted_feedback enable row level security;

-- Submitter can read/insert their own (append-only — no update/delete).
create policy "Users can view their own feedback."
  on public.user_submitted_feedback for select
  to authenticated
  using ( auth.uid() = user_id );

create policy "Users can insert their own feedback."
  on public.user_submitted_feedback for insert
  to authenticated
  with check ( auth.uid() = user_id );

-- Admins can review all feedback — mirrors the notifications admin pattern.
create policy "Admins can view all feedback."
  on public.user_submitted_feedback for select
  to authenticated
  using ( (select admin_rank from public.profiles where id = auth.uid()) > 0 );

-- Grant permissions for roles
grant select, insert on public.user_submitted_feedback to authenticated;
grant all on public.user_submitted_feedback to service_role;
