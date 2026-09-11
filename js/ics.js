"use strict";
/* Shared Creative Studio helpers: catalog, drawing, uploads, local fallback. */
(function (global) {
  const DEFAULT_FONT = "Figtree, Poppins, Arial, sans-serif";
  const CLIP_BLEED = 1.5;
  const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
  const MAX_BODY_BYTES = 3.5 * 1024 * 1024;
  const MAX_IMAGE_EDGE = 1600;
  const IDB_NAME = "ics-templates";
  const IDB_STORE = "templates";
  const ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
  const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const WEIGHTS = { 400: 400, 500: 500, 600: 600, 700: 700 };

  function finiteNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }
  function round4(n) {
    return Math.round(Number(n) * 10000) / 10000;
  }
  function absUrl(u) {
    u = String(u || "");
    if (!u || /^(https?:|blob:|data:|\/)/i.test(u)) return u;
    return "/" + u.replace(/^\.?\//, "");
  }
  /* A path into the repo's own templates/ folder, in either the repo-relative
     form from catalog.json or the root-relative form the API hands back. */
  function isBuiltinPath(u) {
    return /^\/?templates\//.test(String(u || ""));
  }
  function publicLink(id, origin) {
    const base = String(origin || (global.location ? global.location.origin : "")).replace(/\/+$/, "");
    return base + "/t/" + encodeURIComponent(id);
  }
  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    (crypto || { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); } }).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function newTemplateId() {
    return "t-" + uuid().replace(/-/g, "").slice(0, 16);
  }

  function lineSpec(raw, fallback) {
    raw = raw && typeof raw === "object" ? raw : {};
    const spec = {
      baseline: finiteNum(raw.baseline, fallback.baseline),
      size: clamp(finiteNum(raw.size, fallback.size), 8, 200),
      weight: WEIGHTS[raw.weight] || fallback.weight,
      fill: HEX_RE.test(String(raw.fill || "")) ? String(raw.fill).toUpperCase() : fallback.fill,
      font: String(raw.font || fallback.font || DEFAULT_FONT).slice(0, 120)
    };
    if (raw.prefix != null) spec.prefix = String(raw.prefix).slice(0, 40);
    if (raw.textX != null) spec.textX = finiteNum(raw.textX, fallback.textX);
    if (raw.maxW != null) spec.maxW = finiteNum(raw.maxW, fallback.maxW);
    return spec;
  }

  function coverList(raw, w, h) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 8).map((c) => {
      const box = c && Array.isArray(c.box) ? c.box : c;
      let x0 = clamp(finiteNum(box[0], 0), 0, w);
      let y0 = clamp(finiteNum(box[1], 0), 0, h);
      let x1 = clamp(finiteNum(box[2], x0 + 10), 0, w);
      let y1 = clamp(finiteNum(box[3], y0 + 10), 0, h);
      if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
      if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
      return { box: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)] };
    }).filter((c) => c.box[2] - c.box[0] >= 2 && c.box[3] - c.box[1] >= 2);
  }

  function derivePaper(plate, w, h) {
    const covers = plate.textCover || [];
    if (!covers.length) {
      return {
        paperY: [Math.round(h * 0.67), Math.round(h * 0.69)],
        paperMaxX: Math.round(w * 0.6)
      };
    }
    let x1 = 0, y0 = h;
    covers.forEach((c) => {
      y0 = Math.min(y0, c.box[1]);
      x1 = Math.max(x1, c.box[2]);
    });
    const top = Math.max(0, y0 - 40);
    const bot = Math.max(top + 1, y0 - 10);
    return {
      paperY: [Math.round(top), Math.round(bot)],
      paperMaxX: Math.round(clamp(x1 + 40, 40, w - 1))
    };
  }

  function defaultPlate(w, h) {
    const sx = w / 1169;
    const sy = h / 1460;
    const sc = (sx + sy) / 2;
    return normalizePlate({
      ellipse: [46 * sx, 925 * sy, 288 * sx, 1167 * sy],
      holeInset: 0,
      align: "left",
      textX: 369 * sx,
      maxW: 380 * sx,
      name: { baseline: 1042 * sy, size: 35 * sc, weight: 700, fill: "#E10A1D", font: DEFAULT_FONT },
      desg: { baseline: 1080 * sy, size: 29 * sc, weight: 500, fill: "#163B66", font: DEFAULT_FONT },
      paperY: [985 * sy, 1014 * sy],
      paperMaxX: 700 * sx,
      textCover: [
        { box: [355 * sx, 1010 * sy, 554 * sx, 1049 * sy] },
        { box: [357 * sx, 1051 * sy, 528 * sx, 1093 * sy] }
      ]
    }, w, h);
  }

  function normalizePlate(raw, w, h) {
    raw = raw && typeof raw === "object" ? raw : {};
    w = Math.max(1, finiteNum(w, finiteNum(raw.baseW, 1169)));
    h = Math.max(1, finiteNum(h, w / (finiteNum(raw.aspect, 1169 / 1460))));
    const ell = Array.isArray(raw.ellipse) ? raw.ellipse : [w * 0.04, h * 0.63, w * 0.25, h * 0.8];
    let x0 = clamp(finiteNum(ell[0], 0), 0, w - 8);
    let y0 = clamp(finiteNum(ell[1], 0), 0, h - 8);
    let x1 = clamp(finiteNum(ell[2], x0 + 80), 8, w);
    let y1 = clamp(finiteNum(ell[3], y0 + 80), 8, h);
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
    if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
    if (x1 - x0 < 16) x1 = Math.min(w, x0 + 16);
    if (y1 - y0 < 16) y1 = Math.min(h, y0 + 16);
    const name = lineSpec(raw.name, { baseline: h * 0.71, size: 35, weight: 700, fill: "#E10A1D", font: DEFAULT_FONT });
    const desg = lineSpec(raw.desg, { baseline: h * 0.74, size: 29, weight: 500, fill: "#163B66", font: DEFAULT_FONT });
    const plate = {
      baseW: Math.round(w),
      aspect: round4(w / h),
      ellipse: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)],
      holeInset: clamp(finiteNum(raw.holeInset, 0), 0, 40),
      align: raw.align === "center" ? "center" : "left",
      textX: clamp(finiteNum(raw.textX, w * 0.32), 0, w),
      maxW: clamp(finiteNum(raw.maxW, w * 0.32), 20, w),
      name,
      desg,
      textCover: coverList(raw.textCover, w, h)
    };
    if (raw.loc && typeof raw.loc === "object") {
      plate.loc = lineSpec(raw.loc, { baseline: desg.baseline + 36, size: 24, weight: 500, fill: "#163B66", font: DEFAULT_FONT });
      if (!plate.loc.prefix) plate.loc.prefix = "";
    }
    function boxLine(spec, rawLine) {
      spec.textX = clamp(finiteNum(rawLine && rawLine.textX, plate.textX), 0, w);
      spec.maxW = clamp(finiteNum(rawLine && rawLine.maxW, plate.maxW), 20, w);
    }
    boxLine(name, raw.name);
    boxLine(desg, raw.desg);
    if (plate.loc) boxLine(plate.loc, raw.loc);
    const paper = derivePaper(plate, w, h);
    plate.paperY = Array.isArray(raw.paperY) && raw.paperY.length === 2
      ? [Math.round(clamp(finiteNum(raw.paperY[0], paper.paperY[0]), 0, h)), Math.round(clamp(finiteNum(raw.paperY[1], paper.paperY[1]), 0, h))]
      : paper.paperY;
    plate.paperMaxX = raw.paperMaxX != null
      ? Math.round(clamp(finiteNum(raw.paperMaxX, paper.paperMaxX), 0, w - 1))
      : paper.paperMaxX;
    return plate;
  }

  function plateDto(plate) {
    const out = {
      baseW: plate.baseW,
      aspect: plate.aspect,
      ellipse: plate.ellipse.slice(),
      holeInset: plate.holeInset,
      align: plate.align,
      textX: plate.textX,
      maxW: plate.maxW,
      name: Object.assign({}, plate.name),
      desg: Object.assign({}, plate.desg),
      paperY: plate.paperY.slice(),
      paperMaxX: plate.paperMaxX,
      textCover: (plate.textCover || []).map((c) => ({ box: c.box.slice() }))
    };
    if (plate.loc) out.loc = Object.assign({}, plate.loc);
    return out;
  }

  function readDataURL(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error("read failed"));
      fr.readAsDataURL(file);
    });
  }
  function readArrayBuffer(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error("read failed"));
      fr.readAsArrayBuffer(file);
    });
  }
  function sniffImage(bytes) {
    if (!bytes || bytes.length < 12) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
    return null;
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("decode failed"));
      img.src = src;
    });
  }
  async function fileToImage(file) {
    try { return await loadImage(await readDataURL(file)); }
    catch (e) { return await createImageBitmap(file); }
  }
  function downscale(img, max) {
    const k = Math.min(1, (max || MAX_IMAGE_EDGE) / Math.max(img.width, img.height));
    if (k === 1 && img instanceof HTMLCanvasElement) return img;
    if (k === 1 && !(img instanceof HTMLCanvasElement)) {
      const passthrough = document.createElement("canvas");
      passthrough.width = img.width;
      passthrough.height = img.height;
      passthrough.getContext("2d").drawImage(img, 0, 0);
      return passthrough;
    }
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  function canvasToBlob(canvas, type, quality) {
    return new Promise((res, rej) => {
      canvas.toBlob((b) => b ? res(b) : rej(new Error("encode failed")), type, quality);
    });
  }
  async function prepareUpload(file) {
    if (!file) throw new Error("Choose a PNG, JPG, or WEBP image.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("That file is over 8 MB — compress it and try again.");
    const buf = new Uint8Array(await readArrayBuffer(file));
    const mime = sniffImage(buf);
    if (!mime) throw new Error("Only PNG, JPG, or WEBP templates are allowed.");
    const img = await fileToImage(new Blob([buf], { type: mime }));
    const canvas = downscale(img, MAX_IMAGE_EDGE);
    let blob = await canvasToBlob(canvas, "image/jpeg", 0.88);
    if (blob.size > MAX_BODY_BYTES) blob = await canvasToBlob(canvas, "image/jpeg", 0.72);
    if (blob.size > MAX_BODY_BYTES) throw new Error("The image is still too large after compress — try a smaller file.");
    return {
      dataUrl: await readDataURL(blob),
      blob,
      width: canvas.width,
      height: canvas.height,
      mime: "image/jpeg"
    };
  }

  function punchHole(img, ellipse, inset) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const [x0, y0, x1, y1] = ellipse;
    const pad = inset == null ? 0 : inset;
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.max(4, (x1 - x0) / 2 - pad), Math.max(4, (y1 - y0) / 2 - pad), 0, 0, Math.PI * 2);
    ctx.fill();
    return c;
  }

  function contentBox(img) {
    const w = img.width, h = img.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    const cr = data[0], cg = data[1], cb = data[2];
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 24) continue;
        if (Math.abs(data[i] - cr) + Math.abs(data[i + 1] - cg) + Math.abs(data[i + 2] - cb) < 30) continue;
        n++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    if (n < 80 || (x1 - x0) < w * 0.28 || (y1 - y0) < h * 0.28) return { x: 0, y: 0, w, h };
    const padX = Math.round((x1 - x0) * 0.02);
    const padY = Math.round((y1 - y0) * 0.02);
    x0 = Math.max(0, x0 - padX);
    y0 = Math.max(0, y0 - padY);
    x1 = Math.min(w - 1, x1 + padX);
    y1 = Math.min(h - 1, y1 + padY);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function makePhoto(src) {
    return { src, zoom: 1, dx: 0, dy: 0, box: contentBox(src) };
  }

  function isPaperPx(r, g, b) {
    const avg = (r + g + b) / 3;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    return avg >= 208 && sat <= 58 && (r - g) < 32 && (r - b) < 58;
  }
  function pickPaper(src, w, h, x, y, paperY0, paperY1, paperMaxX) {
    const xx = Math.max(0, Math.min(w - 1, Math.min(x, paperMaxX)));
    const span = Math.max(1, paperY1 - paperY0);
    for (let k = 0; k < span; k++) {
      const sy = paperY0 + ((y + k) % span);
      if (sy < 0 || sy >= h) continue;
      const i = (sy * w + xx) * 4;
      if (isPaperPx(src[i], src[i + 1], src[i + 2]) && (src[i] - src[i + 1]) < 28) return i;
    }
    for (let lx = xx - 1; lx >= Math.max(0, xx - 52); lx--) {
      const i = (y * w + lx) * 4;
      if (isPaperPx(src[i], src[i + 1], src[i + 2])) return i;
    }
    return (Math.max(0, paperY0) * w + xx) * 4;
  }
  function coverPlaceholderLines(ctx, orig, covers, filled, paperY, paperMaxX) {
    if (!orig || !covers || !covers.length || !filled.some(Boolean)) return;
    const w = orig.width, h = orig.height;
    const tmp = document.createElement("canvas");
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.drawImage(orig, 0, 0);
    const src = tctx.getImageData(0, 0, w, h).data;
    const dest = ctx.getImageData(0, 0, w, h);
    const out = dest.data;
    const band = paperY && paperY.length === 2 ? paperY : [covers[0].box[1] - 14, covers[0].box[1] - 2];
    const maxX = paperMaxX == null ? w - 1 : paperMaxX;
    let boxes = [];
    if (filled.length === covers.length && filled.every(Boolean)) {
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      covers.forEach((c) => {
        x0 = Math.min(x0, c.box[0]); y0 = Math.min(y0, c.box[1]);
        x1 = Math.max(x1, c.box[2]); y1 = Math.max(y1, c.box[3]);
      });
      boxes.push([x0, y0, x1, y1]);
    } else {
      covers.forEach((c, idx) => { if (filled[idx]) boxes.push(c.box); });
    }
    boxes.forEach((box) => {
      let [x0, y0, x1, y1] = box;
      x0 = Math.max(0, x0); y0 = Math.max(0, y0);
      x1 = Math.min(w, x1); y1 = Math.min(h, y1);
      if (x1 - x0 < 2 || y1 - y0 < 2) return;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const pi = pickPaper(src, w, h, x, y, band[0], band[1], maxX);
          const i = (y * w + x) * 4;
          out[i] = src[pi];
          out[i + 1] = src[pi + 1];
          out[i + 2] = src[pi + 2];
        }
      }
    });
    ctx.putImageData(dest, 0, 0);
  }

  function fitFont(ctx, text, spec, k, maxW) {
    const fam = spec.font || DEFAULT_FONT;
    let size = spec.size * k;
    for (;;) {
      ctx.font = spec.weight + " " + size.toFixed(1) + "px " + fam;
      if (ctx.measureText(text).width <= maxW * k || size <= 13 * k) return;
      size -= 0.5;
    }
  }

  function drawPhotoRing(ctx, plate) {
    const ell = plate && plate.ellipse;
    if (!ell || ell.length !== 4) return;
    const [x0, y0, x1, y1] = ell;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    const w = plate.ringWidth == null ? 8 : Number(plate.ringWidth);
    if (!Number.isFinite(w) || w <= 0) return;
    ctx.save();
    ctx.strokeStyle = plate.ringFill || "#E10A1D";
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(4, rx + w / 2), Math.max(4, ry + w / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function sampleSilhouette(size) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#D9D9D9";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#A8A8A8";
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.36, size * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(size * 0.5, size * 0.82, size * 0.28, size * 0.28, 0, Math.PI, 0);
    ctx.fill();
    return c;
  }

  function drawCreative(ctx, W, person, tplRaw, tplPunched, plate) {
    const p = plate;
    const art = tplRaw || tplPunched;
    const artW = art.width, artH = art.height;
    const native = document.createElement("canvas");
    native.width = artW;
    native.height = artH;
    const nctx = native.getContext("2d");
    nctx.imageSmoothingEnabled = true;
    if (nctx.imageSmoothingQuality) nctx.imageSmoothingQuality = "high";

    if (person && person.photo) {
      const [x0, y0, x1, y1] = p.ellipse;
      const pw = x1 - x0, ph = y1 - y0;
      const s = person.photo.src;
      const box = person.photo.box || { x: 0, y: 0, w: s.width, h: s.height };
      const cover = Math.max(pw / box.w, ph / box.h) * person.photo.zoom;
      nctx.save();
      nctx.beginPath();
      nctx.ellipse(x0 + pw / 2, y0 + ph / 2, pw / 2 + CLIP_BLEED, ph / 2 + CLIP_BLEED, 0, 0, Math.PI * 2);
      nctx.clip();
      nctx.drawImage(
        s, box.x, box.y, box.w, box.h,
        x0 + pw / 2 - box.w * cover / 2 + person.photo.dx,
        y0 + ph / 2 - box.h * cover / 2 + person.photo.dy,
        box.w * cover, box.h * cover
      );
      nctx.restore();
    }

    nctx.drawImage(person && person.photo ? tplPunched : (tplRaw || tplPunched), 0, 0);
    drawPhotoRing(nctx, p);

    const name = person && String(person.name || "").trim();
    const desg = person && String(person.desg || "").trim();
    const loc = p.loc && person && String(person.loc || "").trim();
    const filled = p.loc ? [!!name, !!desg, !!loc] : [!!name, !!desg];
    coverPlaceholderLines(nctx, tplRaw, p.textCover || [], filled, p.paperY, p.paperMaxX);

    nctx.textAlign = p.align === "center" ? "center" : "left";
    nctx.textBaseline = "alphabetic";
    function drawLine(text, spec) {
      if (!text) return;
      const tx = spec.textX != null ? spec.textX : p.textX;
      const mw = spec.maxW != null ? spec.maxW : p.maxW;
      nctx.fillStyle = spec.fill;
      fitFont(nctx, text, spec, 1, mw);
      nctx.fillText(text, tx, spec.baseline);
    }
    drawLine(name, p.name);
    drawLine(desg, p.desg);
    if (loc) drawLine((p.loc.prefix || "") + loc, p.loc);

    ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";
    const H = artH * (W / artW);
    ctx.drawImage(native, 0, 0, W, H);
  }

  function publicTemplate(row) {
    return {
      id: row.id,
      label: row.label,
      imageUrl: row.imageUrl,
      builtin: !!row.builtin,
      source: row.source || (row.builtin ? "builtin" : "remote"),
      plate: plateDto(row.plate)
    };
  }

  function openDb() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: "id" });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error("IndexedDB unavailable"));
    });
  }
  const idb = {
    async list() {
      try {
        const db = await openDb();
        return await new Promise((res, rej) => {
          const tx = db.transaction(IDB_STORE, "readonly");
          const req = tx.objectStore(IDB_STORE).getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => rej(req.error);
        });
      } catch (e) { return []; }
    },
    async get(id) {
      const db = await openDb();
      return await new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(id);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => rej(req.error);
      });
    },
    async put(row) {
      const db = await openDb();
      return await new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(row);
        tx.oncomplete = () => res(row);
        tx.onerror = () => rej(tx.error);
      });
    },
    async remove(id) {
      const db = await openDb();
      return await new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    }
  };

  const blobUrls = new Map();
  function revokeUrl(id) {
    const u = blobUrls.get(id);
    if (u) { URL.revokeObjectURL(u); blobUrls.delete(id); }
  }
  function objectUrlFor(id, blob) {
    revokeUrl(id);
    const u = URL.createObjectURL(blob);
    blobUrls.set(id, u);
    return u;
  }

  async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    return { ok: r.ok, status: r.status, body };
  }

  function adminHeaders(password, json) {
    const h = {};
    if (json) h["content-type"] = "application/json";
    if (password) h["x-admin-key"] = password;
    return h;
  }

  const api = {
    async probe() {
      try {
        const { ok, status, body } = await fetchJson("/api/templates");
        if (ok) return { available: true, storage: (body && body.storage) || "blob", templates: (body && body.templates) || [] };
        if (status === 404 || status === 503) return { available: false, storage: "local", templates: [] };
        return { available: false, storage: "local", templates: [] };
      } catch (e) {
        return { available: false, storage: "local", templates: [] };
      }
    },
    async getTemplate(id) {
      try {
        const { ok, body } = await fetchJson("/api/templates/" + encodeURIComponent(id), { cache: "no-store" });
        return ok && body && body.template ? body.template : null;
      } catch (e) {
        return null;
      }
    },
    async login(password) {
      try {
        const { ok, status, body } = await fetchJson("/api/admin/login", {
          method: "POST",
          headers: adminHeaders(password, true),
          body: JSON.stringify({ password: String(password || "") })
        });
        if (ok) return { mode: "live" };
        if (status === 401) return { mode: "denied", message: (body && body.error && body.error.message) || "Wrong password." };
        if (status === 404 || status === 503 || status === 405) return { mode: "local", message: (body && body.error && body.error.message) || "" };
        return { mode: "local" };
      } catch (e) {
        return { mode: "local" };
      }
    },
    async create(payload, password) {
      return fetchJson("/api/templates", {
        method: "POST",
        headers: adminHeaders(password, true),
        body: JSON.stringify(payload)
      });
    },
    async update(id, payload, password) {
      return fetchJson("/api/templates/" + encodeURIComponent(id), {
        method: "PUT",
        headers: adminHeaders(password, true),
        body: JSON.stringify(payload)
      });
    },
    async remove(id, password) {
      return fetchJson("/api/templates/" + encodeURIComponent(id), {
        method: "DELETE",
        headers: adminHeaders(password, false)
      });
    }
  };

  async function loadBuiltins() {
    try {
      const r = await fetch("templates/catalog.json", { cache: "no-store" });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data.templates) ? data.templates.map((t) => ({
        id: t.id,
        label: t.label,
        imageUrl: t.imageUrl,
        builtin: true,
        source: "builtin",
        plate: normalizePlate(t.plate, t.plate && t.plate.baseW, t.plate && t.plate.baseW / (t.plate && t.plate.aspect || 1169 / 1460))
      })) : [];
    } catch (e) { return []; }
  }

  async function localAsTemplates() {
    const rows = await idb.list();
    const out = [];
    for (const row of rows) {
      if (!row || !row.id) continue;
      const imageUrl = row.imageBlob ? objectUrlFor(row.id, row.imageBlob) : row.imageUrl;
      out.push({
        id: row.id,
        label: row.label || "Untitled",
        imageUrl,
        builtin: false,
        source: "local",
        plate: normalizePlate(row.plate, row.plate && row.plate.baseW)
      });
    }
    return out;
  }

  function mergeCatalog(builtins, remote, local) {
    const map = new Map();
    builtins.forEach((t) => map.set(t.id, t));
    (remote || []).forEach((t) => {
      if (!t || !t.id) return;
      const plate = normalizePlate(t.plate, t.plate && t.plate.baseW);
      map.set(t.id, {
        id: t.id,
        label: String(t.label || t.id).slice(0, 80),
        imageUrl: t.imageUrl || (map.get(t.id) && map.get(t.id).imageUrl) || "",
        builtin: !!(map.get(t.id) && map.get(t.id).builtin && isBuiltinPath(t.imageUrl)),
        source: "remote",
        plate
      });
    });
    (local || []).forEach((t) => {
      if (!t || !t.id) return;
      const prev = map.get(t.id);
      if (prev && prev.source === "remote") return;
      map.set(t.id, t);
    });
    return [...map.values()];
  }

  async function loadCatalog() {
    const builtins = await loadBuiltins();
    const probe = await api.probe();
    const local = probe.available && probe.storage === "blob" ? [] : await localAsTemplates();
    const list = mergeCatalog(builtins, probe.templates, local);
    return { templates: list, storage: probe.available ? probe.storage : "local", api: probe.available };
  }

  /* One template by id — what the scoped public link at /t/<id> loads.
     Server first (the shared copy everyone sees), then the repo built-ins, then
     this browser's own drafts so an admin can preview a link before Blob is set. */
  async function loadOne(id) {
    if (!id || !ID_RE.test(id)) return null;
    const remote = await api.getTemplate(id);
    if (remote) {
      return {
        id: remote.id,
        label: String(remote.label || remote.id).slice(0, 80),
        imageUrl: absUrl(remote.imageUrl),
        builtin: !!remote.builtin,
        source: remote.builtin ? "builtin" : "remote",
        plate: normalizePlate(remote.plate, remote.plate && remote.plate.baseW)
      };
    }
    const builtin = (await loadBuiltins()).find((t) => t.id === id);
    if (builtin) return Object.assign({}, builtin, { imageUrl: absUrl(builtin.imageUrl) });
    return (await localAsTemplates()).find((t) => t.id === id) || null;
  }

  async function saveLocal(entry) {
    const row = {
      id: entry.id,
      label: entry.label,
      plate: plateDto(entry.plate),
      imageUrl: entry.keepImageUrl || "",
      imageBlob: entry.imageBlob || null,
      updatedAt: new Date().toISOString()
    };
    await idb.put(row);
    if (row.imageBlob) row.imageUrl = objectUrlFor(row.id, row.imageBlob);
    return row;
  }

  global.ICS = {
    DEFAULT_FONT,
    CLIP_BLEED,
    ID_RE,
    uuid,
    newTemplateId,
    finiteNum,
    clamp,
    defaultPlate,
    normalizePlate,
    plateDto,
    derivePaper,
    readDataURL,
    loadImage,
    fileToImage,
    downscale,
    prepareUpload,
    sniffImage,
    punchHole,
    contentBox,
    makePhoto,
    coverPlaceholderLines,
    fitFont,
    drawCreative,
    drawPhotoRing,
    sampleSilhouette,
    publicTemplate,
    absUrl,
    isBuiltinPath,
    publicLink,
    loadCatalog,
    loadOne,
    loadBuiltins,
    mergeCatalog,
    saveLocal,
    idb,
    api,
    adminHeaders
  };
})(typeof window !== "undefined" ? window : globalThis);
