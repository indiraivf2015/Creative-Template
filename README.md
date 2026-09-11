# Creative Studio

Drops an employee photo and their name / designation onto official campaign
artwork, then downloads a PNG.

The site has **two routes, and only two**:

| Route | Who | What they can do |
|---|---|---|
| `/admin` | Campaign admin, behind a PIN | Upload artwork, place the photo hole and name lines, generate a public link per layout |
| `/t/<id>` | Everyone else | Add a photo, name and designation to **that one layout**, download the PNG |

Anyone landing on `/` with no link gets a short notice pointing them back to
whoever runs the campaign.

An employee opening `/t/<id>` cannot switch layouts, move anything, or reach
Template Manager. Their photo and typed name never leave their browser — the
page renders the PNG locally and nothing is uploaded.

## The flow

1. Admin opens `/admin`, enters the PIN.
2. **New template** → drop in the festival artwork.
3. Drag the photo circle and the name / designation boxes onto the printed slots.
4. **Save** — the share dialog opens with the link, e.g.
   `https://your-site.vercel.app/t/t-9f2a4c8b`.
5. Send that link to the people it is for. Each layout has its own link.

Built-in layouts are linkable too: `/t/doctor` and `/t/employee`.

## Setup (once, on Vercel)

Both of these are required. Without them the admin can still lay out a template,
but it stays in that one browser and the links will not open for anyone else.

1. **Storage** → **Blob** → create a store. This injects `BLOB_READ_WRITE_TOKEN`.
2. **Settings** → **Environment Variables** → add `ADMIN_PIN`.
3. Redeploy.

`ADMIN_PIN` is checked **on the server**, on every create, edit and delete. The
browser only holds it for the tab (`sessionStorage`) so later saves can present
it. `ADMIN_PASSWORD` is still accepted as an older name for the same variable.

## What you get

- Public link scoped to exactly one layout
- PIN-gated Template Manager with live artwork upload and position editing
- Doctor and Employee Ganesh Chaturthi layouts built in
- Photo fills a circular hole; the printed ring stays on top
- Printed placeholders (`Your Name`, `Designation`) are wiped only when that field is filled
- Optional Excel / ZIP batch, off by default (`EXCEL_ENABLE`)

## Run it locally

The `/api/*` routes are Vercel serverless functions, so a plain static server
gives you the pages but not saving:

```bat
npm install
npx vercel dev
```

Then `http://localhost:3000/`, `/admin`, `/t/doctor`.

`start.bat` (Python static server) still serves the pages, but `/api/*`,
`/admin` and `/t/<id>` will not route — those come from `vercel.json`.

Copy `.env.example` to `.env` for local `vercel dev`. Never commit a real `.env`.

## Files

| Path | Role |
|---|---|
| `index.html` | `/` — "you need a campaign link" notice |
| `Indira_Creative_Studio.html` | `/t/<id>` — the scoped public studio |
| `admin.html` | `/admin` — Template Manager, PIN gated |
| `js/ics.js` | Shared catalog, drawing, punch-hole, `loadOne`, `publicLink` |
| `templates/catalog.json` | Built-in layouts and their position metadata |
| `templates/*.png` | Built-in artwork |
| `api/templates.js` | `GET` list (public), `POST` create (PIN) |
| `api/templates/[id].js` | `GET` one (public), `PUT` / `DELETE` (PIN) |
| `api/admin/login.js` | `POST` — PIN check for the admin unlock screen |
| `lib/server.js` | PIN enforcement, DTO validation, Blob catalog helpers |
| `tools/prepare_templates.py` | Optional: builds `templates/*.png` from official artwork |
| `start.bat` | Local static server (pages only, no API) |
| `vercel.json` | `/admin` and `/t/:id` rewrites |
| `.env.example` | `ADMIN_PIN` and Blob token placeholders |

## Where templates live

Merged in this order, last wins:

1. **Built-in** — `templates/catalog.json`, shipped in the repo.
2. **Server** — Vercel Blob (`ics/catalog.json` + `ics/images/`), shared by everyone.
3. **This browser** — IndexedDB, only when the server is unreachable.

A public link resolves against 1 and 2. A layout that only exists in tier 3 will
404 for everyone but the admin who made it, which is why Blob is required.

## Add a layout

1. `/admin`, enter the PIN.
2. **New template**, drop the artwork in.
3. Drag the cyan circle onto the printed photo slot; drag a corner to resize.
4. Drag the name and designation boxes onto the printed lines. Box height sets
   the font size, box width sets the wrap width.
5. Set colours, alignment, and the optional Location line on the right.
6. **Save**, then copy the link from the dialog.

Do not reuse Ganesh Chaturthi `ellipse` / `textX` / `textCover` values on
different artwork — place them visually. Add `loc` only if the artwork prints a
location line; the Location field and the download gate both key off it.

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

You do not need a second deploy. One site holds every campaign: add the new
artwork in Template Manager, place the hole and nameplate, and send out that
layout's own `/t/<id>` link. Old links keep working, each scoped to its own
layout.

Only copy the folder if a campaign genuinely needs its own domain or its own
PIN. Then change the title, header copy, and `VERSION` for the new campaign
name.

## Geometry (`templates/catalog.json`)

Coordinates are in **native template pixels**. Each layout stores its own plate. The built-in Ganesh Chaturthi layouts share one nameplate:

```js
{
  baseW: 1169, aspect: 1169 / 1460,
  ellipse: [46, 925, 288, 1167],   // photo hole = the circle drawn into the PNG
  holeInset: 0,                    // 0 = punch the full ellipse
  align: "left", textX: 369,       // left edge of both printed lines
  maxW: 380,                       // max name width before the font shrinks
  name: { baseline: 1042, size: 35, weight: 700, fill: "#E10A1D", font: "…" },
  desg: { baseline: 1080, size: 29, weight: 500, fill: "#163B66", font: "…" },
  paperY: [985, 1014],             // clean paper rows ABOVE the name (no letters)
  paperMaxX: 700,                  // stop before artwork on the right
  textCover: [
    { box: [355, 1010, 554, 1049] },  // covers printed "Your Name"
    { box: [357, 1051, 528, 1093] }   // covers printed "Designation"
  ]
}
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

### Branding knobs

| Knob | Where | What to change |
|---|---|---|
| Page title / header | header HTML in all three pages | Campaign name |
| Accent colours | `:root` `--accent`, `--cream` | Brand |
| Location line | Template Manager “Location line”, or `plate.loc` | Omit it when the artwork has none |
| Excel / ZIP | `EXCEL_ENABLE` | `true` for team batch |

The public page takes its layout from the link, so there is no "default layout"
to set — `/t/<id>` names it, and the tab title becomes the layout's label.

### Deploy

Static pages plus Vercel serverless (`/api/*`). `vercel.json` rewrites `/admin`
to Template Manager and `/t/:id` to the studio; `/` falls through to
`index.html`. The studio carries `<base href="/">` so its assets and fetches
resolve from the root rather than from `/t/`.

After deploy, hard-refresh so browsers do not keep an old copy of a page. Set
Blob + `ADMIN_PIN` before expecting shared saves or working links.

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

The button enables when **photo, name, and designation** are all filled (plus
Location, on layouts that define one). You can download again after the first
save.

Open the HTML in Chrome (not only an iframe preview) for one-click save. Preview
frames can block downloads.
