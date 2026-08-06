-- AI Coach persistence (phases 1–2). Authenticated clients may read only their own safe
-- records; all writes are made by authenticated server endpoints using the
-- service role so roles, provider metadata, and completion status cannot be spoofed.
--
-- Provider credentials are deliberately absent and no table for them will be added:
-- users bring their own keys, which stay in the browser (localStorage) and are sent
-- directly to their provider — the server never receives one. Turns streamed that way
-- are saved afterwards via POST /api/ai/messages, which is why ai_messages stays
-- service-role-only. See src/lib/state/ai-credentials.svelte.ts.
-- Usage and action runs remain deferred.

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
  mode             text not null default 'general'
                     check (mode in ('general', 'problem_help', 'progress', 'review')),
  context_summary  jsonb not null default '[]'::jsonb,
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
--
-- Note there is deliberately no `check (kind <> 'work' or problem_id is not null)`:
-- it looks like the obvious integrity constraint and would make deleting a problem
-- fail, since `on delete set null` produces exactly that state on purpose.
create unique index ai_conversations_work_anchor_idx
  on public.ai_conversations (user_id, problem_id, practice_session_id)
  nulls not distinct
  where kind = 'work' and archived_at is null and problem_id is not null;

create table public.ai_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.ai_conversations(id) on delete cascade,
  role              text not null check (role in ('user', 'assistant')),
  content_parts     jsonb not null default '[]'::jsonb,
  resolved_provider text,
  resolved_model    text,
  status            text not null check (status in ('streaming', 'complete', 'failed', 'cancelled')),
  usage_summary     jsonb,
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
