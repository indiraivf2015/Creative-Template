# Creative Studio template

A static, in-browser studio that drops a photo and a name / designation onto official campaign artwork, then downloads a PNG.

This Ganesh Chaturthi build is one instance of that studio. Copy the folder and swap artwork + numbers to reuse it for Diwali, Independence Day, Doctors’ Day, or any other card.

Photos and text stay in the browser. Nothing is uploaded to a server.

## What you get

- Solo mode: upload one photo, type name / designation, download PNG
- Optional Excel / ZIP batch (off by default)
- Doctor and Employee layouts for the same festival
- Photo fills a circular hole; the printed ring stays on top
- Printed placeholders (`Your Name`, `Designation`) are wiped only when that field is filled

## Run it

Needs Python 3 on the PATH.

```bat
start.bat
```

Or:

```bat
cd "C:\Ganesh Chaturthi_Indira"
python -m http.server 8765
```

Open **http://127.0.0.1:8765/** and hard-refresh after you edit the HTML.

`index.html` redirects to `Indira_Creative_Studio.html`.

## Files

| Path | Role |
|---|---|
| `Indira_Creative_Studio.html` | Whole app (UI + canvas) |
| `index.html` | Redirect into the studio |
| `templates/*.png` | Artwork the app draws (1169×1460) |
| `tools/prepare_templates.py` | Builds `templates/*.png` from the official artwork |
| `start.bat` | Local server |
| `vercel.json` | Optional host rewrite |

### The Ganesh Chaturthi templates

The official artwork (`Ganpati- Doctor creative.jpg` / `Ganpati- Employee creative.jpg`,
2338×2921) carries a flat grey person icon where the photo goes, not a circle.
`tools/prepare_templates.py` turns each one into a studio template:

1. scales the artwork to 1169×1460, the size the studio works at,
2. paints the grey icon out — the paper behind it is a flat `#FDFDFD`,
3. draws a light disc plus a brand-red ring in its place.

Steps 2 and 3 run in output pixels, so the circle drawn here and the hole
punched by the app share one coordinate system — no half-pixel drift. The
script prints the `ellipse` to paste into `PLATE`.

The disc is what you see before a photo is uploaded. The ring sits **outside**
the punched hole, so it survives the punch and frames the photo.

It also builds `header-ganesh.png`, the Ganesha mark in the page header. That
one is lifted off the photographic background with a soft alpha matte — a hard
"is this pixel white?" cutout eats the thin, pale top of the swirl and the
symbol reads as chopped off. The matte alone also drags in the out-of-focus
plant beside the symbol, whose warm highlights are the same pale cream as the
symbol's softest edges, so the solid ink is split into blobs and only the ones
clear of every crop border are kept.

Re-run it with:

```bat
python tools/prepare_templates.py
```

It reads the two JPGs from your `Downloads` folder. Point `SRC` somewhere else if
they live elsewhere.

## Reuse for another campaign

1. Copy this folder. Rename it, for example `Diwali_Template`.
2. Put the new official artwork in `templates/`, or adapt `tools/prepare_templates.py`.
3. In `Indira_Creative_Studio.html`, change the title, header copy, and `VERSION`.
4. Point `BUILTIN` at the new files and set the geometry (`PLATE` / `PRESETS`).
5. Add matching `<option>` rows in `#layoutSelect`.
6. Measure the photo hole and nameplate on the **new** artwork (see below). Do not
   reuse Ganesh Chaturthi `ellipse` / `textX` / `textCover` values.
7. Add `loc` to the preset only if the artwork prints a location line — the
   Location field and the download gate both key off it.
8. Run locally, type a short name and a long name, download a PNG, check both layouts.

### Geometry (`PLATE` / `PRESETS`)

Coordinates are in **native template pixels** (1169×1460 here). Both Ganesh
Chaturthi layouts share one nameplate, so they share one `PLATE` object.

```js
const PLATE = {
  baseW: 1169, aspect: 1169 / 1460,
  ellipse: [46, 925, 288, 1167],   // photo hole = the circle drawn into the PNG
  holeInset: 0,                    // 0 = punch the full ellipse
  align: 'left', textX: 369,       // left edge of both printed lines
  maxW: 380,                       // max name width before the font shrinks
  name: { baseline: 1042, size: 35, weight: 700, fill: '#E10A1D', font: '…' },
  desg: { baseline: 1080, size: 29, weight: 500, fill: '#163B66', font: '…' },
  paperY: [985, 1014],             // clean paper rows ABOVE the name (no letters)
  paperMaxX: 700,                  // stop before artwork on the right
  textCover: [
    { box: [355, 1010, 554, 1049] },  // covers printed "Your Name"
    { box: [357, 1051, 528, 1093] }   // covers printed "Designation"
  ]
};
```

How to measure:

- **ellipse** — the circular hole, matching the ring drawn by the build script.
- **textX / align** — `left` here: the x of the printed lines' left edge.
- **baselines** — Y of the official printed lines.
- **textCover** — boxes that fully cover `Your Name` / `Designation`, including
  anti-alias. The doctor and employee artwork set their text a few pixels apart,
  so these boxes are sized for the wider of the two; a tight box leaves a ghost
  of the `Y` and the `D` behind.
- **paperY** — a few rows of plain paper *above* the name and *below* any artwork.
  Never a row that still has printed text.

When name and designation are both filled, the studio wipes the whole nameplate
using paper sampled from `paperY`, then draws your two lines.

### Why the photo bleeds past the hole

`CLIP_BLEED` (1.5px) lets the photo run slightly wider than the punched hole.
The clip and the hole are both anti-aliased; matching them exactly leaves each
edge pixel partly transparent and a pale hairline shows between the photo and
the ring. The ring is drawn on top and hides the overrun.

### Branding and solo vs Excel

| Knob | Where | What to change |
|---|---|---|
| Page title / header | `<title>`, header HTML | Campaign name |
| Accent colours | `:root` `--accent`, `--cream` | Brand |
| Location line | `PRESETS.*.loc` | Omit it when the artwork has none |
| Excel / ZIP | `EXCEL_ENABLE` | `true` for team batch |
| Default layout | `geoKey` / `store.get('tpl', …)` | `'doctor'` or `'employee'` |

### Excel batch (optional)

Set `EXCEL_ENABLE = true`. The sheet needs:

- **Name** (or Employee Name / Doctor Name)
- **Employee ID** and/or **Document Name** (photo file stem)

Optional: designation, location / city / centre.

Photos match when the file name equals Document Name or contains the Employee ID.

## How drawing works

1. Photo is cover-scaled and clipped to `ellipse` (plus `CLIP_BLEED`).
2. A hole-punched copy of the template is drawn on top, so the ring stays above the photo.
3. Filled fields trigger `coverPlaceholderLines` so printed placeholders disappear without a grainy box.
4. Name (bold red) and designation (navy) are drawn from `textX`.
5. Preview scales that native canvas down. Download PNG is native size (1169×1460).

Do not paint random background, blit a scaled strip from another Y, or overwrite
the generated PNGs by hand. Those create a grainy / ghosted nameplate.

## Download PNG

The button enables when **photo, name, and designation** are all filled. You can
download again after the first save.

Open the HTML in Chrome (not only an iframe preview) for one-click save. Preview
frames can block downloads.

## Deploy

Static host (Vercel, Netlify, any file server). `vercel.json` already rewrites `/` to the studio.

After deploy, hard-refresh so browsers do not keep an old `Indira_Creative_Studio.html`.
