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
2. **+ New client** after a first consult: enter their name. Email is optional at this point. In **Edit client** you can also set **How they pay** (Ezidebit, Stripe in the app, bank transfer or other). Only you see it, in your client list and on their page.
3. On the **Consult notes** tab, jot quick private notes: injuries and conditions, goals in their words, training history, anything else. **Only you can see these**; the database blocks clients from them entirely. Notes save as you type, and **Copy notes** puts a tidy summary on your clipboard to paste into a chat with Claude.
4. In **Their goals** on the same tab, write the friendly version the client will see on their page.
5. When you're ready to give them access, click **Add email**. That creates their account. Send the client the app link. They type their email, tap the link they receive, and they're in. On their phone they can use "Add to Home Screen" to install it like an app.
   Clients land on **Home**: their goals, **Today** (today's workout with **Start workout →**, or a rest day with what's next and a nudge to catch up on anything missed that week, plus any session with you), **This week** (a progress ring and a dot per day), their next session, your latest notices, and **Consistency** (week streak, best streak and a 12-week chart). Their tabs are **Home · Calendar · Program · Lifts · Chat**; your notices are on Home with **See all**.
   **Program tab (clients):** their current program: a **From Emily** box with the program's aim (the note you write on the program), quick facts (week 2 of 4, workouts done, training days), then the workouts week by week, with the current week open and Start / Preview / View on each. Below: any **other workouts** outside a program, and **Past programs**, each opening to show how every week went.
6. Choose a client and create workouts with **+ New workout**. Each workout has a title, a date, notes and a list of exercises (sets, reps, load, rest, coaching notes). **Save as draft** keeps it hidden from the client until you click **Publish** (or **Publish all drafts**). **Unpublish** hides it again. Use **Duplicate** to reuse a session. You can also ask Claude to write workouts for you: they arrive as drafts for you to check.
   **Programs:** for a block of training, use **+ New program** instead: give it a name, a note, how many weeks and how many workouts a week, then **Write** each workout (A, B, C…) once. The client does the same workouts every week. **Send to [client]** puts a "New program" card on their Home page: they see an overview, tick exactly as many training days as the program needs, pick a start date, and **Add to my calendar** creates every workout, labelled Week 1, Week 2… To change the weights for a particular week, edit that week's workouts. For clients without an account, use **Choose days for them**.
   **Calendar (clients):** a list of weeks (Monday to Sunday) with each workout and session on its day. Clients can move a workout up to **2 weeks either side** of its planned day (not into the past): press and hold it and drag it to another day, drag it with a mouse, or tap **Move**. Tapping a session shows its details and lets them cancel it.
7. **Exercise library** (top of the sidebar): add a demo video link and coaching cues to each exercise. Clients see them under "How to". Any new exercise name you type in a workout is added to the library automatically.
8. **Percentages:** in the workout editor, fill in "% of max" and choose which rep max (for example 70% of 1RM). Each client sees their own weight worked out and rounded to 2.5 kg (change `ROUND_TO_KG` in `config.js`). If they only have, say, a 5RM, their 1RM is estimated from it.
9. **Lifts tab:** record each client's 1RM, 3RM, 5RM and so on. Clients can add their own too, in their **Lifts** tab.
10. **Start workout:** clients tap **Start workout** to open a page with just that day's workout. They enter weight and reps for each set, with the plan shown and last time's numbers under each set, and tap **✓** when a set is done: that fills in the plan if empty and starts the **rest timer**. Tapping an exercise's name shows their full history for that lift: heaviest set, best estimated 1RM, rep maxes and every set they've logged, by date. The timer sits at the top of the page. It starts with the exercise's rest when they tick a set, they can adjust it with − / +, and it beeps and vibrates when rest is over. The screen stays awake during the workout. At the end they can rate **how hard the whole workout was, 1–10** (optional; you see it as "Effort 7/10" on the workout card). **Barbell exercises** have a small **barbell button** on each set: tapping it opens the **plate calculator** for that set's weight, with a picture of the bar with the plates for each side, with a **20 kg / 15 kg bar** switch. Tick "Uses a barbell" on an exercise in the library to turn it on or off; obvious barbell lifts (squat, deadlift, bench press…) are recognised automatically. Set your gym's plates in `PLATES_KG` in `config.js`. Entries are kept on the phone until they press **Finish workout** (save and mark as done) or **Save for later**. You can still log for them with **Log** on a workout card, for example in a face-to-face session. A logged set that beats their current best is saved as a new rep max automatically.
11. **Sessions and calendar:** **Calendar** in the sidebar shows every client's booked sessions, and each client has a **Sessions** tab. **+ Book session** sets the date, time, length, location and notes, and can repeat weekly. Clients see their sessions on a calendar, plus a "Next session" card on their workouts page, and can **cancel** with an optional reason. A cancellation posts a message in your chat with them, so you get the usual new-message alert. If they cancel with less than 24 hours' notice they're reminded your cancellation policy may apply (change `LATE_CANCEL_HOURS` in `config.js`). You can also cancel (the client gets a message) or delete a session.
12. **Notice board** (top of the sidebar): post announcements such as closures, events, reminders and news, to all clients or to chosen ones. **Pin** important posts so they also show at the top of clients' workouts page. Clients see new posts in their **Notices** tab, with a dot until they've read them.
13. **Comments and check-in:** at the end of logging, clients can leave you a comment. Then a short, skippable "How were you feeling?" screen asks about things that may have affected the session (period, night shift, poor sleep, tired, stressed and so on). You see their answers on the workout card. Only you and that client can see them.
14. **Streaks:** a client's streak is the number of weeks in a row they've done every planned workout. Finishing a week stamps a terracotta **seal** onto their Home page (with a "Week sealed!" moment the first time), and they earn milestone seals at 2, 4, 8, 12, 26 and 52 weeks that they keep even if the streak ends. On each client's **Workouts** tab you'll see their streak and seals, a **Send a high five** button (sends an encouraging message you can edit into your chat), and **Rest weeks**: mark a holiday, illness or deload week so it pauses their streak instead of breaking it. You can mark weeks up to 4 weeks ahead.
15. **Team wins:** a feed where clients cheer each other on. It's **opt-in**: a client taps **Share my wins** (from the Team wins card on Home) and is told exactly what's shared. From then on their wins post automatically, under their first name only: personal bests (with the weight), streak seals, finished programs and workout milestones (10, 25, 50, 100… workouts). Clients who share can react with 🙌 🔥 💪 👏. Clients who don't share can still read the feed. **Stop sharing** hides all their wins straight away. Open **Team wins** in your sidebar to see who's sharing, react, **Remove** any post, and post a **+ Shout-out** to everyone. Notes, check-ins and chats are never shared.
16. The **Chat** tab is a private conversation with that client. A terracotta dot next to a client means they've sent a message you haven't opened yet.

Only emails you've added as clients can create an account. Anyone else is turned away.

## Applying app updates to the database

Some updates (like the consult notes) need a database change. When that happens, open `supabase/schema.sql` from this repo, paste the whole file into Supabase's **SQL Editor** again and click **Run**. This is safe to repeat: it keeps all your data, and you can leave `you@example.com` as it is, because your trainer email is already saved.

## Trying it locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. To sign in locally, also add `http://localhost:8000/**` to the Supabase redirect URLs.
