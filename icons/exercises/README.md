# EmPT exercise icons

Illustrated exercise icons for the EmPT app. Warm ink figures, terracotta equipment, 48×48 viewBox.

## Folders
- `svg/` — default icons with the soft peach backdrop circle. Use on cream/white cards.
- `svg-no-backdrop/` — same icons without the circle. Use when the icon sits on its own tinted tile (e.g. workout list rows).
- `svg-on-seal/` — cream version for placing on a terracotta circle/button.
- `icons.json` — maps every exercise name to its icon `slug` (some icons cover more than one name, e.g. "Plank" vs "Elbow Plank Hold"), plus `program_list` in the coach's original order, and the brand colours.
- `source/` — the Python that draws the icons (`icons.py` = primitives + base set, `program.py` = program set). Every icon is a list of shapes on a 48 grid, so new icons can be added in the same style.

## Using them in the app
- Look up an exercise's icon via `icons.json` (match on `names`, case-insensitive), fall back to a generic icon if there's no match.
- Render as `<img>` / image asset, or inline the SVG. Recommended display sizes: 40–48 px in lists, 64–96 px on exercise detail screens.
- Colours: ink `#4A372E`, terracotta `#A9502F`, cream `#FBF7EF`, backdrop `#F6E7D7`, equipment beige `#E3CDB4`.

## Style rules (for adding new icons)
- 48×48 grid, round caps and joins.
- Limbs 3.6 stroke, solid round head (r≈4.4) with a little bun on the back of the head.
- Far-side arm/leg drawn in the same ink at 42% opacity, behind the body.
- The thing that moves (bar, dumbbell, kettlebell, band, roller, handle) is terracotta; benches, boxes and machine frames are beige.
- Soft ground shadow under standing figures; mats are a terracotta line.
- Regenerate SVGs: `python3 -c "from program import ICONS; from icons import svg; ..."` (see source).
