-- Roadmap Goals and Voting Schema

-- Create roadmap goals table
create table public.roadmap_goals (
  id           integer generated always as identity primary key,
  title        text not null,
  description  text not null,
  status       text not null default 'future'
                 check (status in ('done', 'active', 'future')),
  planned_date date,
  created_at   timestamp with time zone default now() not null,
  updated_at   timestamp with time zone default now() not null
);

-- Create index on status for faster lookup / Kanban sorting
create index roadmap_goals_status_idx on public.roadmap_goals(status);

-- Create votes table
create table public.roadmap_votes (
  goal_id    integer references public.roadmap_goals(id) on delete cascade not null,
  profile_id uuid references public.profiles(id) on delete cascade not null,
  vote_value integer not null check (vote_value in (1, -1)),
  primary key (goal_id, profile_id)
);

-- Enable Row Level Security (RLS)
alter table public.roadmap_goals enable row level security;
alter table public.roadmap_votes enable row level security;

-- RLS Policies for roadmap_goals
create policy "Roadmap goals are viewable by everyone."
  on public.roadmap_goals for select
  using ( true );

create policy "Admins can insert roadmap goals."
  on public.roadmap_goals for insert
  to authenticated
  with check ( (select admin_rank from public.profiles where id = auth.uid()) > 10 );

create policy "Admins can update roadmap goals."
  on public.roadmap_goals for update
  to authenticated
  using ( (select admin_rank from public.profiles where id = auth.uid()) > 10 );

create policy "Admins can delete roadmap goals."
  on public.roadmap_goals for delete
  to authenticated
  using ( (select admin_rank from public.profiles where id = auth.uid()) > 10 );

-- RLS Policies for roadmap_votes
create policy "Roadmap votes are viewable by everyone."
  on public.roadmap_votes for select
  using ( true );

create policy "Users can insert their own vote."
  on public.roadmap_votes for insert
  to authenticated
  with check ( auth.uid() = profile_id );

create policy "Users can update their own vote."
  on public.roadmap_votes for update
  to authenticated
  using ( auth.uid() = profile_id );

create policy "Users can delete their own vote."
  on public.roadmap_votes for delete
  to authenticated
  using ( auth.uid() = profile_id );

-- Grant permissions for roles
grant select on public.roadmap_goals to anon;
grant select, insert, update, delete on public.roadmap_goals to authenticated;
grant all on public.roadmap_goals to service_role;

grant select on public.roadmap_votes to anon;
grant select, insert, update, delete on public.roadmap_votes to authenticated;
grant all on public.roadmap_votes to service_role;
