# EmPT design system

This document decides how EmPT looks and feels. Anyone changing the app's appearance, whether that's you, a developer or an AI assistant, must follow it. If a change would break a rule here, update this document first.

## How it fits together

| File | What it controls | Who edits it |
| --- | --- | --- |
| `DESIGN.md` (this file) | The **rules**: brand, tone, when to use which colour or component | You |
| `design-tokens.css` | The **values**: every colour, font, size, spacing, corner and shadow | You |
| `styleguide.html` | A **preview** of every token and component | Nobody: it updates itself |
| `styles.css` | How components are built from the tokens | Developer / AI |

**To change the look:**
1. Edit a value in `design-tokens.css`. For example, change `--color-primary` to your brand colour.
2. Open `styleguide.html` (in the browser, or at `…/EmPT/styleguide.html` once the site is live) to see the result. Check it in dark mode too.
3. If you're adding a new rule or changing an old one, write it down here.

---

## 1. Brand

> These choices are yours to make. They're pre-filled with what the app does today, so replace anything that doesn't feel like you.

- **App name:** EmPT. It's set in `config.js` (`APP_NAME`) and in `manifest.webmanifest`.
- **Personality:** calm, encouraging and professional. It should feel like a supportive coach, not a hardcore gym.
- **Brand colour:** deep teal (`--color-primary`).
- **Logo / icon:** `icon.svg`, a white dumbbell on the brand colour.
- **Imagery:** none right now. If photos are added, they show real training and real people, not stock models.

## 2. Voice and wording

Every piece of text in the app (buttons, messages, empty states) follows these rules.

1. **Talk to the client as "you"**, and keep it warm and short. ("You're all caught up.")
2. **Sentence case everywhere.** Write "Mark as done", not "Mark As Done". The exception is `--heading-transform: uppercase`, if you choose it; then it's applied by the styling, never typed in capitals.
3. **Buttons say what they do** using a verb: "Add client", "Save", "Send". Avoid "OK" and "Submit".
4. **British English spelling:** personalised, colour, organise.
5. **Encourage, don't nag.** Celebrate completed workouts ("Nice work!"). Never shame missed ones.
6. **Errors explain what to do next.** "That email isn't registered yet. Ask your trainer to add you." Avoid "Error 400".
7. **No jargon or abbreviations** that a new client wouldn't know, unless you write them into a workout yourself.

## 3. Colour

All colours live in `design-tokens.css` and nowhere else.

1. **The brand colour is for the one most important action on screen**, such as "Mark as done", "Save", "Send" or "+ New workout", plus the active tab, focus outline and your own chat bubbles. Don't use it for decoration.
2. **`--color-primary-soft`** is the only highlight colour, for things that should stand out gently: the goals box, the selected client, badges.
3. **`--color-danger` is only for destructive actions and errors**, such as delete buttons and failed saves. Never use it for decoration or emphasis.
4. **`--color-notify`** is only for the "new message" dot.
5. **Text on a coloured background uses the matching `--color-on-…` token.** For example, text on `--color-primary` is `--color-on-primary`.
6. **Contrast:** body text must have a contrast ratio of at least **4.5 : 1** against its background, and large text or icons at least **3 : 1**. Check new colours with a contrast checker (search "WebAIM contrast checker") before using them.
7. **Every colour needs a dark-mode version.** When you change or add a colour in the light section of `design-tokens.css`, change or add it in the dark section too.
8. **Never use colour alone to carry meaning.** A completed workout gets a "✓ Done" badge as well as a softer look; errors are written out in words.

## 4. Typography

1. Use **two font families at most**: `--font-body` for everything, and `--font-heading` for headings and the app name. They can be the same font.
2. Only use the sizes in the type scale (`--text-xs` to `--text-2xl`). Don't add in-between sizes.
3. **Body text and every input are at least `--text-md` (16px).** Smaller inputs make iPhones zoom in.
4. Use at most three weights: regular for text, strong for labels, buttons and exercise names, and heading for headings.
5. Use italics only for coaching notes on exercises.
6. Keep lines short: reading areas are never wider than `--reading-max-width`.

### Changing the font

1. Choose a font at [fonts.google.com](https://fonts.google.com). Click **Get font → Get embed code** and copy the `<link …>` lines.
2. Paste them into the `<head>` of **both** `index.html` and `styleguide.html`, above the `design-tokens.css` line.
3. In `design-tokens.css`, set `--font-body` and/or `--font-heading`, e.g. `--font-heading: "Poppins", var(--font-body);`. Always keep a fallback after the font name.

## 5. Spacing and layout

1. **All spacing comes from the 4px grid** (`--space-1` to `--space-10`). Don't use in-between values.
2. **Related things sit closer together than unrelated things.** A label and its input are `--space-2` apart, while separate fields are `--space-4` apart.
3. Cards have `--space-4` padding inside, and the gap between cards is `--space-3`.
4. On phones, content keeps at least `--gutter` of space from the screen edge, and **the page never scrolls sideways**.
5. **Design for phones first.** Most clients will use their phone. The layout switches to desktop at **760px** wide. That number is written in the `@media` rule at the bottom of `styles.css`, because CSS can't use a token there. If you change it, change it in that one place and update this line.

## 6. Shape and depth

1. Corners: buttons and inputs use `--radius-control`, cards, dialogs and panels use `--radius-card`, chat bubbles use `--radius-bubble`, and badges and dots use `--radius-pill`.
2. Borders are always `--border-width` in `--color-border`.
3. Shadows: cards use `--shadow-card`, and things floating above the page (toasts) use `--shadow-overlay`. Don't use any other shadows.

## 7. Components

| Component | Rules |
| --- | --- |
| **Primary button** (`.btn.primary`) | At most **one per card or dialog**, for the main action. |
| **Ghost button** (`.btn.ghost`) | Secondary actions: Edit, Cancel, Sign out, Duplicate. |
| **Danger button** (`.btn.danger`, `.danger-text`) | Delete only. Always ask for confirmation first. |
| **Small / icon buttons** | Only for dense lists of actions (card actions, reordering exercises). Icon buttons must have an `aria-label`. |
| **Card** (`.card`) | One workout, one form or one block of content per card. Don't put cards inside cards. |
| **Tabs** (`.tabs`) | Two to four tabs to switch views. Labels are one to three words. |
| **Goals box** (`.goals`) | Only for the client's goals. |
| **Badge** (`.badge`) | Short status labels ("✓ Done …") of up to three words. |
| **Dialog** (`.dialog`) | Creating or editing something. The title says what's happening ("New workout for Amy"). Cancel is on the left of Save. |
| **Toast** (`.toast`) | Short confirmations after an action ("Workout saved"). They disappear by themselves, so they must never hold information the user needs to keep. |
| **Chat bubbles** | Your messages are on the right in the brand colour. Theirs are on the left in a neutral colour. Every message shows a timestamp. |

New components must reuse existing tokens. If a new one is genuinely needed, add it to this table and to `styleguide.html`.

## 8. Accessibility (non-negotiable)

1. Every tap target (buttons, tabs, list items) is at least `--control-height` tall (44px).
2. Keyboard focus is always visible, using the `--color-focus` outline. Never remove it.
3. Every input has a visible label. Placeholders show examples; they don't replace labels.
4. The contrast rules in section 3 apply to every colour pairing in both light and dark mode.
5. Animation stays subtle (`--motion-fast`) and turns off when the device asks for reduced motion.
6. Images and icons that carry meaning have text alternatives. Decorative ones have empty `alt=""`.

## 9. Brand colour outside the tokens

A few files can't read `design-tokens.css`. When you change `--color-primary` or `--color-bg`, update these by hand:

- `icon.svg`: the `fill` of the background square (`#0f766e`).
- `index.html`: `<meta name="theme-color" content="#0f766e">`, which colours the browser bar on phones.
- `manifest.webmanifest`: `theme_color` (the brand colour) and `background_color` (the page background).

## 10. Rules for anyone changing the code

1. **No raw values in `styles.css`.** Colours, font sizes, spacing, radii, shadows and widths must come from `var(--…)` tokens. The only exceptions are the `760px` breakpoint, percentages and viewport units (`%`, `vh`, `vw`).
2. **No inline styles in `app.js`.** Use classes from `styles.css`.
3. Need a new value? Add a token to `design-tokens.css` with a comment saying what it's for, give it a dark-mode value if it's a colour, and mention it in this document.
4. New or changed components get added to `styleguide.html`.
5. Check every visual change at phone width (390px) and desktop width, in light and dark mode, before committing.
6. Don't change the brand choices in section 1 without the owner's say-so.
