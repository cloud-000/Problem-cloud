-- Create notifications table
create table public.notifications (
  id bigint generated always as identity primary key,
  sender_id uuid references public.profiles(id) on delete set null,
  title text not null,
  message text not null,
  targets uuid[], -- null targets means everyone
  payload jsonb,
  created_at timestamp with time zone default now() not null
);

-- Create notification_reads table
create table public.notification_reads (
  user_id uuid references public.profiles(id) on delete cascade not null,
  notification_id bigint references public.notifications(id) on delete cascade not null,
  read_at timestamp with time zone default now() not null,
  primary key (user_id, notification_id)
);

-- Enable Row Level Security (RLS)
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

-- Policies for public.notifications
create policy "Notifications are viewable by their target users."
  on public.notifications for select
  to anon, authenticated
  using ( (targets is null) or (auth.uid() = any(targets)) );

create policy "Admins can insert notifications."
  on public.notifications for insert
  to authenticated
  with check ( (select admin_rank from public.profiles where id = auth.uid()) > 0 );

create policy "Admins can update notifications."
  on public.notifications for update
  to authenticated
  using ( (select admin_rank from public.profiles where id = auth.uid()) > 0 )
  with check ( (select admin_rank from public.profiles where id = auth.uid()) > 0 );

create policy "Admins can delete notifications."
  on public.notifications for delete
  to authenticated
  using ( (select admin_rank from public.profiles where id = auth.uid()) > 0 );

-- Policies for public.notification_reads
create policy "Users can view their own read records."
  on public.notification_reads for select
  to authenticated
  using ( auth.uid() = user_id );

create policy "Users can insert their own read records."
  on public.notification_reads for insert
  to authenticated
  with check ( auth.uid() = user_id );

-- Grant permissions for roles
grant select on public.notifications to anon, authenticated;
grant insert, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;

grant select, insert on public.notification_reads to authenticated;
grant all on public.notification_reads to service_role;

-- Enable Realtime replication for notifications
alter publication supabase_realtime add table public.notifications;
