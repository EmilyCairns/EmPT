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
-- How the client pays (private to the trainer, like the rest of this table).
alter table public.client_notes add column if not exists payment_method text
  check (payment_method in ('ezidebit', 'stripe', 'transfer', 'other'));

-- Workouts. "exercises" is a list of objects with string values:
-- { name, exercise_id, sets, reps, pct, rm, load, rest, notes }
-- exercise_id links to the library ('' if none). pct + rm mean
-- "pct% of the client's rm-rep max", e.g. pct '70', rm '1' = 70% of 1RM.
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

-- Drafts: hidden from the client until the trainer publishes them.
-- Workouts that existed before this column was added stay published;
-- every NEW workout starts as a draft unless it is saved as published.
alter table public.workouts add column if not exists is_draft boolean not null default false;
alter table public.workouts alter column is_draft set default true;

-- Programs: a block of the same workouts every week (only loads change).
-- The trainer writes one workout per training day (templates), then sends
-- it to the client, who picks their training days and a start date;
-- schedule_program() then creates the dated workouts.
--   status: 'draft' (only the trainer sees it), 'offered' (waiting for the
--   client to pick days), 'scheduled' (on the calendar).
--   templates: [{ title, notes, exercises }], one per training day.
--   training_days: ISO weekdays, 1 = Monday … 7 = Sunday.
create table if not exists public.programs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 120),
  notes         text not null default '' check (char_length(notes) <= 2000),
  weeks         int not null default 4 check (weeks between 1 and 26),
  days_per_week int not null default 3 check (days_per_week between 1 and 7),
  templates     jsonb not null default '[]'::jsonb,
  status        text not null default 'draft' check (status in ('draft', 'offered', 'scheduled')),
  training_days int[],
  start_date    date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists programs_client_idx on public.programs (client_id);

-- Which program (and week of it) a workout came from, and the day it was
-- first planned for: clients can move a workout up to 14 days either side.
alter table public.workouts add column if not exists program_id uuid references public.programs (id) on delete set null;
alter table public.workouts add column if not exists program_week int;
alter table public.workouts add column if not exists planned_date date;

-- Exercise library: one row per exercise, with an optional demo video
-- link and coaching cues. Clients can read it; only the trainer edits it.
create table if not exists public.exercises (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 100),
  video_url  text not null default '',
  cues       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists exercises_name_key on public.exercises (lower(name));
-- Barbell exercises show clients a plate calculator. null = decide from the
-- exercise name (the app recognises squats, deadlifts, bench press etc.).
alter table public.exercises add column if not exists is_barbell boolean;

-- Rep maxes (1RM, 3RM, 5RM…) per client and exercise. Each test is a new
-- row, so history is kept; the latest one for a rep count is "current".
-- source: 'trainer' (entered by the trainer), 'client' (entered by the
-- client) or 'logged' (a new best spotted in a logged workout).
create table if not exists public.client_maxes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  reps        int not null check (reps between 1 and 20),
  weight_kg   numeric(6, 2) not null check (weight_kg > 0 and weight_kg < 1000),
  tested_on   date not null default current_date,
  source      text not null default 'trainer' check (source in ('trainer', 'client', 'logged')),
  created_at  timestamptz not null default now()
);
create index if not exists client_maxes_lookup_idx on public.client_maxes (client_id, exercise_id, reps, tested_on);

-- Chat messages between you and each client.
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references public.clients (id) on delete cascade,
  sender     text not null check (sender in ('trainer', 'client')),
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_client_created_idx on public.messages (client_id, created_at);

-- What the client actually did: one row per logged set.
-- exercise_index is the exercise's position in the workout.
create table if not exists public.set_logs (
  id             bigint generated always as identity primary key,
  client_id      uuid not null references public.clients (id) on delete cascade,
  workout_id     uuid not null references public.workouts (id) on delete cascade,
  exercise_index int not null check (exercise_index >= 0),
  exercise_id    uuid references public.exercises (id) on delete set null,
  exercise_name  text not null,
  set_number     int not null check (set_number between 1 and 50),
  weight_kg      numeric(6, 2) check (weight_kg >= 0 and weight_kg < 1000),
  reps           int check (reps between 0 and 1000),
  rpe            numeric(3, 1) check (rpe between 1 and 10),
  created_at     timestamptz not null default now()
);
create index if not exists set_logs_client_idx on public.set_logs (client_id, created_at);
create index if not exists set_logs_workout_idx on public.set_logs (workout_id);

-- The client's comments and "how were you feeling?" check-in for a
-- workout. Only that client and the trainer can see it.
-- factors holds short keys such as 'period', 'night_shift', 'tired'
-- (the app turns them into labels).
create table if not exists public.workout_feedback (
  workout_id   uuid primary key references public.workouts (id) on delete cascade,
  client_id    uuid not null references public.clients (id) on delete cascade,
  comment      text not null default '' check (char_length(comment) <= 4000),
  factors      text[] not null default '{}' check (coalesce(array_length(factors, 1), 0) <= 20),
  factors_note text not null default '' check (char_length(factors_note) <= 1000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists workout_feedback_client_idx on public.workout_feedback (client_id);

-- Notice board posts from the trainer. client_ids is null for "everyone",
-- otherwise the post is only shown to the clients listed.
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 120),
  body       text not null default '' check (char_length(body) <= 5000),
  pinned     boolean not null default false,
  client_ids uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_created_idx on public.announcements (created_at desc);

-- Booked training sessions. The trainer books, edits and deletes them;
-- clients can see their own and cancel them (only through
-- cancel_session(), below, which also notifies the other person in chat).
create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  starts_at     timestamptz not null,
  duration_min  int not null default 60 check (duration_min between 5 and 600),
  location      text not null default '' check (char_length(location) <= 200),
  notes         text not null default '' check (char_length(notes) <= 2000),
  status        text not null default 'booked' check (status in ('booked', 'cancelled')),
  cancelled_at  timestamptz,
  cancelled_by  text check (cancelled_by in ('client', 'trainer')),
  cancel_reason text not null default '' check (char_length(cancel_reason) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sessions_client_start_idx on public.sessions (client_id, starts_at);
create index if not exists sessions_start_idx on public.sessions (starts_at);

-- Rest weeks: weeks the trainer marks as a holiday, illness or deload week.
-- They pause a client's streak instead of breaking it. week_start is a Monday.
create table if not exists public.excused_weeks (
  client_id  uuid not null references public.clients (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  created_at timestamptz not null default now(),
  primary key (client_id, week_start)
);

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
     and (public.is_trainer() or (client_id = public.my_client_id() and not is_draft));
  if not found then
    raise exception 'Workout not found';
  end if;
end;
$$;

-- Cancels a session. Clients can cancel their own upcoming sessions; the
-- trainer can cancel any. A chat message is posted so the other person is
-- notified (it appears as a new message). p_label is the session's date and
-- time as shown on the canceller's screen, so it reads in their time zone.
create or replace function public.cancel_session(p_session_id uuid, p_reason text default '', p_label text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.sessions;
  by_trainer boolean := public.is_trainer();
  reason text := left(btrim(coalesce(p_reason, '')), 500);
  label text := left(btrim(coalesce(p_label, '')), 80);
begin
  select * into s from public.sessions where id = p_session_id for update;
  if not found or (not by_trainer and s.client_id is distinct from public.my_client_id()) then
    raise exception 'Session not found';
  end if;
  if s.status <> 'booked' then
    raise exception 'This session is already cancelled';
  end if;
  if not by_trainer and s.starts_at < now() then
    raise exception 'This session has already started, so it can''t be cancelled here. Send a message instead.';
  end if;
  if label = '' then
    label := to_char(s.starts_at, 'YYYY-MM-DD HH24:MI UTC');
  end if;

  update public.sessions
     set status = 'cancelled', cancelled_at = now(),
         cancelled_by = case when by_trainer then 'trainer' else 'client' end,
         cancel_reason = reason
   where id = p_session_id;

  insert into public.messages (client_id, sender, body)
  values (
    s.client_id,
    case when by_trainer then 'trainer' else 'client' end,
    case when by_trainer then 'Session cancelled: ' || label else 'I''ve cancelled my session on ' || label end
      || case when reason <> '' then E'\nReason: ' || reason else '' end
  );
end;
$$;

-- Puts a program on the calendar: one workout per picked weekday, from the
-- start date, in order (A, B, C, A, B, C, …) until every week is filled.
-- The client (for their own offered program) or the trainer can call it.
create or replace function public.schedule_program(p_program_id uuid, p_days int[], p_start date)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  pr public.programs;
  by_trainer boolean := public.is_trainer();
  days int[];
  d date;
  i int := 0;
  total int;
  t jsonb;
begin
  select * into pr from public.programs where id = p_program_id for update;
  if not found or (not by_trainer and (pr.client_id is distinct from public.my_client_id() or pr.status = 'draft')) then
    raise exception 'Program not found';
  end if;
  if pr.status = 'scheduled' then
    raise exception 'This program is already on the calendar';
  end if;
  select array_agg(x order by x) into days from (select distinct unnest(p_days) as x) s where x between 1 and 7;
  if coalesce(array_length(days, 1), 0) <> pr.days_per_week then
    raise exception 'Pick exactly % days', pr.days_per_week;
  end if;
  if jsonb_array_length(pr.templates) <> pr.days_per_week then
    raise exception 'This program isn''t finished yet';
  end if;
  if p_start is null or p_start < current_date - 1 or p_start > current_date + 90 then
    raise exception 'Choose a start date from today onwards';
  end if;

  total := pr.weeks * pr.days_per_week;
  d := p_start;
  while i < total loop
    if extract(isodow from d)::int = any (days) then
      t := pr.templates -> (i % pr.days_per_week);
      insert into public.workouts (client_id, title, workout_date, planned_date, notes, exercises, is_draft, program_id, program_week)
      values (pr.client_id, coalesce(nullif(t ->> 'title', ''), 'Workout'), d, d, coalesce(t ->> 'notes', ''),
              coalesce(t -> 'exercises', '[]'::jsonb), false, pr.id, i / pr.days_per_week + 1);
      i := i + 1;
    end if;
    d := d + 1;
  end loop;

  update public.programs set status = 'scheduled', training_days = days, start_date = p_start where id = pr.id;
  return total;
end;
$$;

-- Moves a workout to another day. Clients can move their own published,
-- unfinished workouts up to 14 days either side of the day first planned,
-- and not into the past. The trainer can move any workout anywhere.
create or replace function public.move_workout(p_workout_id uuid, p_date date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w public.workouts;
  by_trainer boolean := public.is_trainer();
  anchor date;
begin
  select * into w from public.workouts where id = p_workout_id for update;
  if not found or (not by_trainer and (w.client_id is distinct from public.my_client_id() or w.is_draft)) then
    raise exception 'Workout not found';
  end if;
  if p_date is null then
    raise exception 'Choose a day';
  end if;
  if not by_trainer then
    if w.completed_at is not null then
      raise exception 'This workout is already done';
    end if;
    anchor := coalesce(w.planned_date, w.workout_date, p_date);
    if p_date < anchor - 14 or p_date > anchor + 14 then
      raise exception 'Workouts can be moved up to 2 weeks either side of their planned day';
    end if;
    if p_date < current_date - 1 then
      raise exception 'Choose a day from today onwards';
    end if;
  end if;
  update public.workouts
     set workout_date = p_date,
         planned_date = coalesce(planned_date, workout_date, p_date)
   where id = p_workout_id;
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

drop trigger if exists exercises_touch_updated_at on public.exercises;
create trigger exercises_touch_updated_at
  before update on public.exercises
  for each row execute function public.touch_updated_at();

drop trigger if exists workout_feedback_touch_updated_at on public.workout_feedback;
create trigger workout_feedback_touch_updated_at
  before update on public.workout_feedback
  for each row execute function public.touch_updated_at();

drop trigger if exists announcements_touch_updated_at on public.announcements;
create trigger announcements_touch_updated_at
  before update on public.announcements
  for each row execute function public.touch_updated_at();

drop trigger if exists sessions_touch_updated_at on public.sessions;
create trigger sessions_touch_updated_at
  before update on public.sessions
  for each row execute function public.touch_updated_at();

drop trigger if exists programs_touch_updated_at on public.programs;
create trigger programs_touch_updated_at
  before update on public.programs
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
alter table public.exercises enable row level security;
alter table public.client_maxes enable row level security;
alter table public.set_logs enable row level security;
alter table public.workout_feedback enable row level security;
alter table public.announcements enable row level security;
alter table public.sessions enable row level security;
alter table public.programs enable row level security;
alter table public.excused_weeks enable row level security;

-- Rest weeks: the client sees their own; only the trainer writes.
drop policy if exists "excused_weeks: read own or trainer" on public.excused_weeks;
create policy "excused_weeks: read own or trainer" on public.excused_weeks
  for select to authenticated
  using (public.is_trainer() or client_id = public.my_client_id());
drop policy if exists "excused_weeks: trainer writes" on public.excused_weeks;
create policy "excused_weeks: trainer writes" on public.excused_weeks
  for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());

-- Programs: the client sees their own once it's been sent to them; only the
-- trainer writes (clients schedule through schedule_program()).
drop policy if exists "programs: read own or trainer" on public.programs;
create policy "programs: read own or trainer" on public.programs
  for select to authenticated
  using (public.is_trainer() or (client_id = public.my_client_id() and status <> 'draft'));
drop policy if exists "programs: trainer writes" on public.programs;
create policy "programs: trainer writes" on public.programs
  for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());

-- Sessions: clients see their own (and cancel through cancel_session());
-- only the trainer books, edits and deletes.
drop policy if exists "sessions: read own or trainer" on public.sessions;
create policy "sessions: read own or trainer" on public.sessions
  for select to authenticated
  using (public.is_trainer() or client_id = public.my_client_id());
drop policy if exists "sessions: trainer writes" on public.sessions;
create policy "sessions: trainer writes" on public.sessions
  for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());

-- Notice board: current clients read posts for everyone or addressed to
-- them (removed clients see nothing); only the trainer writes.
drop policy if exists "announcements: read" on public.announcements;
create policy "announcements: read" on public.announcements
  for select to authenticated
  using (public.is_trainer() or (public.my_client_id() is not null and (client_ids is null or public.my_client_id() = any (client_ids))));
drop policy if exists "announcements: trainer writes" on public.announcements;
create policy "announcements: trainer writes" on public.announcements
  for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());

-- Workout feedback: the client writes their own (for their own published
-- workouts); the trainer can read it all.
drop policy if exists "workout_feedback: read own or trainer" on public.workout_feedback;
create policy "workout_feedback: read own or trainer" on public.workout_feedback
  for select to authenticated
  using (public.is_trainer() or client_id = public.my_client_id());
drop policy if exists "workout_feedback: client adds" on public.workout_feedback;
create policy "workout_feedback: client adds" on public.workout_feedback
  for insert to authenticated
  with check (client_id = public.my_client_id() and exists (
    select 1 from public.workouts w
    where w.id = workout_id and w.client_id = public.my_client_id() and not w.is_draft));
drop policy if exists "workout_feedback: client edits" on public.workout_feedback;
create policy "workout_feedback: client edits" on public.workout_feedback
  for update to authenticated
  using (client_id = public.my_client_id())
  with check (client_id = public.my_client_id() and exists (
    select 1 from public.workouts w
    where w.id = workout_id and w.client_id = public.my_client_id() and not w.is_draft));
drop policy if exists "workout_feedback: remove" on public.workout_feedback;
create policy "workout_feedback: remove" on public.workout_feedback
  for delete to authenticated
  using (public.is_trainer() or client_id = public.my_client_id());

-- Exercise library: everyone signed in can read; only the trainer edits.
drop policy if exists "exercises: read" on public.exercises;
create policy "exercises: read" on public.exercises
  for select to authenticated using (true);
drop policy if exists "exercises: trainer writes" on public.exercises;
create policy "exercises: trainer writes" on public.exercises
  for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());

-- Rep maxes: clients see and add their own; they can remove the ones they
-- added (or that were logged), but not ones the trainer entered.
drop policy if exists "client_maxes: read own or trainer" on public.client_maxes;
create policy "client_maxes: read own or trainer" on public.client_maxes
  for select to authenticated
  using (public.is_trainer() or client_id = public.my_client_id());
drop policy if exists "client_maxes: add" on public.client_maxes;
create policy "client_maxes: add" on public.client_maxes
  for insert to authenticated
  with check (public.is_trainer() or (client_id = public.my_client_id() and source in ('client', 'logged')));
drop policy if exists "client_maxes: trainer edits" on public.client_maxes;
create policy "client_maxes: trainer edits" on public.client_maxes
  for update to authenticated
  using (public.is_trainer()) with check (public.is_trainer());
drop policy if exists "client_maxes: remove" on public.client_maxes;
create policy "client_maxes: remove" on public.client_maxes
  for delete to authenticated
  using (public.is_trainer() or (client_id = public.my_client_id() and source <> 'trainer'));

-- Logged sets: clients log against their own published workouts only.
drop policy if exists "set_logs: read own or trainer" on public.set_logs;
create policy "set_logs: read own or trainer" on public.set_logs
  for select to authenticated
  using (public.is_trainer() or client_id = public.my_client_id());
drop policy if exists "set_logs: add" on public.set_logs;
create policy "set_logs: add" on public.set_logs
  for insert to authenticated
  with check (
    public.is_trainer()
    or (client_id = public.my_client_id() and exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.client_id = public.my_client_id() and not w.is_draft))
  );
drop policy if exists "set_logs: remove" on public.set_logs;
create policy "set_logs: remove" on public.set_logs
  for delete to authenticated
  using (public.is_trainer() or client_id = public.my_client_id());

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

-- Clients never see drafts.
drop policy if exists "workouts: read own or trainer" on public.workouts;
create policy "workouts: read own or trainer" on public.workouts
  for select to authenticated
  using (public.is_trainer() or (client_id = public.my_client_id() and not is_draft));

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
revoke all on public.trainers, public.clients, public.workouts, public.messages, public.client_notes,
  public.exercises, public.client_maxes, public.set_logs, public.workout_feedback, public.announcements,
  public.sessions, public.programs, public.excused_weeks from anon, authenticated;
grant select, insert, update, delete on public.clients, public.workouts, public.client_notes,
  public.exercises, public.client_maxes to authenticated;
grant select, insert, delete on public.set_logs to authenticated;
grant select, insert, update, delete on public.workout_feedback to authenticated;
grant select, insert, update, delete on public.announcements to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.programs to authenticated;
grant select, insert, delete on public.excused_weeks to authenticated;
grant select, insert on public.messages to authenticated;

revoke execute on function public.schedule_program(uuid, int[], date) from public, anon;
grant execute on function public.schedule_program(uuid, int[], date) to authenticated;
revoke execute on function public.move_workout(uuid, date) from public, anon;
grant execute on function public.move_workout(uuid, date) to authenticated;
revoke execute on function public.set_workout_completed(uuid, boolean) from public, anon;
revoke execute on function public.cancel_session(uuid, text, text) from public, anon;
grant execute on function public.cancel_session(uuid, text, text) to authenticated;
grant execute on function public.set_workout_completed(uuid, boolean) to authenticated;
-- Signed-out visitors need no helper functions. The sign-up guard is a
-- trigger function and is never called directly.
revoke execute on function public.is_trainer() from public, anon;
revoke execute on function public.my_client_id() from public, anon;
revoke execute on function public.only_invited_signups() from public, anon, authenticated;
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
