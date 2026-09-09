"""Turn the official Ganesh Chaturthi artwork into Creative Studio templates.

The official JPGs carry a flat grey doctor/person icon where the photo goes.
The studio needs a clean circular hole instead, so this script:

  1. scales the artwork down to the size the studio works at,
  2. paints the grey icon out (the paper behind it is a flat #FDFDFD),
  3. drops a light disc + brand-red ring in its place.

Everything after step 1 happens in output pixels, so the coordinates below are
the same ones the studio's PRESETS use -- no half-pixel drift between the ring
drawn here and the hole punched there.

The ring's inner edge sits exactly on the punch radius. The studio clips the
photo with the same ellipse it punches out of the template, so the two
antialiased edges are complementary and meet without a seam. Run from the
repo root:

    python tools/prepare_templates.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

SRC = Path.home() / "Downloads"
OUT = Path(__file__).resolve().parent.parent / "templates"

SOURCES = {
    "doctor": "Ganpati- Doctor creative.jpg",
    "employee": "Ganpati- Employee creative.jpg",
}

OUT_W, OUT_H = 1169, 1460           # the studio's native template size

# --- output-space coordinates -------------------------------------------------
ICON_BOX = (108, 930, 270, 1102)    # grey person icon, plus a margin
PAPER_L, PAPER_R = 106, 274         # clean columns either side of the icon

# The photo's slot is the full width from the card's left edge to the printed
# divider at x=335, and the circle is centred in it: ~60px of air on each side.
# Measuring against the text margin instead leaves the ring nearly touching the
# divider with all the space pooled on the left, which is what reads as
# one-sided. The ring overhangs the x=76 text margin slightly, which is what a
# round shape needs to look aligned with flat-edged text.
# Vertically it is centred on the divider, which also centres it in the gap
# between the headline block and the awards row.
CIRCLE = (167, 1046)
R_DISC = 121                        # punch radius -> ellipse in PRESETS
R_RING_OUT = 127                    # ring sits wholly outside the punch

DISC = (237, 237, 237)
RING = (226, 9, 29)                 # brand red sampled off "Your Name"

SS = 4                              # supersample factor for the circle

# --- header mark --------------------------------------------------------------
GLYPH_BOX = (1505, 705, 2100, 2035)  # the Ganesha symbol, in *native* pixels
GLYPH_H = 176                        # 4x its display height, for crisp scaling


def paint_out_icon(img):
    """Replace the grey icon with the paper behind it, row by row."""
    px = img.load()
    x0, y0, x1, y1 = ICON_BOX
    span = PAPER_R - PAPER_L
    for y in range(y0, y1):
        left = px[PAPER_L, y]
        right = px[PAPER_R, y]
        for x in range(x0, x1):
            t = (x - PAPER_L) / span
            px[x, y] = tuple(round(left[i] + (right[i] - left[i]) * t) for i in range(3))


def draw_circle(img):
    """Composite an antialiased disc + ring at the icon's old position."""
    cx, cy = CIRCLE
    pad = R_RING_OUT + 4
    size = pad * 2

    layer = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    mid = pad * SS

    def disc(r, fill):
        d.ellipse([mid - r * SS, mid - r * SS, mid + r * SS, mid + r * SS], fill=fill)

    disc(R_RING_OUT, RING + (255,))
    disc(R_DISC, DISC + (255,))  # leaves the ring as a clean annulus

    img.alpha_composite(layer.resize((size, size), Image.LANCZOS), (cx - pad, cy - pad))


def build(key, filename):
    img = Image.open(SRC / filename).convert("RGB").resize((OUT_W, OUT_H), Image.LANCZOS)
    paint_out_icon(img)
    img = img.convert("RGBA")
    draw_circle(img)

    dest = OUT / f"{key}-ganesh.png"
    img.convert("RGB").save(dest, optimize=True)
    print(f"{dest.name}: {img.width}x{img.height}")
    print(f"  ellipse: [{CIRCLE[0] - R_DISC}, {CIRCLE[1] - R_DISC}, "
          f"{CIRCLE[0] + R_DISC}, {CIRCLE[1] + R_DISC}]")


def _blobs(mask):
    """Yield each 4-connected run of True pixels as (rows, cols) index arrays."""
    import numpy as np
    from collections import deque

    h, w = mask.shape
    seen = np.zeros((h, w), bool)
    for sy, sx in zip(*np.nonzero(mask)):
        if seen[sy, sx]:
            continue
        seen[sy, sx] = True
        queue = deque([(sy, sx)])
        cells = []
        while queue:
            y, x = queue.popleft()
            cells.append((y, x))
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        ys, xs = zip(*cells)
        yield np.array(ys), np.array(xs)


def build_header(filename):
    """Lift the Ganesha symbol off the paper for the page header.

    A hard "is this pixel white?" cutout eats the thin, pale top of the swirl and
    the glyph reads as chopped off. So every pixel gets a soft alpha instead: how
    far its darkest channel falls below the paper, or how saturated it is,
    whichever says "ink" more loudly.

    That alone also picks up the out-of-focus plant sharing the right of the
    crop -- its warm highlights are the same pale cream as the symbol's softest
    edges, so no per-pixel rule separates them. What does separate them is shape:
    the symbol sits wholly inside the crop, while the plant and the glow pooled
    under the tail run off its edges. So the solid ink is split into blobs and
    only the ones clear of every border are kept.
    """
    import numpy as np

    glyph = Image.open(SRC / filename).convert("RGB").crop(GLYPH_BOX)
    a = np.asarray(glyph).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lo, hi = a.min(2), a.max(2)
    sat = hi - lo

    PAPER, INK = 248, 70            # darkest channel: paper vs solid ink
    SAT_FULL = 90                   # saturation that counts as fully opaque
    WARMTH = 18                     # least red-over-blue the symbol's ink shows
    MIN_BLOB = 500                  # smaller than the bindi: sensor speckle

    alpha = np.maximum((PAPER - lo) / (PAPER - INK), sat / SAT_FULL).clip(0, 1)
    warm = (g < r) & (r - b >= WARMTH)
    weak = warm & (alpha > 0.18)                       # ink, plus some haze
    seed = weak & (sat > 55) & (r - b > 55)            # unmistakably the symbol

    keep = np.zeros_like(seed)
    for blob in _blobs(seed):
        ys, xs = blob
        if len(ys) < MIN_BLOB:
            continue
        if xs.min() == 0 or ys.min() == 0 or xs.max() == seed.shape[1] - 1 or ys.max() == seed.shape[0] - 1:
            continue
        keep[ys, xs] = True

    for _ in range(4):              # recover the soft fringe around the ink
        grown = keep.copy()
        grown[1:] |= keep[:-1]
        grown[:-1] |= keep[1:]
        grown[:, 1:] |= keep[:, :-1]
        grown[:, :-1] |= keep[:, 1:]
        keep = grown & weak

    rgba = np.dstack([a, np.where(keep, alpha * 255, 0).round()]).astype("uint8")
    out = Image.fromarray(rgba, "RGBA")
    out.thumbnail((GLYPH_H, GLYPH_H), Image.LANCZOS)
    dest = OUT / "header-ganesh.png"
    out.save(dest, optimize=True)
    print(f"{dest.name}: {out.width}x{out.height}")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for key, filename in SOURCES.items():
        build(key, filename)
    build_header(SOURCES["doctor"])
