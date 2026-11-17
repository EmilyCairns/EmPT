"""EmPT exercise icons v2 — cute, chunky, soft.
48x48 grid. Thick rounded limbs, big round head with a bun, filled terracotta equipment,
soft peach backdrop blob and a ground shadow."""

INK = "#4A372E"
ACCENT = "#A9502F"
CREAM = "#FBF7EF"
BLOB = "#F6E7D7"
TINT = "#E3CDB4"
SW = 3.6  # limb stroke

# ---- primitives -------------------------------------------------------
def B(pts):                 # body limb (ink, thick)
    return ("poly", (pts, SW), "ink")
def L(pts, w=3, role="ink"):  # line of given width
    return ("poly", (pts, w), role)
def A(pts, w=3):            # accent line
    return ("poly", (pts, w), "accent")
def F(pts, w=2.2):          # faint ink line
    return ("poly", (pts, w), "faint")
def Head(cx, cy, r=4.6, bun=None):
    parts = []
    if bun:
        bx, by = {"r": (-3.4, -3.4), "l": (3.4, -3.4), "f": (3.3, -3.6),
                  "up": (-4.6, -1.6), "down": (-3.2, -3.6)}[bun]
        parts.append(("disc", (cx + bx, cy + by, 2.3), "ink"))
    parts.append(("disc", (cx, cy, r), "ink"))
    return parts
def Plate(cx, cy, r=5):
    return [("disc", (cx, cy, r), "accent"), ("disc", (cx, cy, 1.6), "paper")]
def Disc(cx, cy, r, role="accent"):
    return ("disc", (cx, cy, r), role)
def Ring(cx, cy, r, w=3, role="accent"):
    return ("ring", (cx, cy, r, w), role)
def Rect(x, y, w, h, rx, role="accent"):
    return ("rect", (x, y, w, h, rx), role)
def Path(d, w=3, role="accent", fill=False):
    return ("path", (d, w, fill), role)
def Shadow(cx, w=10, cy=43):
    return ("shadow", (cx, cy, w, 1.7), "shadow")
MAT = A([(6, 42.4), (42, 42.4)], 3.2)

def KB(cx, cy, r=4.6):
    """kettlebell, body centred at cx,cy"""
    return [Path(f"M{cx-2.9:g} {cy-2.6:g} C{cx-2.9:g} {cy-8:g} {cx+2.9:g} {cy-8:g} {cx+2.9:g} {cy-2.6:g}", 2.6),
            Disc(cx, cy, r), Disc(cx - 1.5, cy - 1.4, 1.1, "paper")]

def DB(x, y):
    """dumbbell, horizontal, handle from x to x+7 at y"""
    return [A([(x, y), (x + 7, y)], 2.4), Rect(x - 1.8, y - 4.5, 3.6, 9, 1.8), Rect(x + 5.2, y - 4.5, 3.6, 9, 1.8)]

# ---- icons ------------------------------------------------------------
ICONS = [
  # ---------- Strength ----------
  ("back-squat", "Back Squat", "Strength", [Shadow(26),
     *Plate(21, 19.4, 5.2),
     B([(25, 16), (16, 27), (27, 28.5), (25.5, 39.8)]),
     *Head(29.5, 9.5, bun="r")]),
  ("deadlift", "Deadlift", "Strength", [Shadow(27, 11),
     B([(30, 17.5), (15.5, 23.5), (23, 30), (21.5, 39.8)]),
     B([(29.5, 18), (30.5, 32)]),
     *Plate(31, 36.6, 5.2),
     *Head(34.5, 13, bun="r")]),
  ("bench-press", "Bench Press", "Strength", [Shadow(23, 15),
     L([(6, 31.8), (29, 31.8)], 3.2), L([(10, 32), (10, 40)], 3), L([(25.5, 32), (25.5, 40)], 3),
     B([(14.5, 27.3), (27, 27.3), (33.5, 21.5), (36, 39.8)]),
     B([(18.5, 27), (18.5, 15.5)]),
     *Plate(18.5, 10.5, 5.3),
     *Head(10, 25.5, 4.4, bun="up")]),
  ("strict-press", "Strict Press", "Strength", [Shadow(24),
     A([(9, 7), (39, 7)], 2.8), Rect(6.5, 2.2, 4.4, 9.6, 2.2), Rect(37.1, 2.2, 4.4, 9.6, 2.2),
     B([(12, 7.5), (20, 21), (28, 21), (36, 7.5)]),
     B([(24, 21), (24, 29.5)]), B([(20.5, 39.8), (24, 29.5), (27.5, 39.8)]),
     *Head(24, 14, 4.4, bun="f")]),
  ("barbell-row", "Barbell Row", "Strength", [Shadow(22, 11),
     B([(30, 18.5), (15, 23), (19.5, 31), (17.5, 39.8)]),
     B([(28.5, 19.5), (22, 24.5), (26, 27.5)]),
     *Plate(27, 32, 5),
     *Head(34.5, 15, bun="r")]),
  ("lunge", "Walking Lunge", "Strength", [Shadow(20, 13),
     B([(21, 15), (21, 26), (29.5, 28), (29.5, 39.8)]),
     B([(21, 26), (15.5, 35.5), (9, 39.8)]),
     A([(31.5, 13), (39, 13)]), A([(35.8, 9.6), (39.2, 13), (35.8, 16.4)]),
     *Head(21, 9.5, bun="r")]),
  ("kettlebell-swing", "Kettlebell Swing", "Strength", [Shadow(19, 9),
     B([(17.5, 15), (17, 27), (18, 39.8)]),
     B([(17.5, 17.5), (30, 17)]),
     *KB(34, 22.5, 5),
     *Head(17.5, 9.5, bun="r")]),
  ("hip-thrust", "Hip Thrust", "Strength", [Shadow(22, 17),
     Rect(4.5, 28.5, 10.5, 12.5, 3, "tint"),
     B([(14, 26.3), (26, 24), (33.5, 22.5), (33.5, 39.8)]),
     *Plate(26, 18.5, 5.2),
     *Head(9.8, 23, 4.4, bun="up")]),
  ("dumbbell-curl", "Dumbbell Curl", "Strength", [Shadow(22),
     B([(21, 15), (21, 27), (21, 39.8)]),
     B([(21, 17.5), (22.5, 25.5), (27.5, 20)]),
     *DB(27.5, 20),
     *Head(21, 9.5, bun="r")]),
  ("farmer-carry", "Farmer Carry", "Strength", [Shadow(24, 13),
     B([(24, 14.5), (24, 26)]), B([(21, 39.8), (24, 26), (27, 39.8)]),
     B([(16.5, 24.5), (20.5, 16.5), (27.5, 16.5), (31.5, 24.5)]),
     *KB(15.8, 31, 4.3), *KB(32.2, 31, 4.3),
     *Head(24, 9, 4.5, bun="f")]),
  # ---------- Bodyweight ----------
  ("push-up", "Push-up", "Bodyweight", [MAT,
     B([(33, 28), (8.5, 37), (8, 39.8)]),
     B([(32.5, 28.5), (32.5, 39.8)]),
     *Head(37.5, 24, 4.4, bun="down")]),
  ("pull-up", "Pull-up", "Bodyweight", [
     A([(8, 6.5), (40, 6.5)], 3), A([(8, 3.4), (8, 9.6)], 4), A([(40, 3.4), (40, 9.6)], 4),
     B([(16, 6.8), (14, 15.5), (21, 21), (27, 21), (34, 15.5), (32, 6.8)]),
     B([(24, 21), (24, 31)]), B([(21.5, 40), (24, 31), (26.5, 40)]),
     *Head(24, 13.8, 4.2, bun="f")]),
  ("plank", "Plank", "Bodyweight", [MAT,
     B([(33, 30), (8.5, 37), (8, 39.8)]),
     B([(33, 30.5), (33, 38.8), (38.5, 38.8)]),
     *Head(37.5, 26.3, 4.4, bun="down")]),
  ("sit-up", "Sit-up", "Bodyweight", [MAT,
     B([(14.5, 27.5), (21, 38.8), (29.5, 29), (35, 38.8)]),
     B([(16, 28.5), (26, 28)]),
     *Head(11.5, 23.3, 4.4, bun="up")]),
  ("burpee", "Burpee", "Bodyweight", [Shadow(24, 9, 42.5),
     B([(12, 7.5), (20, 19), (28, 19), (36, 7.5)]),
     B([(24, 19), (24, 28)]), B([(20.5, 36), (24, 28), (27.5, 36)]),
     A([(7, 16), (7, 21)], 2.2), A([(4.5, 18.5), (9.5, 18.5)], 2.2), A([(41, 16), (41, 21)], 2.2), A([(38.5, 18.5), (43.5, 18.5)], 2.2),
     *Head(24, 12.2, 4.4, bun="f")]),
  ("box-jump", "Box Jump", "Bodyweight", [Shadow(32, 10),
     Rect(25.5, 26.5, 15, 15.5, 3.2), A([(29, 30.5), (37, 30.5)], 1.8, ) if False else ("poly", ([(29, 30.6), (37, 30.6)], 1.6), "paper"),
     B([(14.5, 14.5), (13, 23.5), (20.5, 21), (18, 28.5)]),
     B([(14.5, 16), (21.5, 15.5)]),
     Path("M6 40 Q 9 27 12.5 26", 2.2, "faint"),
     *Head(14.8, 9, 4.4, bun="r")]),
  ("handstand", "Handstand", "Bodyweight", [MAT,
     B([(12.5, 39.8), (20, 27.5), (28, 27.5), (35.5, 39.8)]),
     B([(24, 27.5), (24, 17.5)]), B([(21, 6.5), (24, 17.5), (27, 6.5)]),
     *Head(24, 32.8, 4)]),
  # ---------- Conditioning ----------
  ("row-erg", "Row (Erg)", "Conditioning", [Shadow(22, 17),
     L([(6, 40), (34, 40)], 3), L([(30.5, 40), (32.5, 34)], 3),
     F([(21.5, 27.3), (33, 30.5)]),
     *Plate(38, 31, 6),
     L([(12.5, 36.3), (19.5, 36.3)], 3.2),
     B([(12.5, 21), (16, 33.5), (24.5, 30.5), (31.5, 33.5)]),
     B([(13, 22.5), (14.5, 28.5), (21, 27)]),
     *Head(11, 16.3, 4.4, bun="r")]),
  ("air-bike", "Air Bike", "Conditioning", [Shadow(24, 15),
     L([(9, 40.5), (39, 40.5)], 3), L([(16, 24.5), (18, 40.5)], 3),
     Ring(34, 30.5, 7.5, 3), Disc(34, 30.5, 2.4),
     L([(34, 30.5), (29.5, 13)], 3),
     L([(12, 23.8), (19.5, 23.8)], 3.4),
     B([(22, 13), (16.5, 22.3), (25, 25.5), (22.5, 33.5)]),
     B([(21.5, 14.5), (29, 15)]),
     *Head(24, 8.2, 4.2, bun="r")]),
  ("run", "Run", "Conditioning", [Shadow(23, 12),
     B([(28, 14), (23.5, 25), (31, 29), (29.5, 37.5)]),
     B([(23.5, 25), (18, 32), (11.5, 31)]),
     B([(26.5, 16.5), (21.5, 20), (18, 17)]), B([(26.5, 16.5), (31.5, 20.5), (35, 17)]),
     A([(6.5, 14), (12.5, 14)]), A([(4.5, 20.5), (10.5, 20.5)]),
     *Head(29.3, 8.5, bun="r")]),
  ("jump-rope", "Double-unders", "Conditioning", [Shadow(24, 9, 43.5),
     B([(24, 14.5), (24, 26)]), B([(22, 35.5), (24, 26), (26, 35.5)]),
     B([(16.5, 26), (21, 16.5), (27, 16.5), (31.5, 26)]),
     Path("M16.5 26 C 10.5 46, 37.5 46, 31.5 26", 2.8),
     *Head(24, 9, 4.5, bun="f")]),
  ("wall-ball", "Wall Ball", "Conditioning", [Shadow(20),
     B([(19.5, 18.5), (18.5, 29), (20, 39.8)]),
     B([(19.5, 20.5), (26.5, 14)]),
     Disc(32, 8.8, 5.2), Path("M27.6 6.6 Q 32 10.5 36.4 6.6", 1.4, "paper"),
     F([(36.6, 16), (39, 18.4)]), F([(34.5, 19.2), (36, 20.7)]),
     *Head(19, 13, bun="r")]),
  # ---------- Recovery ----------
  ("stretch", "Mobility", "Recovery", [MAT,
     B([(12, 38.6), (40, 38.6)]),
     B([(12, 38.6), (22, 30.5)]),
     B([(21, 31.5), (37, 35)]),
     *Head(27, 25.6, 4.2, bun="r")]),
  ("rest", "Rest Day", "Recovery", [
     Path("M27.5 10.5 A14 14 0 1 0 38 31 A11.5 11.5 0 0 1 27.5 10.5 Z", 0, "accent", True),
     Disc(17.5, 31, 1.3, "paper"), Disc(21.5, 35.5, 0.9, "paper"),
     L([(36, 7.5), (36, 14.5)], 2.6), L([(32.5, 11), (39.5, 11)], 2.6),
     L([(41, 19), (41, 23)], 2.2), L([(39, 21), (43, 21)], 2.2)]),
]

CATEGORIES = ["Strength", "Bodyweight", "Conditioning", "Recovery"]


def render_inner(parts, ink=INK, accent=ACCENT, paper=CREAM, blob=True, tint=TINT, blob_color=BLOB):
    out = []
    if blob:
        out.append(f'<circle cx="24" cy="24.5" r="22.5" fill="{blob_color}"/>')
    for kind, data, role in parts:
        color = {"accent": accent, "paper": paper, "tint": tint}.get(role, ink)
        op = ' stroke-opacity="0.3"' if role == "faint" else (' stroke-opacity="0.42"' if role == "far" else "")
        if kind == "poly":
            pts, w = data
            p = " ".join(f"{x:g},{y:g}" for x, y in pts)
            out.append(f'<polyline points="{p}" fill="none" stroke="{color}" stroke-width="{w:g}"{op}/>')
        elif kind == "disc":
            cx, cy, r = data
            out.append(f'<circle cx="{cx:g}" cy="{cy:g}" r="{r:g}" fill="{color}"/>')
        elif kind == "ring":
            cx, cy, r, w = data
            out.append(f'<circle cx="{cx:g}" cy="{cy:g}" r="{r:g}" fill="none" stroke="{color}" stroke-width="{w:g}"/>')
        elif kind == "rect":
            x, y, w, h, rx = data
            out.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{rx:g}" fill="{color}"/>')
        elif kind == "path":
            d, w, fill = data
            if fill:
                out.append(f'<path d="{d}" fill="{color}"/>')
            else:
                out.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w:g}"{op}/>')
        elif kind == "shadow":
            cx, cy, rx, ry = data
            out.append(f'<ellipse cx="{cx:g}" cy="{cy:g}" rx="{rx:g}" ry="{ry:g}" fill="{ink}" fill-opacity="0.12"/>')
    return "".join(out)


def svg(parts, size=48, label=None, standalone=False, **kw):
    ns = ' xmlns="http://www.w3.org/2000/svg"' if standalone else ""
    a11y = f' role="img" aria-label="{label}"' if label else ' aria-hidden="true"'
    return (f'<svg{ns} width="{size}" height="{size}" viewBox="0 0 48 48"{a11y} '
            f'stroke-linecap="round" stroke-linejoin="round">{render_inner(parts, **kw)}</svg>')


# ---- v2.1: far-side limbs (lighter, behind) + missing near arms -------
def Far(pts):
    return ("poly", (pts, SW), "far")

FAR = {
  "back-squat":   [Far([(16.5, 27), (26, 29.5), (23, 39.8)]), Far([(24, 17.5), (27.5, 23), (22.5, 21.5)])],
  "deadlift":     [Far([(15.5, 23.5), (25.5, 30.5), (25, 39.8)]), Far([(28, 18.5), (28, 32.5)])],
  "bench-press":  [Far([(27, 27.5), (31, 22.5), (32.5, 39.8)]), Far([(22.5, 27.5), (22.5, 15)])],
  "barbell-row":  [Far([(15, 23), (22, 31), (21, 39.8)]), Far([(27, 20.5), (20.5, 26), (24.5, 28.5)])],
  "lunge":        [Far([(21, 17), (15.5, 23.5)])],
  "kettlebell-swing": [Far([(17, 27), (15, 39.8)]), Far([(17.5, 19.5), (30, 19.5)])],
  "hip-thrust":   [Far([(26, 24.3), (31, 24.5), (30, 39.8)])],
  "dumbbell-curl": [Far([(20.5, 17.5), (18.5, 27.5)]), Far([(21, 27), (18.5, 39.8)])],
  "push-up":      [Far([(30.5, 29), (29.5, 39.8)]), Far([(21, 33), (10.5, 39.8)])],
  "plank":        [Far([(30.5, 31), (30.5, 38.8), (35.5, 38.8)]), Far([(21, 34), (10.5, 39.8)])],
  "sit-up":       [Far([(21, 38.8), (25, 30.5), (29.5, 38.8)]), Far([(15.5, 30), (25, 31)])],
  "box-jump":     [Far([(13, 23.5), (17.5, 26), (13, 32)]), Far([(14.5, 17.5), (19.5, 21.5)])],
  "row-erg":      [Far([(16, 33.5), (26, 34.8), (32.5, 37.5)]), Far([(13, 23.5), (16, 29), (21, 28.5)])],
  "air-bike":     [Far([(16.5, 22.3), (23, 22.5), (25, 31)]), Far([(21, 15.5), (28.5, 17)])],
  "wall-ball":    [Far([(18.5, 29), (17, 39.8)]), Far([(19.5, 21), (28, 16.5)])],
  "stretch":      [Far([(20, 33), (34, 36.6)])],
}
NEAR = {
  "back-squat": [B([(25, 16.5), (29, 21.5), (24.5, 20)])],
  "lunge":      [B([(21, 16.5), (26.5, 23)])],
  "hip-thrust": [B([(15, 26.8), (13.5, 33)])],
}

def _apply():
    out = []
    for slug, name, cat, parts in ICONS:
        parts = list(parts)
        hi = next((i for i, p in enumerate(parts) if p[0] == "disc" and p[2] == "ink"), len(parts))
        parts[hi:hi] = NEAR.get(slug, [])
        # far limbs go after backdrop-level items (shadow/mat) but before everything else
        lo = 1 if parts and parts[0][0] == "shadow" else 0
        parts[lo:lo] = FAR.get(slug, [])
        out.append((slug, name, cat, parts))
    return out
ICONS = _apply()
