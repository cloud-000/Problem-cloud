-- Create a table for public profiles
create table public.profiles (
  -- "on delete cascade" automatically deletes the profile when the user is deleted.
  id uuid references auth.users(id) on delete cascade not null primary key,
  username text unique,
  status text,
  admin_rank integer not null default 0,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,

  -- Username length constraint
  constraint username_length check (char_length(username) >= 3)
);

-- Enable Row Level Security (RLS)
alter table public.profiles enable row level security;

-- RLS Policies
create policy "Public profiles are viewable by everyone."
  on public.profiles for select
  using ( true );

create policy "Users can update their own profile."
  on public.profiles for update
  to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- Function to handle auto-updating the updated_at timestamp and enforcing field restrictions
create or replace function public.handle_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Enforce restrictions only for requests coming from the client API (authenticated role)
  if auth.role() = 'authenticated' then
    if new.username is distinct from old.username then
      raise exception 'Updating username is not allowed via client API.';
    end if;

    if new.admin_rank is distinct from old.admin_rank then
      raise exception 'Updating admin_rank is not allowed via client API.';
    end if;
  end if;

  -- Always update the updated_at timestamp on any modifications
  new.updated_at = now();
  return new;
end;
$$;

-- Trigger to execute the update function before any update
create or replace trigger update_profiles_before_modify
  before update on public.profiles
  for each row
  execute function public.handle_profile_update();

-- Function to handle creating a new profile upon user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, admin_rank, status)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'username',
      'user_' || pg_catalog.substr(new.id::text, 1, 8)
    ),
    coalesce(
      (new.raw_user_meta_data->>'admin_rank')::integer,
      0
    ),
    new.raw_user_meta_data->>'status' -- defaults to NULL if not provided
  );
  return new;
end;
$$;

-- Trigger to execute the new user function after auth.users insert
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Function to handle cleaning up a profile when a user is deleted
create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

-- Trigger to execute the deleted user function after auth.users delete
create or replace trigger on_auth_user_deleted
  after delete on auth.users
  for each row
  execute function public.handle_deleted_user();

-- Grant permissions for roles
grant select on public.profiles to anon;
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
