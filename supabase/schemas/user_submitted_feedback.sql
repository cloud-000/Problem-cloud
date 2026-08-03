-- User-submitted feedback.
--
-- A generic, append-only collection of suggestions/corrections users send in.
-- `type` discriminates the review workflow. Known values:
--   'problem_report'     — problem-scoped feedback. `answer_index` or
--                          `answer_text` may propose a correct answer;
--                          `message` carries the report explanation.
--   'bug_report'         — site-wide bug report (free-text `message`).
--   'feature_suggestion' — site-wide feature/improvement idea (free-text `message`).
--   'general'            — any other general feedback (free-text `message`).
-- Problem-scoped feedback sets `problem_id` and at least one of
-- `answer_index`/`answer_text`/`message`; site-wide
-- feedback leaves `problem_id` null and uses `message`. Submitters can read their
-- own rows; admins (admin_rank > 0) can read everything to review and act on it.

create table public.user_submitted_feedback (
  id           bigint generated always as identity primary key,
  user_id      uuid   references public.profiles(id) on delete cascade not null,
  problem_id   bigint references public.problems(id) on delete cascade,    -- null for site-wide feedback
  type         text   not null,                -- e.g. 'problem_report', 'bug_report'
  answer_index integer,                        -- suggested correct choice (into problems.choices)
  answer_text  text,                           -- suggested custom/free-response answer
  message      text,                           -- free-text report/feedback body
  created_at   timestamp with time zone default now() not null,

  -- Every feedback workflow shares one review lifecycle. A problem report may
  -- additionally apply its optional answer via review_problem_report.
  status       text not null default 'pending'
                 check (status in ('pending', 'resolved', 'dismissed')),
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamp with time zone,

  constraint user_submitted_feedback_payload_check check (
    case type
      when 'problem_report' then
        problem_id is not null
        and not (
          answer_index is not null
          and nullif(btrim(answer_text), '') is not null
        )
        and (
          answer_index is not null
          or nullif(btrim(answer_text), '') is not null
          or nullif(btrim(message), '') is not null
        )
      when 'bug_report' then
        problem_id is null and answer_index is null and answer_text is null
        and nullif(btrim(message), '') is not null
      when 'feature_suggestion' then
        problem_id is null and answer_index is null and answer_text is null
        and nullif(btrim(message), '') is not null
      when 'general' then
        problem_id is null and answer_index is null and answer_text is null
        and nullif(btrim(message), '') is not null
      else false
    end
  )
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
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
  );

-- Admins can review all feedback — mirrors the notifications admin pattern.
create policy "Admins can view all feedback."
  on public.user_submitted_feedback for select
  to authenticated
  using ( (select admin_rank from public.profiles where id = auth.uid()) > 0 );

-- Grant permissions for roles
grant select, insert on public.user_submitted_feedback to authenticated;
grant all on public.user_submitted_feedback to service_role;

-- Review a problem report. Privileged write path: problems is
-- service-role-write-only
-- and this table is append-only for clients, so an admin (admin_rank > 0) routes
-- both the optional answer write-back and the resolution stamp through this
-- security-definer function. Applying the answer updates the problem (the
-- on_problem_changed trigger then recalculates the test's answer caches).
create or replace function public.review_problem_report(
  p_feedback_id bigint,
  p_status text,
  p_apply_answer boolean default false,
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

  if v_fb.type <> 'problem_report' then
    raise exception 'feedback is not a problem report';
  end if;
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'invalid status';
  end if;
  if p_apply_answer and p_status <> 'resolved' then
    raise exception 'an applied answer must resolve the report';
  end if;

  if p_apply_answer then
    v_answer := coalesce(p_answer_index, v_fb.answer_index);
    if v_answer is null then
      raise exception 'no answer index to apply';
    end if;
    if v_answer < 0 or not exists (
      select 1
      from public.problems p
      where p.id = v_fb.problem_id
        and p.choices is not null
        and v_answer < cardinality(p.choices)
    ) then
      raise exception 'invalid answer index';
    end if;
    update public.problems set answer_index = v_answer where id = v_fb.problem_id;
  end if;

  update public.user_submitted_feedback
    set status = p_status, reviewed_by = v_caller, reviewed_at = now()
    where id = p_feedback_id;
end;
$$;

grant execute on function public.review_problem_report(bigint, text, boolean, integer)
  to authenticated;

-- Resolve site-wide feedback (bug reports, feature suggestions, general). Unlike
-- review_problem_report there's nothing to write back — this only stamps the
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
  v_type   text;
begin
  select admin_rank into v_rank from public.profiles where id = v_caller;
  if coalesce(v_rank, 0) <= 0 then
    raise exception 'not authorized';
  end if;

  if p_status not in ('pending', 'resolved', 'dismissed') then
    raise exception 'invalid status';
  end if;

  select type into v_type
    from public.user_submitted_feedback
    where id = p_feedback_id;
  if not found then
    raise exception 'feedback not found';
  end if;
  if v_type = 'problem_report' then
    raise exception 'use review_problem_report for problem reports';
  end if;

  update public.user_submitted_feedback
    set status = p_status, reviewed_by = v_caller, reviewed_at = now()
    where id = p_feedback_id;
end;
$$;

grant execute on function public.set_feedback_status(bigint, text)
  to authenticated;
