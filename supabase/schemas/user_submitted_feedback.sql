-- User-submitted feedback.
--
-- A generic, append-only collection of suggestions/corrections users send in.
-- `type` (free-text) discriminates the kind of feedback. Known values:
--   'answer_suggestion'  — a proposed correct choice (+ optional solution steps)
--                          for a problem with no recorded answer; problem-scoped.
--   'bug_report'         — site-wide bug report (free-text `message`).
--   'feature_suggestion' — site-wide feature/improvement idea (free-text `message`).
--   'general'            — any other general feedback (free-text `message`).
-- Problem-scoped feedback sets `problem_id`/`answer_index`/`steps`; site-wide
-- feedback leaves `problem_id` null and uses `message`. Submitters can read their
-- own rows; admins (admin_rank > 0) can read everything to review and act on it.

create table public.user_submitted_feedback (
  id           bigint generated always as identity primary key,
  user_id      uuid   references public.profiles(id) on delete cascade not null,
  problem_id   bigint references public.problems(id) on delete cascade,    -- null for site-wide feedback
  type         text   not null,                -- e.g. 'answer_suggestion', 'bug_report'
  answer_index integer,                        -- suggested correct choice (into problems.choices)
  steps        text,                           -- free-text solution steps (answer suggestions)
  message      text,                           -- free-text body (site-wide feedback)
  created_at   timestamp with time zone default now() not null,

  -- Admin review state. Answer suggestions resolve via review_answer_suggestion
  -- ('accepted'/'rejected'); site-wide feedback via set_feedback_status
  -- ('resolved'/'dismissed').
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'rejected', 'resolved', 'dismissed')),
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamp with time zone
);

create index user_submitted_feedback_problem_idx
  on public.user_submitted_feedback(problem_id);
create index user_submitted_feedback_user_created_idx
  on public.user_submitted_feedback(user_id, created_at desc);
-- Powers the dashboard's default "pending" view.
create index user_submitted_feedback_pending_idx
  on public.user_submitted_feedback(created_at desc) where status = 'pending';

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

-- Act on a suggestion. Privileged write path: problems is service-role-write-only
-- and this table is append-only for clients, so an admin (admin_rank > 0) routes
-- both the answer write-back and the resolution stamp through this single
-- security-definer function. Accept applies the chosen answer onto the problem
-- (the on_problem_changed trigger then recalculates the test's answer caches) and
-- marks the row accepted; otherwise the row is marked rejected.
create or replace function public.review_answer_suggestion(
  p_feedback_id bigint,
  p_accept boolean,
  p_answer_index integer default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_rank   integer;
  v_fb     public.user_submitted_feedback;
  v_answer integer;
begin
  select admin_rank into v_rank from public.profiles where id = v_caller;
  if coalesce(v_rank, 0) <= 0 then
    raise exception 'not authorized';
  end if;

  select * into v_fb from public.user_submitted_feedback where id = p_feedback_id;
  if not found then
    raise exception 'feedback not found';
  end if;

  if p_accept then
    v_answer := coalesce(p_answer_index, v_fb.answer_index);
    if v_answer is null then
      raise exception 'no answer index to apply';
    end if;
    update public.problems set answer_index = v_answer where id = v_fb.problem_id;
    update public.user_submitted_feedback
      set status = 'accepted', reviewed_by = v_caller, reviewed_at = now()
      where id = p_feedback_id;
  else
    update public.user_submitted_feedback
      set status = 'rejected', reviewed_by = v_caller, reviewed_at = now()
      where id = p_feedback_id;
  end if;
end;
$$;

grant execute on function public.review_answer_suggestion(bigint, boolean, integer)
  to authenticated;

-- Resolve site-wide feedback (bug reports, feature suggestions, general). Unlike
-- review_answer_suggestion there's nothing to write back — this only stamps the
-- resolution. Same admin (admin_rank > 0) gate, routed through a security-definer
-- function because the table is append-only for clients.
create or replace function public.set_feedback_status(
  p_feedback_id bigint,
  p_status text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_rank   integer;
begin
  select admin_rank into v_rank from public.profiles where id = v_caller;
  if coalesce(v_rank, 0) <= 0 then
    raise exception 'not authorized';
  end if;

  if p_status not in ('pending', 'resolved', 'dismissed') then
    raise exception 'invalid status';
  end if;

  update public.user_submitted_feedback
    set status = p_status, reviewed_by = v_caller, reviewed_at = now()
    where id = p_feedback_id;
  if not found then
    raise exception 'feedback not found';
  end if;
end;
$$;

grant execute on function public.set_feedback_status(bigint, text)
  to authenticated;
