-- AI Coach persistence (phases 1–3). Authenticated clients may read only their own safe
-- records; all writes are made by authenticated server endpoints using the
-- service role so roles, provider metadata, and completion status cannot be spoofed.
--
-- Provider credentials are deliberately absent and no table for them will be added:
-- users bring their own keys, which stay in the browser (localStorage) and are sent
-- directly to their provider — the server never receives one. Turns streamed that way
-- are saved afterwards via POST /api/ai/messages, which is why ai_messages stays
-- service-role-only. See src/lib/state/ai-credentials.svelte.ts.
--
-- The first-party hosted connection is the exception that *does* spend a key the
-- server owns (env, never a column). Its allowance is ai_hosted_usage below;
-- BYOK turns never touch that table. Action runs remain deferred.

create table public.ai_preferences (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  default_model    text not null default 'auto',
  history_enabled  boolean not null default true,
  retention_days   integer not null default 30 check (retention_days between 1 and 365),
  created_at       timestamp with time zone not null default now(),
  updated_at       timestamp with time zone not null default now()
);

create table public.ai_conversations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  title            text not null default 'New conversation',
  -- Which family this thread belongs to (docs/ai-coach-sessions.md §1). Drives resume
  -- behavior and retention. A one-shot never reaches this table at all.
  kind             text not null default 'assist' check (kind in ('work', 'assist')),
  -- What a work thread is about; null for assist. Anchored on the CANONICAL problem
  -- (coalesce(canonical_id, id)) for the same reason submissions are: an alias
  -- placement must not fork the thread.
  --
  -- `set null`, not `cascade`: §3 wants a deleted problem to resolve into a degraded
  -- fact the renderer can explain. Cascade would take the user's own writing with it
  -- before anything had a chance to degrade.
  problem_id       bigint references public.problems(id) on delete set null,
  -- Which sitting. This is what makes "resume the same attempt" mean something: the
  -- same problem in a NEW practice session is a NEW thread, not the old one.
  -- Deliberately NOT an FK — an opaque sitting discriminator. Users may delete their
  -- own practice sessions, and an FK would either cascade away the chat history or,
  -- under `set null`, make the delete fail against the partial unique index below. A
  -- dangling id is harmless: the anchor is only looked up while that session is live.
  practice_session_id bigint,
  -- Retention + staleness, without overloading updated_at. Also drives §5's
  -- resumability cutoff, which is why every turn-saving write bumps it and nothing
  -- else touches it: set only at creation it would measure a thread's AGE, and a
  -- thread worked in all afternoon would read as stale.
  last_active_at   timestamp with time zone not null default now(),
  -- When this thread stopped being the LIVE one for its anchor, freeing the unique
  -- index slot below (docs/ai-coach-sessions.md §5). Three things set it: the sitting
  -- concluded and the student moved on, the thread went stale, or the student answered
  -- "start new chat".
  --
  -- Deliberately not `archived_at`. Retiring a work thread and deleting a conversation
  -- are different facts, and overloading one column made every concluded thread vanish
  -- from the user's history — which §2/§5 promise it does not. Retired threads are
  -- still listed, still readable, and still browsable; they simply no longer answer the
  -- anchor lookup.
  retired_at       timestamp with time zone,
  -- Reverse lookup for review/history: the most recent submission that concluded this
  -- sitting. One anchor can conclude repeatedly, so the app intentionally uses
  -- last-write-wins. The conversation survives a deleted submission.
  concluded_submission_id bigint references public.submissions(id) on delete set null,
  archived_at      timestamp with time zone,
  created_at       timestamp with time zone not null default now(),
  updated_at       timestamp with time zone not null default now()
);

create index ai_conversations_user_updated_idx
  on public.ai_conversations(user_id, updated_at desc)
  where archived_at is null;

-- At most one live work thread per (user, problem, practice session). The trainer's
-- "continue or start new chat?" prompt is a UI consequence of this constraint, not a
-- separate mechanism. Both extra clauses are load-bearing:
--
--   * `nulls not distinct` (PG15+) — Postgres treats NULLs as distinct in a unique
--     index by default, so without it "this problem, no practice session" would admit
--     unlimited live threads: the exact case the index exists to bound.
--   * `problem_id is not null` — what makes `on delete set null` safe above. Threads
--     orphaned by a problem delete fall out of the index (so two different deleted
--     problems don't collide on (user, null, session)) and never match the resume
--     lookup, which is correct: there is no longer an anchor to resume onto.
--   * `retired_at is null` — what "live" means. `archived_at` stays in the predicate
--     because a deleted thread is not live either, but it is no longer what releases
--     the slot: that would delete the conversation as a side effect of concluding it.
--
-- Note there is deliberately no `check (kind <> 'work' or problem_id is not null)`:
-- it looks like the obvious integrity constraint and would make deleting a problem
-- fail, since `on delete set null` produces exactly that state on purpose.
create unique index ai_conversations_work_anchor_idx
  on public.ai_conversations (user_id, problem_id, practice_session_id)
  nulls not distinct
  where kind = 'work' and archived_at is null and retired_at is null
    and problem_id is not null;

create table public.ai_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.ai_conversations(id) on delete cascade,
  role              text not null check (role in ('user', 'assistant')),
  content_parts     jsonb not null default '[]'::jsonb,
  resolved_provider text,
  resolved_model    text,
  status            text not null check (status in ('streaming', 'complete', 'failed', 'cancelled')),
  usage_summary     jsonb,
  -- Durable typed refs for the facts active on this user turn. Resolved content and
  -- rendered prompt prose are deliberately never stored; old turns re-resolve live.
  context_snapshot  jsonb not null default '[]'::jsonb,
  created_at        timestamp with time zone not null default now()
);

create index ai_messages_conversation_created_idx
  on public.ai_messages(conversation_id, created_at);

alter table public.ai_preferences enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy "Users can read their own AI preferences."
  on public.ai_preferences for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can read their own AI conversations."
  on public.ai_conversations for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can read messages from their AI conversations."
  on public.ai_messages for select to authenticated
  using (
    exists (
      select 1 from public.ai_conversations conversation
      where conversation.id = conversation_id
        and conversation.user_id = auth.uid()
    )
  );

revoke all on public.ai_preferences from anon, authenticated;
revoke all on public.ai_conversations from anon, authenticated;
revoke all on public.ai_messages from anon, authenticated;

grant select on public.ai_preferences to authenticated;
grant select on public.ai_conversations to authenticated;
grant select on public.ai_messages to authenticated;

grant all on public.ai_preferences to service_role;
grant all on public.ai_conversations to service_role;
grant all on public.ai_messages to service_role;

-- Hosted Coach allowance. One row per user per billing window. `credits` are
-- dimensionless units the server derives from token usage (weights live in env,
-- not here) so a limit can be retuned without a migration; `turns` is the
-- cheaper cap that bounds request fan-out even when a provider omits usage.
-- Clients may read their own row; every write is service-role via the RPCs
-- below so a browser cannot mint free allowance.
create table public.ai_hosted_usage (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  period_start  date not null,
  credits       integer not null default 0 check (credits >= 0),
  turns         integer not null default 0 check (turns >= 0),
  primary key (user_id, period_start)
);

alter table public.ai_hosted_usage enable row level security;

create policy "Users can read their own hosted Coach usage."
  on public.ai_hosted_usage for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.ai_hosted_usage from anon, authenticated;
grant select on public.ai_hosted_usage to authenticated;
grant all on public.ai_hosted_usage to service_role;

-- Atomically spend one turn if the row is still under both caps. Limits are
-- arguments (from server env) so they are not spoofable from the client and
-- do not belong on the row. Returns the row after the increment, or no row
-- when the user is already at a cap — the in-flight turn is allowed to push
-- credits over the limit; the next reserve is what stops.
create or replace function public.reserve_ai_hosted_turn(
  p_user_id uuid,
  p_period_start date,
  p_credit_limit integer,
  p_turn_limit integer
) returns table (
  credits integer,
  turns integer,
  period_start date
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'AI_HOSTED_USAGE:user required';
  end if;
  if p_period_start is null then
    raise exception 'AI_HOSTED_USAGE:period required';
  end if;
  if p_credit_limit is null or p_credit_limit < 0
     or p_turn_limit is null or p_turn_limit < 0 then
    raise exception 'AI_HOSTED_USAGE:limits must be non-negative';
  end if;

  insert into public.ai_hosted_usage (user_id, period_start, credits, turns)
  values (p_user_id, p_period_start, 0, 0)
  on conflict on constraint ai_hosted_usage_pkey do nothing;

  return query
  update public.ai_hosted_usage as usage
     set turns = usage.turns + 1
   where usage.user_id = p_user_id
     and usage.period_start = p_period_start
     and usage.turns < p_turn_limit
     and usage.credits < p_credit_limit
  returning usage.credits, usage.turns, usage.period_start;
end;
$$;

-- Records credits for a turn that already reserved. An in-flight reply may
-- push the balance over the credit cap; reserve_ai_hosted_turn is what
-- refuses the next one.
create or replace function public.add_ai_hosted_credits(
  p_user_id uuid,
  p_period_start date,
  p_credits integer
) returns public.ai_hosted_usage
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.ai_hosted_usage;
begin
  if p_user_id is null then
    raise exception 'AI_HOSTED_USAGE:user required';
  end if;
  if p_period_start is null then
    raise exception 'AI_HOSTED_USAGE:period required';
  end if;
  if p_credits is null or p_credits < 0 then
    raise exception 'AI_HOSTED_USAGE:credits must be non-negative';
  end if;

  insert into public.ai_hosted_usage as usage (user_id, period_start, credits, turns)
  values (p_user_id, p_period_start, p_credits, 0)
  on conflict (user_id, period_start)
  do update set credits = usage.credits + excluded.credits
  returning * into updated;

  return updated;
end;
$$;

revoke all on function public.reserve_ai_hosted_turn(uuid, date, integer, integer)
  from public, anon, authenticated;
revoke all on function public.add_ai_hosted_credits(uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_hosted_turn(uuid, date, integer, integer)
  to service_role;
grant execute on function public.add_ai_hosted_credits(uuid, date, integer)
  to service_role;
