# Sign-in email templates

Clients sign in with a link **or a 6-digit code** from their email. The code is
what makes sign-in work in the app saved to an iPhone home screen (email links
open in Safari, which has a separate sign-in). Supabase only puts the code in
the email if the template asks for it, so paste these in once.

In Supabase: **Authentication → Emails → Templates**. Update both **Magic Link**
(clients who have signed in before) and **Confirm signup** (a client's very
first sign-in). For each: replace the subject and the body (switch the body
editor to source/HTML if it asks), then **Save**.

---

## Magic Link

**Subject**

```
Your EmPT sign-in code: {{ .Token }}
```

**Body**

```html
<div style="font-family: Arial, sans-serif; color: #2a2b2f; max-width: 480px;">
  <p>Hi!</p>
  <p>Here's your code to sign in to EmPT:</p>
  <p style="font-size: 32px; letter-spacing: 6px; font-weight: bold; margin: 24px 0;">{{ .Token }}</p>
  <p>Type it into the app. If you're on the same phone and not using the app from your home screen, you can tap this link instead:</p>
  <p><a href="{{ .ConfirmationURL }}" style="color: #a4522f;">Sign in to EmPT</a></p>
  <p style="color: #515151; font-size: 14px;">The code only works for a little while. If you didn't ask to sign in, you can ignore this email.</p>
  <p>See you soon,<br>Emily</p>
</div>
```

---

## Confirm signup

**Subject**

```
Welcome to EmPT: your sign-in code {{ .Token }}
```

**Body**

```html
<div style="font-family: Arial, sans-serif; color: #2a2b2f; max-width: 480px;">
  <p>Hi, welcome to EmPT!</p>
  <p>Here's your code to sign in for the first time:</p>
  <p style="font-size: 32px; letter-spacing: 6px; font-weight: bold; margin: 24px 0;">{{ .Token }}</p>
  <p>Type it into the app. If you're on the same phone and not using the app from your home screen, you can tap this link instead:</p>
  <p><a href="{{ .ConfirmationURL }}" style="color: #a4522f;">Sign in to EmPT</a></p>
  <p>The first time you sign in, you'll be asked a few health questions so your training is safe and suits you.</p>
  <p style="color: #515151; font-size: 14px;">If you didn't expect this email, you can ignore it.</p>
  <p>See you soon,<br>Emily</p>
</div>
```

---

## Also worth checking (same area of Supabase)

- **Authentication → Providers → Email:** "Email OTP length" should be **6** (the
  app accepts 6 to 10 digits, but the emails above read best with 6).
- **Authentication → Emails → SMTP Settings:** connect an email service (for
  example Resend) so you aren't limited to a few emails an hour.
- **Authentication → URL Configuration:** Site URL
  `https://emilycairns.github.io/EmPT/` and redirect URL
  `https://emilycairns.github.io/EmPT/**`.
