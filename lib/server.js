"use strict";

const crypto = require("crypto");
const { put, list, del } = require("@vercel/blob");

const CATALOG_PATH = "ics/catalog.json";      // legacy single-file catalog, read only
const CATALOG_PREFIX = "ics/catalog-v";       // current: one blob per saved version
const CATALOG_PREFIX_ALL = "ics/catalog";     // list() prefix covering both
const CATALOG_KEEP = 2;                       // recent versions retained on prune
const IMAGE_PREFIX = "ics/images/";
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const WEIGHTS = { 400: 400, 500: 500, 600: 600, 700: 700 };
const DEFAULT_FONT = "Figtree, Poppins, Arial, sans-serif";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const BUILTIN_IDS = new Set(["doctor", "employee"]);

function rootRelative(u) {
  u = String(u || "");
  if (!u || /^(https?:|data:|\/)/i.test(u)) return u;
  return "/" + u.replace(/^\.?\//, "");
}

let builtinCache = null;
function builtinRows() {
  if (builtinCache) return builtinCache;
  try {
    const data = require("../templates/catalog.json");
    builtinCache = Array.isArray(data.templates) ? data.templates : [];
  } catch (e) {
    builtinCache = [];
  }
  return builtinCache;
}

function builtinRow(id) {
  const hit = builtinRows().find((t) => t && t.id === id);
  if (!hit) return null;
  return {
    id: hit.id,
    label: hit.label,
    imageUrl: rootRelative(hit.imageUrl),
    imagePath: "",
    plate: hit.plate,
    builtin: true,
    updatedAt: null
  };
}

function json(res, status, body) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function bodyObject(req) {
  if (req.body == null || req.body === "") return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (e) { return null; }
  }
  if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString("utf8")); } catch (e) { return null; }
  }
  return {};
}

function finiteNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function adminKeyFromReq(req) {
  const h = req.headers["x-admin-key"];
  if (h) return String(Array.isArray(h) ? h[0] : h);
  const auth = req.headers.authorization;
  if (auth && String(auth).startsWith("Bearer ")) return String(auth).slice(7);
  const body = bodyObject(req);
  if (body && body.password != null) return String(body.password);
  return "";
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireStorage(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    json(res, 503, { error: { code: "NOT_CONFIGURED", message: "BLOB_READ_WRITE_TOKEN is not set." } });
    return false;
  }
  return true;
}

function adminPin() {
  return String(process.env.ADMIN_PIN || process.env.ADMIN_PASSWORD || "");
}

function requireAdmin(req, res) {
  if (!requireStorage(req, res)) return false;
  const expected = adminPin();
  if (!expected) {
    json(res, 503, {
      error: { code: "NOT_CONFIGURED", message: "ADMIN_PIN is not set on the server." }
    });
    return false;
  }
  const given = adminKeyFromReq(req);
  if (!given || !safeEqual(given, expected)) {
    json(res, 401, { error: { code: "UNAUTHORIZED", message: "Wrong PIN." } });
    return false;
  }
  return true;
}

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function decodeDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
  const sniff = sniffImage(buf);
  if (!sniff) return null;
  return { buffer: buf, mime: sniff };
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
  if (raw.maxW != null) spec.maxW = clamp(finiteNum(raw.maxW, fallback.maxW), 20, 4000);
  return spec;
}

function plateDto(raw) {
  if (!raw || typeof raw !== "object") {
    const err = new Error("plate is required");
    err.code = "INVALID";
    throw err;
  }
  const extra = Object.keys(raw).filter((k) => !allowedPlateKeys.has(k));
  if (extra.length) {
    const err = new Error("Unknown plate field: " + extra[0]);
    err.code = "INVALID";
    throw err;
  }
  const w = clamp(finiteNum(raw.baseW, 1169), 64, 4000);
  const aspect = clamp(finiteNum(raw.aspect, 1169 / 1460), 0.2, 3);
  const h = w / aspect;
  const ell = Array.isArray(raw.ellipse) ? raw.ellipse : null;
  if (!ell || ell.length !== 4) {
    const err = new Error("ellipse must be [x0, y0, x1, y1]");
    err.code = "INVALID";
    throw err;
  }
  let x0 = finiteNum(ell[0], NaN);
  let y0 = finiteNum(ell[1], NaN);
  let x1 = finiteNum(ell[2], NaN);
  let y1 = finiteNum(ell[3], NaN);
  if (![x0, y0, x1, y1].every(Number.isFinite)) {
    const err = new Error("ellipse values must be numbers");
    err.code = "INVALID";
    throw err;
  }
  if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
  if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
  if (x1 - x0 < 16 || y1 - y0 < 16) {
    const err = new Error("photo hole is too small");
    err.code = "INVALID";
    throw err;
  }
  const covers = Array.isArray(raw.textCover) ? raw.textCover.slice(0, 8) : [];
  const textCover = covers.map((c) => {
    const box = c && Array.isArray(c.box) ? c.box : null;
    if (!box || box.length !== 4 || !box.every((n) => Number.isFinite(Number(n)))) {
      const err = new Error("textCover boxes must be [x0, y0, x1, y1]");
      err.code = "INVALID";
      throw err;
    }
    return { box: box.map((n) => Math.round(Number(n))) };
  });
  const out = {
    baseW: Math.round(w),
    aspect: Math.round(aspect * 10000) / 10000,
    ellipse: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)],
    holeInset: clamp(finiteNum(raw.holeInset, 0), 0, 40),
    align: raw.align === "center" ? "center" : "left",
    textX: clamp(finiteNum(raw.textX, w * 0.32), 0, w),
    maxW: clamp(finiteNum(raw.maxW, w * 0.32), 20, w),
    name: lineSpec(raw.name, { baseline: h * 0.71, size: 35, weight: 700, fill: "#E10A1D", font: DEFAULT_FONT }),
    desg: lineSpec(raw.desg, { baseline: h * 0.74, size: 29, weight: 500, fill: "#163B66", font: DEFAULT_FONT }),
    textCover
  };
  if (raw.loc && typeof raw.loc === "object") {
    out.loc = lineSpec(raw.loc, { baseline: out.desg.baseline + 36, size: 24, weight: 500, fill: "#163B66", font: DEFAULT_FONT });
    if (!out.loc.prefix) out.loc.prefix = "";
  }
  function boxLine(spec, rawLine) {
    spec.textX = clamp(finiteNum(rawLine && rawLine.textX, out.textX), 0, w);
    spec.maxW = clamp(finiteNum(rawLine && rawLine.maxW, out.maxW), 20, w);
  }
  boxLine(out.name, raw.name);
  boxLine(out.desg, raw.desg);
  if (out.loc) boxLine(out.loc, raw.loc);
  if (Array.isArray(raw.paperY) && raw.paperY.length === 2) {
    out.paperY = [Math.round(finiteNum(raw.paperY[0], 0)), Math.round(finiteNum(raw.paperY[1], 0))];
  }
  if (raw.paperMaxX != null) out.paperMaxX = Math.round(finiteNum(raw.paperMaxX, w * 0.6));
  return out;
}

const allowedPlateKeys = new Set([
  "baseW", "aspect", "ellipse", "holeInset", "align", "textX", "maxW",
  "name", "desg", "loc", "paperY", "paperMaxX", "textCover"
]);
const allowedWriteKeys = new Set(["label", "plate", "imageBase64", "imageUrl"]);

function writeDto(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const err = new Error("JSON object required");
    err.code = "INVALID";
    throw err;
  }
  const extra = Object.keys(body).filter((k) => !allowedWriteKeys.has(k) && k !== "password");
  if (extra.length) {
    const err = new Error("Unknown field: " + extra[0]);
    err.code = "INVALID";
    throw err;
  }
  const dto = {};
  if (body.label != null) {
    const label = String(body.label).trim().slice(0, 80);
    if (!label) {
      const err = new Error("label is required");
      err.code = "INVALID";
      throw err;
    }
    dto.label = label;
  }
  if (body.plate != null) dto.plate = plateDto(body.plate);
  if (body.imageBase64 != null && body.imageBase64 !== "") {
    const decoded = decodeDataUrl(body.imageBase64);
    if (!decoded) {
      const err = new Error("image must be a PNG, JPG, or WEBP data URL under 4 MB");
      err.code = "INVALID";
      throw err;
    }
    dto.image = decoded;
  }
  if (body.imageUrl != null && body.imageUrl !== "") {
    // Built-in paths travel to the client root-relative ("/templates/x.png"),
    // so accept either form and store the repo-relative one.
    const url = String(body.imageUrl).replace(/^\//, "");
    if (!url.startsWith("templates/") || url.includes("..") || url.includes("\\")) {
      const err = new Error("imageUrl may only point at a built-in templates/ file");
      err.code = "INVALID";
      throw err;
    }
    dto.keepImageUrl = url;
  }
  return dto;
}

/* Every save writes a NEW catalog pathname instead of overwriting one.
   A blob that was ever stored with the default cache (one month) keeps being
   served from the edge even after it is overwritten with max-age=0 — so reads
   go stale, and since a save is read-modify-write, a stale read silently drops
   whatever another admin just added. Unique pathnames sidestep the edge cache
   entirely: list() is an API call and always reports the newest. */
async function listCatalogBlobs(token) {
  const listed = await list({ prefix: CATALOG_PREFIX_ALL, token, limit: 1000 });
  return listed.blobs || [];
}

async function fetchCatalogJson(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    return data && Array.isArray(data.templates) ? data : null;
  } catch (e) {
    return null;
  }
}

async function readCatalog() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { version: 1, templates: [] };
  const blobs = await listCatalogBlobs(token);

  const versioned = blobs
    .filter((b) => b.pathname.startsWith(CATALOG_PREFIX))
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  for (const b of versioned) {
    const data = await fetchCatalogJson(b.url);
    if (data) return { version: 1, templates: data.templates };
  }

  // One-time migration: the original single-file catalog.
  const legacy = blobs.find((b) => b.pathname === CATALOG_PATH);
  if (legacy) {
    const data = await fetchCatalogJson(legacy.url);
    if (data) return { version: 1, templates: data.templates };
  }
  return { version: 1, templates: [] };
}

async function writeCatalog(catalog) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const uploaded = await put(CATALOG_PREFIX + Date.now() + ".json", JSON.stringify(catalog), {
    access: "public",
    addRandomSuffix: true,
    token,
    contentType: "application/json",
    cacheControlMaxAge: 0
  });

  // Keep a couple of recent versions as a safety net, drop the rest.
  try {
    const stale = (await listCatalogBlobs(token))
      .filter((b) => b.pathname !== uploaded.pathname && b.pathname.startsWith(CATALOG_PREFIX))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .slice(CATALOG_KEEP);
    for (const b of stale) await del(b.pathname, { token });
  } catch (e) { /* pruning is best effort */ }
  return uploaded;
}

async function putImage(id, image) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const ext = image.mime === "image/png" ? "png" : image.mime === "image/webp" ? "webp" : "jpg";
  const pathname = IMAGE_PREFIX + id + "." + ext;
  // Random suffix, so replacing a layout's artwork lands on a fresh URL instead
  // of a month-cached copy of the old image. The caller deletes the previous
  // imagePath once the new one is stored.
  const uploaded = await put(pathname, image.buffer, {
    access: "public",
    addRandomSuffix: true,
    token,
    contentType: image.mime
  });
  return { imageUrl: uploaded.url, imagePath: uploaded.pathname };
}

async function deletePath(pathname) {
  if (!pathname || !pathname.startsWith(IMAGE_PREFIX)) return;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try { await del(pathname, { token }); } catch (e) { /* already gone */ }
}

function newId() {
  return "t-" + crypto.randomBytes(8).toString("hex");
}

function validateId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

function publicRow(row) {
  return {
    id: row.id,
    label: row.label,
    imageUrl: rootRelative(row.imageUrl),
    builtin: !!row.builtin,
    plate: row.plate,
    updatedAt: row.updatedAt || null
  };
}

module.exports = {
  json,
  bodyObject,
  requireAdmin,
  requireStorage,
  writeDto,
  readCatalog,
  writeCatalog,
  putImage,
  deletePath,
  newId,
  validateId,
  publicRow,
  builtinRow,
  builtinRows,
  BUILTIN_IDS,
  IMAGE_PREFIX
};
