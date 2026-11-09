-- =====================================================================
-- EmPT test client
-- Creates (or resets) a pretend client so the trainer can sign in and see
-- the app exactly as a client does. Run in Supabase: SQL Editor -> Run.
-- Needs the full schema.sql to have been run first.
--
-- Sign in as the client with:  emilycairnsfitness+test@gmail.com
-- (Gmail delivers "+test" emails to the normal inbox.)
--
-- Running it again wipes the test client's data and starts fresh. It only
-- ever touches the client with this email address.
-- =====================================================================

do $$
declare
  test_email constant text := 'emilycairnsfitness+test@gmail.com';
  tz constant text := 'Europe/London';
  c uuid;
  ex_squat uuid; ex_rdl uuid; ex_press uuid; ex_row uuid; ex_plank uuid; ex_lunge uuid;
  w_done uuid;
  next_mon date := current_date + (8 - extract(isodow from current_date)::int);  -- the coming Monday (1-7 days ahead)
begin
  -- Start fresh: deleting the client removes their workouts, notes, maxes,
  -- logs, feedback, messages and sessions too.
  delete from public.clients where lower(email) = test_email;
  if to_regclass('public.announcements') is not null then
    execute $q$delete from public.announcements where title = 'Welcome to EmPT (test)'$q$;
  end if;

  insert into public.clients (full_name, email, goals)
  values ('Test Client', test_email,
          'Get stronger and fitter for a 10k in spring, with a happy, pain-free knee.')
  returning id into c;

  insert into public.client_notes (client_id, consult_date, injuries, goals, lifestyle, other)
  values (c, current_date - 14,
          'TEST DATA. Old R knee niggle, fine with squats to parallel. Avoid deep lunges for now.',
          'wants to run 10k in spring, get stronger, feel less stiff at desk',
          'Desk job. Ran at uni. Free Mon/Wed eves + Sat am.',
          'Prefers mornings at weekends.');

  -- Exercise library (kept if they already exist).
  insert into public.exercises (name, cues) values
    ('Back squat', 'Brace before you go down. Sit between the hips, knees track over toes. Drive up through the whole foot.'),
    ('Romanian deadlift', 'Soft knees. Push the hips back, bar stays close to the legs. Stop when the hamstrings are tight.'),
    ('Dumbbell bench press', 'Shoulder blades back and down. Lower with control to chest level.'),
    ('Single-arm dumbbell row', 'Flat back. Pull the elbow towards the hip, pause at the top.'),
    ('Plank', 'Squeeze glutes, ribs down, breathe.'),
    ('Reverse lunge', 'Step back, front knee over the ankle, push through the front heel.')
  on conflict do nothing;
  select id into ex_squat from public.exercises where lower(name) = 'back squat';
  select id into ex_rdl from public.exercises where lower(name) = 'romanian deadlift';
  select id into ex_press from public.exercises where lower(name) = 'dumbbell bench press';
  select id into ex_row from public.exercises where lower(name) = 'single-arm dumbbell row';
  select id into ex_plank from public.exercises where lower(name) = 'plank';
  select id into ex_lunge from public.exercises where lower(name) = 'reverse lunge';

  -- Rep maxes: a tested 5RM squat (so 1RM is estimated) and an 8RM RDL.
  insert into public.client_maxes (client_id, exercise_id, reps, weight_kg, tested_on, source) values
    (c, ex_squat, 5, 60, current_date - 10, 'trainer'),
    (c, ex_rdl, 8, 50, current_date - 10, 'trainer');

  -- A finished workout from last week, with logged sets and feedback.
  insert into public.workouts (client_id, title, workout_date, notes, exercises, is_draft, completed_at)
  values (c, 'Full body A', current_date - 6, '5 min easy bike to warm up.',
    jsonb_build_array(
      jsonb_build_object('name', 'Back squat', 'exercise_id', ex_squat::text, 'sets', '3', 'reps', '8', 'pct', '65', 'rm', '1', 'load', '', 'rest', '90s', 'notes', ''),
      jsonb_build_object('name', 'Dumbbell bench press', 'exercise_id', ex_press::text, 'sets', '3', 'reps', '10', 'pct', '', 'rm', '', 'load', '12 kg dumbbells', 'rest', '60s', 'notes', ''),
      jsonb_build_object('name', 'Plank', 'exercise_id', ex_plank::text, 'sets', '3', 'reps', '30s', 'pct', '', 'rm', '', 'load', '', 'rest', '30s', 'notes', '')),
    false, now() - interval '6 days')
  returning id into w_done;

  insert into public.set_logs (client_id, workout_id, exercise_index, exercise_id, exercise_name, set_number, weight_kg, reps, rpe) values
    (c, w_done, 0, ex_squat, 'Back squat', 1, 45, 8, 6),
    (c, w_done, 0, ex_squat, 'Back squat', 2, 45, 8, 7),
    (c, w_done, 0, ex_squat, 'Back squat', 3, 45, 8, 7.5),
    (c, w_done, 1, ex_press, 'Dumbbell bench press', 1, 12, 10, 7),
    (c, w_done, 1, ex_press, 'Dumbbell bench press', 2, 12, 9, 8),
    (c, w_done, 2, ex_plank, 'Plank', 1, null, 30, null);

  insert into public.workout_feedback (workout_id, client_id, comment, factors, factors_note)
  values (w_done, c, 'Felt good! Squats were easier than expected.', array['poor_sleep'], 'Late night before.');

  -- Two upcoming published workouts, using % of max loads.
  insert into public.workouts (client_id, title, workout_date, notes, exercises, is_draft) values
  (c, 'Lower body strength', next_mon, 'Warm up: 5 min bike, then 2 light sets of squats.',
    jsonb_build_array(
      jsonb_build_object('name', 'Back squat', 'exercise_id', ex_squat::text, 'sets', '4', 'reps', '6', 'pct', '75', 'rm', '1', 'load', '', 'rest', '2 min', 'notes', 'Slow on the way down.'),
      jsonb_build_object('name', 'Romanian deadlift', 'exercise_id', ex_rdl::text, 'sets', '3', 'reps', '8', 'pct', '90', 'rm', '8', 'load', '', 'rest', '90s', 'notes', ''),
      jsonb_build_object('name', 'Reverse lunge', 'exercise_id', ex_lunge::text, 'sets', '3', 'reps', '8 each leg', 'pct', '', 'rm', '', 'load', 'Bodyweight', 'rest', '60s', 'notes', 'Shallow range, knee comfortable.')),
    false),
  (c, 'Upper body + core', next_mon + 2, '',
    jsonb_build_array(
      jsonb_build_object('name', 'Dumbbell bench press', 'exercise_id', ex_press::text, 'sets', '3', 'reps', '10', 'pct', '', 'rm', '', 'load', '14 kg dumbbells', 'rest', '60s', 'notes', ''),
      jsonb_build_object('name', 'Single-arm dumbbell row', 'exercise_id', ex_row::text, 'sets', '3', 'reps', '10 each side', 'pct', '', 'rm', '', 'load', '16 kg', 'rest', '60s', 'notes', ''),
      jsonb_build_object('name', 'Plank', 'exercise_id', ex_plank::text, 'sets', '3', 'reps', '40s', 'pct', '', 'rm', '', 'load', '', 'rest', '30s', 'notes', '')),
    false);

  -- A draft the client must NOT be able to see.
  insert into public.workouts (client_id, title, workout_date, exercises, is_draft)
  values (c, 'DRAFT: hidden from client', next_mon + 5, '[]'::jsonb, true);

  -- A welcome message in the chat.
  insert into public.messages (client_id, sender, body)
  values (c, 'trainer', 'Hi! This is a test account so you can see the client side of EmPT.');

  -- Sessions (only if that part of the database is set up).
  if to_regclass('public.sessions') is not null then
    execute format($q$
      insert into public.sessions (client_id, starts_at, duration_min, location, notes) values
        -- Today at 6pm (or, if that's under an hour away, in about 20 hours).
        (%1$L, case when (current_date + time '18:00') at time zone %2$L > now() + interval '1 hour'
                    then (current_date + time '18:00') at time zone %2$L
                    else date_trunc('hour', now() + interval '20 hours') end,
         60, 'Studio', 'Less than 24 hours away, to show the late-cancellation reminder.'),
        (%1$L, (%3$L::date + time '18:00') at time zone %2$L, 60, 'Studio', 'Bring trainers and water.'),
        (%1$L, ((%3$L::date + 5) + time '09:00') at time zone %2$L, 45, 'Park', 'Outdoor conditioning.'),
        (%1$L, ((%3$L::date + 7) + time '18:00') at time zone %2$L, 60, 'Studio', '')
    $q$, c, tz, next_mon);
  end if;

  -- A pinned notice only the test client can see.
  if to_regclass('public.announcements') is not null then
    execute format($q$
      insert into public.announcements (title, body, pinned, client_ids)
      values ('Welcome to EmPT (test)', 'This post is only visible to the test client.', true, array[%L::uuid])
    $q$, c);
  end if;
end;
$$;
