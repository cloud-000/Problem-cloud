-- Private first-run acknowledgement. `docs/onboarding-and-home.md` §6.
--
-- `profiles` is world-readable, so tour progress and tip acknowledgements
-- cannot live there. This row is self-only: keyed by the student, created
-- lazily on first write, and never a second copy of sessions, submissions,
-- or goals. Product facts stay in those tables; this records UI state.
--
-- Getting started dismissal and acknowledged tips are stored now so Phase 3
-- does not need a second migration. Nothing in Phase 2 reads them.

create table public.user_onboarding (
  user_id uuid references public.profiles(id) on delete cascade not null primary key,
  content_version integer not null default 1,
  welcome_status text not null default 'unseen',
  -- 0-based index of the last completed tour step; null if none.
  last_completed_tour_step integer,
  getting_started_dismissed_at timestamp with time zone,
  acknowledged_tips text[] not null default '{}'::text[],
  welcome_started_at timestamp with time zone,
  welcome_completed_at timestamp with time zone,
  welcome_dismissed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint user_onboarding_content_version check (content_version >= 1),
  constraint user_onboarding_welcome_status check (
    welcome_status in ('unseen', 'in_progress', 'completed', 'dismissed')
  ),
  constraint user_onboarding_tour_step check (
    last_completed_tour_step is null or last_completed_tour_step >= 0
  )
);

alter table public.user_onboarding enable row level security;

create policy "Users can view their own onboarding."
  on public.user_onboarding for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "Users can insert their own onboarding."
  on public.user_onboarding for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "Users can update their own onboarding."
  on public.user_onboarding for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

-- `user_id` and `created_at` stay off the update grant so a row cannot be
-- reassigned or backdated. Everything else is the student's own acknowledgement.
-- Clients must INSERT then UPDATE, not upsert: PostgREST `ON CONFLICT DO UPDATE`
-- needs UPDATE on every written column, including the primary key.
grant select, insert on public.user_onboarding to authenticated;
grant update (
  content_version,
  welcome_status,
  last_completed_tour_step,
  getting_started_dismissed_at,
  acknowledged_tips,
  welcome_started_at,
  welcome_completed_at,
  welcome_dismissed_at,
  updated_at
) on public.user_onboarding to authenticated;
grant all on public.user_onboarding to service_role;
