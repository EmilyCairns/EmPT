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
| `manifest.webmanifest`, `icon.svg`, `icons/` | Lets clients "Add to Home Screen" on their phone (with a proper app icon) |
| `privacy.html` | The privacy page clients can read. Fill in your business name and email. |
| `supabase/email-templates.md` | Sign-in emails to paste into Supabase (they include the 6-digit code) |
| `docs/welcome-message.md` | A message to send new clients |

## One-time setup (about 15 minutes)

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project (the free plan is fine). Pick a region near you.
2. Open **SQL Editor → New query**. Paste in all of `supabase/schema.sql`.
3. Near the bottom, change `you@example.com` to **the email you'll sign in with**. Then click **Run**.

### 2. Point the app at your project

1. In Supabase, open **Project Settings → API** (on newer projects, **API Keys**). Copy the **Project URL** and the **anon / publishable key**. Never use the `service_role` or secret key.
2. Edit `config.js` in this repo and paste them in. You can also change `TRAINER_NAME` here. These values are safe to make public.

### 3. Turn on GitHub Pages, at your own address

The app lives at **https://app.emilycairns.com.au** (the `CNAME` file in this repo tells GitHub Pages so). `emilycairns.com.au` itself is kept for your business website.

1. Merge this work into the `main` branch.
2. In GitHub, open **Settings → Pages**. Under **Source**, choose **Deploy from a branch**, then branch `main`, folder `/ (root)`, and click **Save**.
3. At your domain registrar, open the DNS settings for `emilycairns.com.au` and add one record:
   - **Type:** `CNAME` · **Host/Name:** `app` · **Value/Points to:** `emilycairns.github.io` · TTL: default
4. Back in **Settings → Pages**, check **Custom domain** shows `app.emilycairns.com.au` (type it and **Save** if not). When the DNS check turns green (minutes to a few hours), tick **Enforce HTTPS**.
5. Recommended, to stop anyone else using your domain on GitHub: your GitHub profile → **Settings → Pages → Add a domain** → `emilycairns.com.au`, and add the `TXT` record it shows you at your registrar.

Until the website is built, you can point `emilycairns.com.au` at the app using your registrar's **URL forwarding** (forward to `https://app.emilycairns.com.au`).

GitHub Pages on a free account needs the repository to be public. That's fine: the code holds no private data. Your clients' data lives in Supabase.

### 4. Tell Supabase where the app lives

In Supabase, open **Authentication → URL Configuration**:

- **Site URL:** `https://app.emilycairns.com.au/`
- **Redirect URLs:** add `https://app.emilycairns.com.au/**` (and `http://localhost:8000/**` if you test locally)

Sign-in links won't work without this.

### 5. Set up sign-in emails (needed before real clients)

Clients sign in with a **6-digit code** (or a link) emailed to them. Two things to do in Supabase:

1. **Send the code in the email.** Under **Authentication → Emails → Templates**, paste the **Magic Link** and **Confirm signup** templates from `supabase/email-templates.md`. Without this the emails only contain a link, and sign-in won't work in the app saved to an iPhone home screen.
2. **Use a proper email sender.** Supabase's built-in sender only allows a few emails an hour. Under **Authentication → Emails → SMTP Settings**, connect a free email service such as Resend, Brevo or Postmark.

### 6. Finish the privacy page

Open `privacy.html` and replace **[your business name]** and **[your contact email]**. It's linked from the sign-in screen, the health form and the bottom of every client's Home page. It's a plain-English starting point, not legal advice: check it with your insurer or professional association.

### 7. Test it, then invite clients

Sign in as yourself on a computer, then as the test client on your phone (add it to your home screen too). Then, for each client: **+ New client**, add their email in **Edit client**, and send them the message in `docs/welcome-message.md`.

## Saving it on a phone like an app

No app store needed. Clients open the link and:

- **iPhone:** in **Safari**, tap **Share → Add to Home Screen**.
- **Android:** in **Chrome**, tap **⋮ → Add to Home screen** (or **Install app**).

It then opens full-screen from its own terracotta icon. On iPhone the home-screen app has its own sign-in, separate from Safari, so clients type the 6-digit code there (email links open in Safari).

## Everyday use

1. Open the app and sign in with your trainer email. You land on **Today**: today's sessions and birthdays, **Needs attention** (clients waiting for a reply, a health-form "yes", missed workouts this week, nobody planned for the coming week, drafts to publish) and **Recent activity** (finished workouts with their effort, check-in and comment, and new personal bests from the last 7 days). Tap any row to jump straight to that client.
   **Client list:** under each name is a one-line status (streak, next session or workout, how they pay) and any flags in terracotta. Search by name or email, and sort **A–Z** or **Needs you first**. At the top of each client's page, a summary line shows their streak, last workout (and effort), next session and upcoming birthday.
2. **+ New client** after a first consult: enter their name. Email is optional at this point. In **Edit client** you can also set **How they pay** (Ezidebit, Stripe in the app, bank transfer or other). Only you see it, in your client list and on their page.
3. On the **Consult notes** tab, jot quick private notes: injuries and conditions, goals in their words, training history, anything else. **Only you can see these**; the database blocks clients from them entirely. Notes save as you type, and **Copy notes** puts a tidy summary on your clipboard to paste into a chat with Claude.
4. In **Their goals** on the same tab, write the friendly version the client will see on their page.
5. When you're ready to give them access, click **Add email**. That creates their account. Send the client the app link. They type their email, tap the link they receive, and they're in. On their phone they can use "Add to Home Screen" to install it like an app.
   Clients land on **Home**, kept short so the main thing stands out: the date (and which week of their program they're in), a **Today** card with **Start workout →** (exercises fold under "See exercises"; on rest days it says what's next or offers a catch-up), **This week** (a dot per day and their streak), **Coming up** (the next few workouts and sessions), your latest notices (tap to read), **Team wins**, and a **Your progress** row. Their tabs are **Home · Calendar · Program · Progress · Chat**. **Progress** has their goals, their consistency (streak, seals and a 12-week chart) and their lifts.
   **Program tab (clients):** their current program: a **From Emily** box with the program's aim (the note you write on the program), quick facts (week 2 of 4, workouts done, training days), then the workouts week by week, with the current week open and Start / Preview / View on each. Below: any **other workouts** outside a program, and **Past programs**, each opening to show how every week went.
6. Choose a client and create workouts with **+ New → Workout**. Their **Workouts** tab groups workouts into **Drafts**, **This week**, **Coming up** and **Past workouts** (folded away). Each is one line (date, title, status such as Done · effort 7 or Missed) with a quick **Publish** or **Log** button; tap it to open the full workout and its Edit, Duplicate, Unpublish and Delete options. Each workout has a title, a date, notes and a list of exercises (sets, reps, load, rest, coaching notes). **Save as draft** keeps it hidden from the client until you click **Publish** (or **Publish all**). **Unpublish** hides it again. Use **Duplicate** to reuse a session. You can also ask Claude to write workouts for you: they arrive as drafts for you to check.
   **Programs:** for a block of training, use **+ New → Program** instead: give it a name, a note, how many weeks and how many workouts a week, then **Write** each workout (A, B, C…) once. The client does the same workouts every week. **Send to [client]** puts a "New program" card on their Home page: they see an overview, tick exactly as many training days as the program needs, pick a start date, and **Add to my calendar** creates every workout, labelled Week 1, Week 2… To change the weights for a particular week, edit that week's workouts. For clients without an account, use **Choose days for them**.
   **Calendar (clients):** a list of weeks (Monday to Sunday) with each workout and session on its day. Clients can move a workout up to **2 weeks either side** of its planned day (not into the past): press and hold it and drag it to another day, drag it with a mouse, or tap **Move**. Tapping a session shows its details and lets them cancel it.
7. **Exercise library** (top of the sidebar): add a demo video link and coaching cues to each exercise. Clients see them under "How to". Any new exercise name you type in a workout is added to the library automatically.
8. **Percentages:** in the workout editor, fill in "% of max" and choose which rep max (for example 70% of 1RM). Each client sees their own weight worked out and rounded to 2.5 kg (change `ROUND_TO_KG` in `config.js`). If they only have, say, a 5RM, their 1RM is estimated from it.
9. **Lifts tab:** record each client's 1RM, 3RM, 5RM and so on. Clients can add their own too, on their **Progress** tab.
10. **Start workout:** clients tap **Start workout** to open a page with just that day's workout. They enter weight and reps for each set, with the plan shown and last time's numbers under each set. There's no tick: a set with reps counts as done, and entering the reps starts the **rest timer**. Tapping an exercise's name shows their full history for that lift: heaviest set, best estimated 1RM, rep maxes and every set they've logged, by date. The timer sits at the top of the page. It starts with the exercise's rest when they enter a set's reps, they can adjust it with − / +, and it beeps and vibrates when rest is over. The screen stays awake during the workout. At the end they can rate **how hard the whole workout was, 1–10** (optional; you see it as "Effort 7/10" on the workout card). **Barbell exercises** have a small **barbell button** at the end of each set: tapping it opens the **plate calculator** for that set's weight. It leaves out 25 kg plates, since Revo doesn't have them (add 25 back to `PLATES_KG` in `config.js` if that changes), with a picture of the bar with the plates for each side, with a small **Using a 15 kg bar** tick box (it uses the 20 kg bar otherwise). Tick "Uses a barbell" on an exercise in the library to turn it on or off; obvious barbell lifts (squat, deadlift, bench press…) are recognised automatically. Set your gym's plates in `PLATES_KG` in `config.js`. Entries are kept on the phone until they press **Finish workout** (save and mark as done) or **Save for later**. You can still log for them with **Log** on a workout card, for example in a face-to-face session. A logged set that beats their current best is saved as a new rep max automatically.
11. **Sessions and calendar:** **Calendar** in the sidebar shows every client's booked sessions, and each client has a **Sessions** tab. **+ Book session** sets the date, time, length, location and notes, and can repeat weekly. Clients see their sessions on a calendar, plus a "Next session" card on their workouts page, and can **cancel** with an optional reason. A cancellation posts a message in your chat with them, so you get the usual new-message alert. If they cancel with less than 24 hours' notice they're reminded your cancellation policy may apply (change `LATE_CANCEL_HOURS` in `config.js`). You can also cancel (the client gets a message) or delete a session.
12. **Notice board** (top of the sidebar): post announcements such as closures, events, reminders and news, to all clients or to chosen ones. **Pin** important posts so they also show at the top of clients' workouts page. Clients see new posts in their **Notices** tab, with a dot until they've read them.
13. **Comments and check-in:** at the end of logging, clients can leave you a comment. Then a short, skippable "How were you feeling?" screen asks about things that may have affected the session (period, night shift, poor sleep, tired, stressed and so on). You see their answers on the workout card. Only you and that client can see them.
14. **Streaks:** a client's streak is the number of weeks in a row they've done every planned workout. Finishing a week stamps a terracotta **seal** onto their Home page (with a "Week sealed!" moment the first time), and they earn milestone seals at 2, 4, 8, 12, 26 and 52 weeks that they keep even if the streak ends. On each client's **Workouts** tab you'll see their streak and seals, a **Send a high five** button (sends an encouraging message you can edit into your chat), and **Rest weeks**: mark a holiday, illness or deload week so it pauses their streak instead of breaking it. You can mark weeks up to 4 weeks ahead.
15. **Team wins:** a feed where clients cheer each other on. It's **opt-in**: a client taps **Share my wins** (from the Team wins card on Home) and is told exactly what's shared. From then on their wins post automatically, under their first name only: personal bests (with the weight), streak seals, finished programs and workout milestones (10, 25, 50, 100… workouts). Clients who share can react with 🙌 🔥 💪 👏. Clients who don't share can still read the feed. **Stop sharing** hides all their wins straight away. Open **Team wins** in your sidebar to see who's sharing, react, **Remove** any post, and post a **+ Shout-out** to everyone. Notes, check-ins and chats are never shared.
16. **Health form and birthdays:** the first time a client signs in, they fill in a short health form before they see anything else: their **birthday**, the 7 standard Australian pre-exercise screening questions (APSS stage 1), injuries and medical, goals and lifestyle, and an emergency contact. If they answer "yes" to any screening question, they're asked to check with their GP first, and you'll see **Health check: see notes** under their name. Their answers appear at the top of their **Consult notes** (only you and they can see them), and **Copy notes** includes them. They can update their answers any time from **Update my health details** at the bottom of Home. Birthdays show on your **Calendar** (✦, plus a list for the month and "Birthday today" in your client list). On their birthday, clients get a **Happy birthday** message at the top of Home. You can also add a birthday yourself in **Edit client**.
17. The **Chat** tab is a private conversation with that client. A terracotta dot next to a client means they've sent a message you haven't opened yet.

Only emails you've added as clients can create an account. Anyone else is turned away.

## Applying app updates to the database

Some updates (like the consult notes) need a database change. When that happens, open `supabase/schema.sql` from this repo, paste the whole file into Supabase's **SQL Editor** again and click **Run**. This is safe to repeat: it keeps all your data, and you can leave `you@example.com` as it is, because your trainer email is already saved.

## Trying it locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. To sign in locally, also add `http://localhost:8000/**` to the Supabase redirect URLs.
