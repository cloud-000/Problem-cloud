-- Create a table for public profiles
create table public.profiles (
  -- "on delete cascade" automatically deletes the profile when the user is deleted.
  id uuid references auth.users(id) on delete cascade not null primary key,
  username text unique,
  status text,
  admin_rank integer not null default 0,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  last_active_at timestamp with time zone default now() not null,
  -- Up to 3 contest series (series.id) the user is currently focused on;
  -- drives the home page's per-series stats/worklist. Self-updatable.
  focused_series bigint[] not null default '{}'::bigint[],

  -- Username length constraint
  constraint username_length check (char_length(username) >= 3),
  constraint focused_series_max_three check (cardinality(focused_series) <= 3)
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
    if new.username is distinct from old.username
       and pg_catalog.current_setting('app.claiming_profile_username', true) is distinct from 'true' then
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
    new.raw_user_meta_data->>'username',
    coalesce(
      (new.raw_user_meta_data->>'admin_rank')::integer,
      0
    ),
    new.raw_user_meta_data->>'status' -- defaults to NULL if not provided
  );
  -- Every user has exactly one always-present "root" practice session (the
  -- "practice freely" grouping). Empty settings are fine — the app merges them
  -- over its client-side defaults. See practice_sessions.sql (is_root).
  insert into public.practice_sessions (user_id, is_root, settings)
  values (new.id, true, '{}'::jsonb);
  return new;
end;
$$;

-- Trigger to execute the new user function after auth.users insert
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row
execute function public.handle_new_user();

-- OAuth creates auth.users before the browser returns from the provider. The
-- callback therefore claims a username afterwards through this narrow RPC,
-- rather than exposing general username updates through the profiles table.
create or replace function public.claim_profile_username(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := pg_catalog.btrim(p_username);
  v_claimed text;
begin
  if auth.uid() is null then
    raise exception 'USERNAME_AUTH_REQUIRED';
  end if;

  if v_username is null or pg_catalog.char_length(v_username) < 3 then
    raise exception 'USERNAME_INVALID';
  end if;

  perform pg_catalog.set_config('app.claiming_profile_username', 'true', true);

  begin
    update public.profiles
      set username = v_username
      where id = auth.uid() and username is null
      returning username into v_claimed;
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN';
  end;

  if v_claimed is null then
    raise exception 'USERNAME_ALREADY_SET';
  end if;

  return v_claimed;
end;
$$;

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
grant execute on function public.claim_profile_username(text) to authenticated;
grant all on public.profiles to service_role;
