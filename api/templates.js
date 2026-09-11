"use strict";

const {
  json, bodyObject, requireAdmin, writeDto, readCatalog, writeCatalog, putImage, newId, publicRow,
  builtinRows
} = require("../lib/server");

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const catalog = await readCatalog();
      const storage = process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";
      const saved = catalog.templates.map(publicRow);
      const savedIds = new Set(saved.map((t) => t.id));
      const builtins = builtinRows()
        .filter((t) => t && !savedIds.has(t.id))
        .map((t) => publicRow({ id: t.id, label: t.label, imageUrl: t.imageUrl, plate: t.plate, builtin: true }));
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, { templates: builtins.concat(saved), storage });
    } catch (e) {
      json(res, 500, { error: { code: "READ_FAILED", message: "Could not read templates." } });
    }
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    json(res, 405, { error: { code: "METHOD", message: "GET or POST only" } });
    return;
  }

  if (!requireAdmin(req, res)) return;

  let dto;
  try {
    const body = bodyObject(req);
    if (body == null) {
      json(res, 400, { error: { code: "INVALID", message: "JSON object required" } });
      return;
    }
    dto = writeDto(body);
  }
  catch (e) {
    json(res, e.code === "INVALID" ? 400 : 500, { error: { code: e.code || "INVALID", message: e.message } });
    return;
  }
  if (!dto.label || !dto.plate) {
    json(res, 400, { error: { code: "INVALID", message: "label and plate are required" } });
    return;
  }
  if (!dto.image && !dto.keepImageUrl) {
    json(res, 400, { error: { code: "INVALID", message: "Upload an image for a new template" } });
    return;
  }

  try {
    const id = newId();
    let imageUrl = dto.keepImageUrl || "";
    let imagePath = "";
    if (dto.image) {
      const uploaded = await putImage(id, dto.image);
      imageUrl = uploaded.imageUrl;
      imagePath = uploaded.imagePath;
    }
    const row = {
      id,
      label: dto.label,
      imageUrl,
      imagePath,
      plate: dto.plate,
      updatedAt: new Date().toISOString()
    };
    const catalog = await readCatalog();
    catalog.templates.push(row);
    await writeCatalog(catalog);
    json(res, 201, { template: publicRow(row) });
  } catch (e) {
    json(res, e.code === "NOT_CONFIGURED" ? 503 : 500, {
      error: { code: e.code || "WRITE_FAILED", message: e.message || "Could not save template." }
    });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: "4mb" } }
};
