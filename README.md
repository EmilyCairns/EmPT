# EmPT

A small web app for personal training clients.

- **Clients** sign in with their email (no password), see the workouts you've written for them, tick workouts off as done, and chat with you.
- **You (the trainer)** add clients, write and edit workouts, and chat with each client. New messages show up live.

The pages are hosted free on **GitHub Pages**. Logins, workouts and messages are stored in a free **Supabase** project. Each client can only see their own data; the database enforces this, not just the app.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `app.js`, `styles.css` | The app itself |
| `DESIGN.md`, `design-tokens.css` | **The design system.** Rules and values for how the app looks. Edit these to restyle it. |
| `styleguide.html` | Live preview of the design system |
| `config.js` | Your Supabase details and display names. **The only file you need to edit for setup.** |
| `supabase/schema.sql` | Sets up the database. Paste it into Supabase once. |
| `manifest.webmanifest`, `icon.svg` | Lets clients "Add to Home Screen" on their phone |

## One-time setup (about 15 minutes)

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project (the free plan is fine). Pick a region near you.
2. Open **SQL Editor → New query**. Paste in all of `supabase/schema.sql`.
3. Near the bottom, change `you@example.com` to **the email you'll sign in with**. Then click **Run**.

### 2. Point the app at your project

1. In Supabase, open **Project Settings → API** (on newer projects, **API Keys**). Copy the **Project URL** and the **anon / publishable key**. Never use the `service_role` or secret key.
2. Edit `config.js` in this repo and paste them in. You can also change `TRAINER_NAME` here. These values are safe to make public.

### 3. Turn on GitHub Pages

1. Merge this work into the `main` branch.
2. In GitHub, open **Settings → Pages**. Under **Source**, choose **Deploy from a branch**, then branch `main`, folder `/ (root)`, and click **Save**.
3. After a minute or two the app is live at `https://emilycairns.github.io/EmPT/`.

GitHub Pages on a free account needs the repository to be public. That's fine: the code holds no private data. Your clients' data lives in Supabase.

### 4. Tell Supabase where the app lives

In Supabase, open **Authentication → URL Configuration**:

- **Site URL:** `https://emilycairns.github.io/EmPT/`
- **Redirect URLs:** add `https://emilycairns.github.io/EmPT/**`

Sign-in links won't work without this.

### 5. Set up sign-in emails (strongly recommended)

Supabase's built-in email sender only allows a few sign-in emails per hour. That's enough for testing but not for real clients. Under **Authentication → Emails → SMTP Settings**, connect a free email service such as Resend, Brevo or Postmark. In the same area you can also reword the "Magic Link" email so it sounds like you.

## Everyday use

1. Open the app and sign in with your trainer email.
2. **+ New client** after a first consult: enter their name. Email is optional at this point.
3. On the **Consult notes** tab, jot quick private notes: injuries and conditions, goals in their words, training history, anything else. **Only you can see these**; the database blocks clients from them entirely. Notes save as you type, and **Copy notes** puts a tidy summary on your clipboard to paste into a chat with Claude.
4. In **Their goals** on the same tab, write the friendly version the client will see on their page.
5. When you're ready to give them access, click **Add email**. That creates their account. Send the client the app link. They type their email, tap the link they receive, and they're in. On their phone they can use "Add to Home Screen" to install it like an app.
6. Choose a client and create workouts with **+ New workout**. Each workout has a title, a date, notes and a list of exercises (sets, reps, load, rest, coaching notes). Use **Duplicate** to reuse a session.
7. The **Chat** tab is a private conversation with that client. A terracotta dot next to a client means they've sent a message you haven't opened yet.

Only emails you've added as clients can create an account. Anyone else is turned away.

## Applying app updates to the database

Some updates (like the consult notes) need a database change. When that happens, open `supabase/schema.sql` from this repo, paste the whole file into Supabase's **SQL Editor** again and click **Run**. This is safe to repeat: it keeps all your data, and you can leave `you@example.com` as it is, because your trainer email is already saved.

## Trying it locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. To sign in locally, also add `http://localhost:8000/**` to the Supabase redirect URLs.
