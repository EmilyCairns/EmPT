# Notes for AI assistants working on EmPT

- Before changing anything visual, read `DESIGN.md` and follow it. It is the owner's design system.
- All colours, font sizes, spacing, radii, shadows and widths come from `design-tokens.css`. Never put raw values in `styles.css` or inline styles in `app.js`; add a token instead.
- After a visual change, check `styleguide.html` and the app at phone (390px) and desktop widths (the app is light theme only).
- Database access rules live in `supabase/schema.sql`. Clients must only ever see their own data.
- When creating workouts for the trainer directly in Supabase, always insert them as drafts (`is_draft = true`, the column default) and never publish them unless the trainer asks. Read the client's `client_notes` first and plan around injuries and conditions. Also check `client_maxes` (rep maxes), recent `set_logs` (what they actually lifted) and `workout_feedback` (their comments and things like period, night shifts or poor sleep that affected sessions) to set sensible loads. Treat feedback as private health information: use it for planning, never quote it anywhere the client or others might see.
- Workout exercises are a JSON array of objects with string values: `{ name, exercise_id, sets, reps, pct, rm, load, rest, notes }`. Use names from the `exercises` library and set `exercise_id` to the matching id (add new exercises to the library first). For percentage loads set `pct` (e.g. "70") and `rm` (e.g. "1" for 1RM); leave both "" otherwise. The app shows the client the weight.
- Any database change made directly in Supabase must also be added to `supabase/schema.sql`, so the file always matches the live database.
