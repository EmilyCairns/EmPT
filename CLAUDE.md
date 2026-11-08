# Notes for AI assistants working on EmPT

- Before changing anything visual, read `DESIGN.md` and follow it. It is the owner's design system.
- All colours, font sizes, spacing, radii, shadows and widths come from `design-tokens.css`. Never put raw values in `styles.css` or inline styles in `app.js`; add a token instead.
- After a visual change, check `styleguide.html` and the app at phone (390px) and desktop widths (the app is light theme only).
- Database access rules live in `supabase/schema.sql`. Clients must only ever see their own data.
- When creating workouts for the trainer directly in Supabase, always insert them as drafts (`is_draft = true`, the column default) and never publish them unless the trainer asks. Read the client's `client_notes` first and plan around injuries and conditions. Exercises are a JSON array of `{ name, sets, reps, load, rest, notes }` strings.
- Any database change made directly in Supabase must also be added to `supabase/schema.sql`, so the file always matches the live database.
