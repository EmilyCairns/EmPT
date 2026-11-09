# EmPT design system

> **Warm apothecary journal on parchment.**

This document decides how EmPT looks and feels. Anyone changing the app's appearance, whether that's you, a developer or an AI assistant, must follow it. If a change would break a rule here, update this document first.

EmPT should read like a premium editorial wellness journal printed on warm cream paper. Serif headlines speak with quiet authority, and a humanist sans carries the interface in the calm voice of a good coach. Surfaces are never sterile white: everything sits in a warm parchment range. A single terracotta accent marks actions and active states, like a wax seal on an apothecary label. Shapes are generously rounded but never toy-like, because shadows are rare and colour does most of the work.

## How it fits together

| File | What it controls | Who edits it |
| --- | --- | --- |
| `DESIGN.md` (this file) | The **rules**: brand, tone, when to use which colour or component | You |
| `design-tokens.css` | The **values**: every colour, font, size, spacing, corner and shadow | You |
| `styleguide.html` | A **preview** of every token and component | Nobody: it updates itself |
| `styles.css` | How components are built from the tokens | Developer / AI |

**To change the look:** edit a value in `design-tokens.css`, then reload `styleguide.html` (in the browser, or at `…/EmPT/styleguide.html` once the site is live).

`design-tokens.css` has two layers:
1. **Palette:** the named colours (Parchment, Ink, Terracotta Seal…).
2. **Roles:** what each colour is *for* (`--color-bg`, `--color-accent`…).

`styles.css` only uses roles. To recolour something, point its role at a different palette colour.

---

## 1. Brand

- **App name:** EmPT. It's set in `config.js` (`APP_NAME`) and `manifest.webmanifest`. The wordmark is set in the serif, in Ink, next to the terracotta seal icon.
- **Personality:** calm, warm, editorial, unhurried. It's health and fitness that trusts the reader to slow down, never a shouty gym.
- **Accent:** Terracotta Seal `#b05a36`. It's the **only** accent colour.
- **Logo / icon:** `icon.svg`, an outlined dumbbell in parchment on a terracotta-to-tan gradient seal.
- **Theme:** **light only.** The parchment warmth *is* the brand, so there is deliberately no dark mode.

## 2. Voice and wording

1. **Talk to the client as "you"**, and keep it warm and short. ("You're all caught up.")
2. **Sentence case everywhere.** Eyebrow labels are typed in sentence case; the styling turns them into capitals.
3. **Buttons say what they do** using a verb: "Add client", "Save", "Send". Avoid "OK" and "Submit".
4. **British English spelling:** personalised, colour, organise.
5. **Encourage, don't nag.** Celebrate completed workouts. Never shame missed ones.
6. **Errors explain what to do next**, in plain words.
7. **The italic word is the emotional word.** In a serif headline, the roman words set up the structure, and the one word that carries the feeling goes in italic: "Your training, *personalised*." or "Hi *Amy*". See section 4.

## 3. Colour

### Palette

| Name | Value | Use |
| --- | --- | --- |
| Terracotta Seal | `#b05a36` | Primary button fills, accent borders, active tab underline, unread dot |
| Terracotta Text | `#a4522f` | Terracotta used **as text** (eyebrows, outlined buttons, exercise numbers). It's a touch deeper so small text stays readable on Aged Paper |
| Parchment | `#fef9ef` | Page canvas, header, dialogs, inputs. The base tone |
| Aged Paper | `#f5eee1` | Cards, goals box, hover wash. One step deeper than the canvas |
| Warm Taupe | `#d1c9bf` | Hairline borders and dividers |
| Ink | `#2a2b2f` | Headings, primary text, your own chat bubbles, toasts |
| Charcoal | `#333333` | Longer reading text (workout notes, coaching notes) |
| Graphite | `#515151` | Helper text, dates, placeholders |
| Ash | `#808988` | Input borders **only**: the one cool neutral |
| Brick | `#8a2c1c` | Destructive actions and errors **only** |

### Surfaces (how things are layered)

| Level | Colour | Used for |
| --- | --- | --- |
| 0 | Parchment | Page background |
| 1 | Aged Paper | Cards and panels: a soft step up, with **no shadow** |
| 2 | Warm Taupe outline | Bordered containers and dividers |
| 3 | Terracotta | Active and selected interactive states |

### Rules

1. **Never use pure white (`#ffffff`)** anywhere. It kills the parchment warmth.
2. **Terracotta is reserved for three jobs:** primary buttons, eyebrow labels and active/selected states (including outlined buttons, the active tab, the selected client and the unread dot). Never use it for body text, large background areas or text bigger than 24px.
3. **No second accent colour.** The system is warm monochrome plus one rust. Brick is not an accent: it appears only on delete buttons and error messages. **One exception, chosen by the owner:** the plate calculator drawing uses the standard gym plate colours (25 kg red, 20 kg blue, 15 kg yellow, 10 kg green, 5 kg white, 2.5 kg red, 1.25 kg silver), because clients recognise them from the gym. These colours (`--plate-*` tokens) must never be used anywhere else.
4. **Build depth with colour before shadow:** Parchment, then Aged Paper, then a Taupe outline.
5. **Text on a terracotta or ink fill is Parchment.**
6. **Contrast:** body text must be at least **4.5 : 1** against its background, and large text and icons at least **3 : 1**. Checked pairs: Ink on Parchment 13.5, Graphite on Aged Paper 6.9, Terracotta Text on Aged Paper 4.8, Parchment on Terracotta 4.6, Brick on Parchment 8.1. Check any new colour with a contrast checker (search "WebAIM contrast checker").
7. **Never use colour alone to carry meaning.** Completed workouts get a "✓ Done" badge; errors are written out in words.

## 4. Typography

| Family | Font in the app | Stands in for | Used for |
| --- | --- | --- | --- |
| Serif | **Newsreader** | Financier Display | Headlines only: page titles, card titles, dialog titles, the wordmark |
| Sans | **Inter** | Ftbase | All body text and interface text |
| Mono | **JetBrains Mono** | Fragment Mono | Tiny all-caps badges ("✓ Done · 30 Nov"). Use sparingly |

Fonts load from Google Fonts in the `<head>` of `index.html` and `styleguide.html`. If you buy licences for Financier Display and Ftbase, self-host them and change `--font-display` / `--font-body`.

### Type scale

| Role | Token | Size | Family | Notes |
| --- | --- | --- | --- | --- |
| Mono badge | `--text-mono` | 11px | Mono | All caps |
| Eyebrow | `--text-eyebrow` | 12px | Sans 600 | All caps, Terracotta Text. Used for `h3` and `.eyebrow` |
| Body small | `--text-body-sm` | 14px | Sans | Dates, helper text, small buttons |
| Body | `--text-body` | 16px | Sans 400 | Default; **every input is at least this size** |
| Lead | `--text-body-lg` | 18px | Sans 300 | Intro paragraphs |
| Title | `--text-title` | 26px | Serif 400 | Card and dialog titles, wordmark. *Added for the app* |
| Heading | `--text-heading` | 34px | Serif 400 | Page headings ("Hi *Amy*"). Smallest size allowed to use italic |
| Heading large | `--text-heading-lg` | 45px | Serif 400 | Sign-in headline (drops to 34px on phones) |

The 64px, 80px and 88px sizes from the reference are for marketing heroes. If EmPT ever gets a landing page, add them as tokens then.

### Rules

1. **The serif is for headlines only.** Never use it for body text, buttons or labels.
2. **Roman plus italic in one headline is the signature move.** Write it as `<em>` inside an `h1` or `.display`. The italic is weight 300; the roman is 400. Only one word or short phrase is italic, and it's the emotional word. Never italicise whole sentences, UI labels or body text.
3. **Italic only at 34px and above.** Card and dialog titles (26px) stay roman.
4. **All sans text uses `--tracking-body` (−0.023em),** which is set once on `body`. Never override it per element. **Never apply it to the serif**: headings reset to normal tracking.
5. Sans weights: 300 for lead text, 400 for body, 600 for buttons, labels and eyebrows, and 700 only for rare emphasis.
6. **An eyebrow sits 8–12px above the heading it introduces.** Use it for section names ("Up next"), workout dates, "Your goals" and "Exercise 01".

## 5. Spacing and layout

1. **8px base unit.** Use `--space-2` (8px) and its multiples: 16, 24, 32, 40, 48, 64, 80. The half-steps `--space-1` (4), `--space-3` (12) and `--space-5` (20) are only for fine component tuning (button and input padding, tight gaps).
2. **Density is comfortable.** Whitespace is a design material, not a gap filler. Cards have 32px padding inside (24px on phones), elements sit 16px apart, and sections are separated by 40px or more.
3. On phones, content keeps `--gutter` (24px, or 16px on very small phones) from the screen edge, and **the page never scrolls sideways**.
4. **Design for phones first.** The layout switches to desktop at **760px**. That number is written in the `@media` rule at the bottom of `styles.css`, because CSS can't use a token there.
5. **One sticky top bar** with a Warm Taupe hairline beneath it. The trainer's client list is the only sidebar. It's an app necessity, kept quiet: Parchment, no chrome.

## 6. Shape and elevation

| Element | Radius token | Value |
| --- | --- | --- |
| Buttons | `--radius-buttons` | 40px |
| Cards, dialogs, chat window, chat bubbles, textareas | `--radius-cards` | 24px |
| Inputs, badges, dots, toasts | `--radius-pills` | fully round |
| Navigation items (client list) | `--radius-nav` | 12px |
| Chart bars (future) | `--radius-chart` | 2px: deliberately square |

1. **Rounded shapes are non-negotiable.** Never use rectangular buttons or square-cornered cards.
2. Single-line inputs are pills. Multi-line text boxes use the 24px card radius, because a pill can't hold several lines.
3. **Only two shadows exist:**
   - `--shadow-xl` for things floating above the page: dialogs and toasts.
   - `--shadow-lg`, a subtle glow, is reserved for an active search/input state.
   Cards never have shadows. Don't add small, sharp drop shadows.

## 7. Components

| Component | Rules |
| --- | --- |
| **Primary button** (`.btn.primary`) | Terracotta fill, Parchment text, Sans 600 16px, padding 12px × 24px, 40px radius, no shadow. **At most one per card or dialog.** |
| **Outlined button** (`.btn`) | Transparent, 1.5px terracotta border, Terracotta Text. Same height as primary, never smaller. For supporting actions: "+ Add exercise", "Mark as not done". |
| **Ghost button** (`.btn.ghost`) | No border or fill, Ink text. A light Aged Paper wash on hover. For low-priority actions: Cancel, Sign out, Edit, Duplicate. |
| **Danger** (`.btn.danger`, `.danger-text`) | Brick, outlined or text-only. Delete only, and always ask for confirmation first. |
| **Icon button** (`.btn.icon`) | 40px circle, no fill, Ink symbol, Aged Paper on hover. Must have an `aria-label`. |
| **Input** | Pill, Parchment fill, 1px Ash border, padding 12px × 20px, Sans 16px Ink, Graphite placeholder. Focus: terracotta border plus a 3px soft terracotta ring. |
| **Card** (`.card`) | Aged Paper, 24px radius, 32px padding, no border, no shadow. Don't put cards inside cards. |
| **Workout card** | Eyebrow date, then a serif title, then Charcoal notes, then numbered exercises ("01", "02" in Terracotta Text). Completed workouts step *down* to Parchment with a Taupe outline and a mono "✓ Done" badge. |
| **Target weight** (`.ex-target`) | Sans 600 14px Ink, under the prescription: "Your weight: 65 kg (70% of estimated 1RM 93.3 kg)". Always show what the number is based on, and say "estimated" when it is. |
| **How to** (`details.howto`) | Underlined Ink "How to" toggle under an exercise. It opens the coaching cues and an outlined "Watch demo ↗" button. |
| **Logged sets** (`.ex-logged`) | "**Logged:** 65 kg × 8 @ 7 · …" in Charcoal 14px under the exercise. |
| **Set row** (`.set-row`) | Logging grid: terracotta set number, then kg, reps and effort pill inputs, then a remove icon. The plan shows as grey placeholder text. |
| **Rep max chips** (`.chip`) | Parchment pills with a Taupe outline: "5RM 85 kg". An estimate uses a **dashed** outline and Graphite text. |
| **Option chips** (`.chip-toggle`) | Tap-to-select pills for multiple choice (the "How were you feeling?" check-in). Unselected: Parchment with an Ash outline. Selected: terracotta outline and Terracotta Text with a "✓". |
| **Client feedback** (`.feedback`) | On a workout card: Parchment with a Taupe outline, a "Your notes" / "Amy's notes" eyebrow, the chosen options as chips, then their comment. Private to the client and trainer. |
| **Notice** (`.notice`) | A notice board post: an Aged Paper card with an eyebrow ("Pinned · date"), a serif title, a mono "New" badge until the client has seen it, then the message. Pinned posts also sit above "Up next" on the client's workouts page. |
| **Session card** (`.session`) | Eyebrow date, the time range in the serif ("6:00 PM – 7:00 PM"), then "client · location · length" in Graphite. Cancelled sessions step down to Parchment with a Taupe outline, a struck-through time and a mono "Cancelled by …" badge. |
| **Calendar** (`.calendar`) | Month grid starting on Monday, on Parchment with a Taupe outline. Today's number is bold and underlined. The selected day has a terracotta outline. Terracotta dots show sessions; hollow Graphite dots show cancelled ones. |
| **Warning callout** (`.callout.warning`) | A Brick outline and Brick text for something the person should know before a destructive action (for example, late cancellation). Use sparingly. |
| **Tick boxes and radios** (`.check`) | Native controls in the accent colour, 20px, with the label on the same line. |
| **Mini labels** (`.mini-field`) | Eyebrow-sized Graphite capitals above compact inputs, so filled-in boxes still say what they are. |
| **Rest timer** (`.rest-bar`) | Sticks to the top of the workout page. Parchment with a Taupe outline and `--shadow-xl` (it floats over the page). The time is in the serif at heading size, with tabular figures. Running: terracotta outline and time. Finished: a brief terracotta fill with Parchment text ("Rest over · Go!"), plus a beep and vibration. |
| **Set tick** (`.set-check`) | Round 40px button at the end of each set row. Unticked: Ash outline. Ticked: terracotta fill and a Parchment ✓. Ticking fills in the plan and starts the rest timer. On the workout page, numbers the client entered are semibold and the plan shows as lighter Ash placeholder text. |
| **Plate calculator** (`.plates`) | On barbell exercises: a Parchment panel with a "Plates" eyebrow, a 20 kg / 15 kg bar switch (option chips), a drawing of the loaded bar and a sentence ("65 kg: 20 kg bar + 20 + 2.5 kg on each side"). Plates are drawn in the **standard gym colours** (`--plate-25` … `--plate-1-25`; see Colour rule 3), bigger plates taller and thicker, each with a Charcoal outline so the pale ones stand out on Parchment. **Each plate has its weight printed on it**, running up the plate in bold: Parchment writing on red, blue and green plates, Ink writing on yellow, white and silver ones (all at least 5.4 : 1 contrast). Colour is never the only clue: the number is always on the plate. The sentence underneath always gives the answer in words too. |
| **Draft workout card** (`.workout.draft`) | Trainer only. Parchment with a 1.5px **dashed** Taupe outline, a mono "Draft · not visible to …" badge, and **Publish** as its primary button in place of "Mark as done". Dashed outlines are reserved for drafts and estimates. |
| **Eyebrow** (`h3`, `.eyebrow`) | All caps, Sans 600 12px, Terracotta Text, 8–12px above what it introduces. |
| **Goals box** (`.goals`) | Aged Paper panel with an eyebrow label. Used for the client's goals and the trainer's private injuries reminder on the Workouts tab. |
| **Callout** (`.callout`) | Parchment with a Taupe outline: an eyebrow, one sentence and one small primary button. Used for "No account yet". |
| **Private vs visible cards** | Private trainer content (consult notes) sits on an Aged Paper `.card` with a "Private · only you see this" eyebrow. Content the client will see sits on a Parchment `.shared-card` with a Taupe outline and a "Visible to …" eyebrow. Never style them alike. |
| **Autosave status** | Small Graphite text, top right of the card it belongs to: "Editing…", "Saving…", "Saved 9:50 AM" or "Not saved". |
| **Badge** (`.badge`) | Mono 11px all caps, Taupe pill outline, Terracotta Text. Up to about four words. |
| **Tabs** (`.tabs`) | Sans 600, Graphite. The active tab is Ink with a 2px terracotta underline, on a Taupe hairline. |
| **Client list item** | 12px radius. On hover or when selected: an Aged Paper wash, and the selected name turns Terracotta Text. |
| **Dialog** | Parchment, 24px radius, `--shadow-xl`, serif title. Cancel (ghost) sits beside Save (primary). |
| **Chat** | A Parchment window with a Taupe outline. Your bubbles are Ink with Parchment text, on the right; theirs are Aged Paper, on the left. Each has a timestamp. |
| **Toast** (`.toast`) | Ink pill, Parchment text, `--shadow-xl`. Short confirmations only; they disappear by themselves. |
| **Inline list** (future) | Items separated by a terracotta "·" with 16px either side, wrapping with an 8px row gap. |
| **Charts** (future) | Terracotta bars with square 2px corners, 1px Taupe axes, Graphite 12px labels, no grid background. |

New components must reuse existing tokens. If a new one is genuinely needed, add it to this table and to `styleguide.html`.

## 8. Imagery and icons

1. **Photography** (if added): warm-toned, human and in motion, such as golden-hour runs or outdoor training. When text sits on a photo, add a dark warm overlay (about 60%) so the headline stays readable. Photos inside the page use the 24px radius.
2. **No stock-model gloss and no product screenshots.** Small in-card UI previews are fine.
3. **Icons are outlined**, with a 1.5–2px stroke in Ink or terracotta. Never filled, never multicolour.
4. Images that carry meaning have alt text. Decorative ones have `alt=""`.

## 9. Accessibility (non-negotiable)

1. Every tap target is at least `--control-height-sm` (40px). Main buttons and inputs are `--control-height` (48px).
2. Keyboard focus is always visible: a terracotta outline plus a soft ring. Never remove it.
3. Every input has a visible label. Placeholders show examples; they don't replace labels.
4. The contrast rules in section 3 apply to every colour pairing.
5. Animation stays subtle (`--motion-fast`) and turns off when the device asks for reduced motion.

## 10. Brand colour outside the tokens

These files can't read `design-tokens.css`. Update them by hand if the palette changes:

- `icon.svg`: the gradient stops (`#b05a36` → `#d4a68e`) and the stroke colour (`#fef9ef`).
- `index.html`: `<meta name="theme-color" content="#fef9ef">`, which colours the browser bar on phones.
- `manifest.webmanifest`: `theme_color` and `background_color` (both Parchment).

## 11. Rules for anyone changing the code

1. **No raw values in `styles.css`.** Colours, font sizes, spacing, radii, shadows and widths must come from `var(--…)` tokens. The only exceptions are the `760px` breakpoint, percentages, viewport units and opacity.
2. **`styles.css` uses role tokens** (`--color-accent`), not palette tokens (`--color-terracotta-seal`).
3. **No inline styles in `app.js`.** Use classes from `styles.css`.
4. Need a new value? Add a token to `design-tokens.css` with a comment saying what it's for, and mention it in this document.
5. New or changed components get added to `styleguide.html`.
6. Check every visual change at phone width (390px) and desktop width before committing.
7. Don't change the brand choices in section 1 without the owner's say-so.
