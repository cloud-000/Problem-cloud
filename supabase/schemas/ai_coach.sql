-- Phase 1 AI Coach persistence. Provider credentials, usage, and action runs are
-- intentionally deferred. Authenticated clients may read only their own safe
-- records; all writes are made by authenticated server endpoints using the
-- service role so roles, provider metadata, and completion status cannot be spoofed.

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
  archived_at      timestamp with time zone,
  created_at       timestamp with time zone not null default now(),
  updated_at       timestamp with time zone not null default now()
);

create index ai_conversations_user_updated_idx
  on public.ai_conversations(user_id, updated_at desc)
  where archived_at is null;

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
