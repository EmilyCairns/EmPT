-- =====================================================================
-- EmPT database setup
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again later (e.g. after pulling an update).
--
-- FIRST TIME ONLY: change 'you@example.com' near the bottom (section 7)
-- to the email address YOU (the trainer) will sign in with.
-- When re-running to apply an update, you can leave it as it is.
-- =====================================================================

-- 1. Tables ------------------------------------------------------------

-- Who counts as a trainer. Only editable from the Supabase dashboard.
create table if not exists public.trainers (
  email text primary key
);

-- Your clients. A client signs in with the email stored here.
-- Email is optional: you can create a client at their first consult and
-- add the email later, which is what lets them sign in.
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  email      text,
  full_name  text not null check (char_length(full_name) between 1 and 100),
  goals      text not null default '',
  created_at timestamptz not null default now()
);
alter table public.clients alter column email drop not null;  -- for databases created before this change
create unique index if not exists clients_email_key on public.clients (lower(email));

-- PRIVATE consult notes. Only the trainer can ever read or write these;
-- clients have no access at all (see section 4).
create table if not exists public.client_notes (
  client_id    uuid primary key references public.clients (id) on delete cascade,
  consult_date date,
  injuries     text not null default '',  -- injuries, conditions, medication
  goals        text not null default '',  -- goals in the client's own words
  lifestyle    text not null default '',  -- training history, job, availability
  other        text not null default '',
  updated_at   timestamptz not null default now()
);

-- Workouts. "exercises" is a list of
-- { name, sets, reps, load, rest, notes } objects.
create table if not exists public.workouts (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  workout_date date,
  notes        text not null default '',
  exercises    jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists workouts_client_date_idx on public.workouts (client_id, workout_date);

-- Chat messages between you and each client.
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references public.clients (id) on delete cascade,
  sender     text not null check (sender in ('trainer', 'client')),
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_client_created_idx on public.messages (client_id, created_at);

-- 2. Helper functions -------------------------------------------------

-- Is the signed-in user the trainer?
create or replace function public.is_trainer()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trainers t
    where lower(t.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- The client record belonging to the signed-in user (null if none).
create or replace function public.my_client_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.id from public.clients c
  where lower(c.email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Lets a client (or the trainer) tick a workout off as done / not done,
-- without giving clients permission to edit anything else.
create or replace function public.set_workout_completed(p_workout_id uuid, p_done boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.workouts
     set completed_at = case when p_done then now() else null end
   where id = p_workout_id
     and (public.is_trainer() or client_id = public.my_client_id());
  if not found then
    raise exception 'Workout not found';
  end if;
end;
$$;

-- Keep workouts.updated_at current.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workouts_touch_updated_at on public.workouts;
create trigger workouts_touch_updated_at
  before update on public.workouts
  for each row execute function public.touch_updated_at();

drop trigger if exists client_notes_touch_updated_at on public.client_notes;
create trigger client_notes_touch_updated_at
  before update on public.client_notes
  for each row execute function public.touch_updated_at();

-- 3. Invite-only sign-up ----------------------------------------------
-- Only the trainer and clients you've added can create an account.
create or replace function public.only_invited_signups()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.trainers where lower(email) = lower(new.email))
     and not exists (select 1 from public.clients where lower(email) = lower(new.email)) then
    raise exception 'This email has not been invited to EmPT';
  end if;
  return new;
end;
$$;

drop trigger if exists only_invited_signups on auth.users;
create trigger only_invited_signups
  before insert on auth.users
  for each row execute function public.only_invited_signups();

-- 4. Row level security -----------------------------------------------
-- Clients only ever see their own data. The trainer sees everything.
alter table public.trainers enable row level security;
alter table public.clients  enable row level security;
alter table public.workouts enable row level security;
alter table public.messages enable row level security;
alter table public.client_notes enable row level security;

drop policy if exists "client_notes: trainer only" on public.client_notes;
create policy "client_notes: trainer only" on public.client_notes
  for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());

drop policy if exists "clients: read own or trainer" on public.clients;
create policy "clients: read own or trainer" on public.clients
  for select to authenticated
  using (public.is_trainer() or id = public.my_client_id());

drop policy if exists "clients: trainer writes" on public.clients;
create policy "clients: trainer writes" on public.clients
  for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());

drop policy if exists "workouts: read own or trainer" on public.workouts;
create policy "workouts: read own or trainer" on public.workouts
  for select to authenticated
  using (public.is_trainer() or client_id = public.my_client_id());

drop policy if exists "workouts: trainer writes" on public.workouts;
create policy "workouts: trainer writes" on public.workouts
  for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());

drop policy if exists "messages: read own or trainer" on public.messages;
create policy "messages: read own or trainer" on public.messages
  for select to authenticated
  using (public.is_trainer() or client_id = public.my_client_id());

drop policy if exists "messages: send as yourself" on public.messages;
create policy "messages: send as yourself" on public.messages
  for insert to authenticated
  with check (
    (sender = 'trainer' and public.is_trainer())
    or (sender = 'client' and client_id = public.my_client_id())
  );

-- 5. Permissions ------------------------------------------------------
revoke all on public.trainers, public.clients, public.workouts, public.messages, public.client_notes from anon, authenticated;
grant select, insert, update, delete on public.clients, public.workouts, public.client_notes to authenticated;
grant select, insert on public.messages to authenticated;

revoke execute on function public.set_workout_completed(uuid, boolean) from public, anon;
grant execute on function public.set_workout_completed(uuid, boolean) to authenticated;
grant execute on function public.is_trainer(), public.my_client_id() to authenticated;

-- 6. Live chat ----------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- 7. Make yourself the trainer -------------------------------------------
-- FIRST TIME: change you@example.com to the email you will sign in with.
-- Re-running with the placeholder left in is safe: it is skipped.
do $$
declare
  trainer_email text := 'you@example.com';
begin
  if lower(trainer_email) = 'you@example.com' then
    raise notice 'Trainer email left as the placeholder, so no trainer was added.';
  else
    insert into public.trainers (email) values (lower(trainer_email)) on conflict do nothing;
  end if;
end;
$$;
