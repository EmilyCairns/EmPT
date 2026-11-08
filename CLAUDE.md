# Notes for AI assistants working on EmPT

- Before changing anything visual, read `DESIGN.md` and follow it. It is the owner's design system.
- All colours, font sizes, spacing, radii, shadows and widths come from `design-tokens.css`. Never put raw values in `styles.css` or inline styles in `app.js`; add a token instead.
- After a visual change, check `styleguide.html` and the app at phone (390px) and desktop widths (the app is light theme only).
- Database access rules live in `supabase/schema.sql`. Clients must only ever see their own data.
