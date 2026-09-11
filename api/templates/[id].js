"use strict";

const {
  json, bodyObject, requireAdmin, writeDto, readCatalog, writeCatalog, putImage, deletePath,
  validateId, publicRow, builtinRow, BUILTIN_IDS, IMAGE_PREFIX
} = require("../../lib/server");

module.exports = async function handler(req, res) {
  const id = req.query && req.query.id;
  if (!validateId(id)) {
    json(res, 400, { error: { code: "INVALID", message: "Invalid template id" } });
    return;
  }

  if (req.method === "GET") {
    try {
      const catalog = await readCatalog();
      const row = catalog.templates.find((t) => t.id === id) || builtinRow(id);
      if (!row) {
        json(res, 404, { error: { code: "NOT_FOUND", message: "Template not found" } });
        return;
      }
      json(res, 200, { template: publicRow(row) });
    } catch (e) {
      json(res, 500, { error: { code: "READ_FAILED", message: "Could not read template." } });
    }
    return;
  }

  if (req.method !== "PUT" && req.method !== "DELETE") {
    res.setHeader("allow", "GET, PUT, DELETE");
    json(res, 405, { error: { code: "METHOD", message: "GET, PUT or DELETE only" } });
    return;
  }

  if (!requireAdmin(req, res)) return;

  if (req.method === "DELETE") {
    try {
      const catalog = await readCatalog();
      const idx = catalog.templates.findIndex((t) => t.id === id);
      if (idx < 0) {
        if (BUILTIN_IDS.has(id)) {
          json(res, 400, { error: { code: "BUILTIN", message: "Built-in templates cannot be deleted. Save an override instead, or reset by deleting a custom copy." } });
          return;
        }
        json(res, 404, { error: { code: "NOT_FOUND", message: "Template not found" } });
        return;
      }
      const row = catalog.templates[idx];
      catalog.templates.splice(idx, 1);
      await writeCatalog(catalog);
      if (row.imagePath && String(row.imagePath).startsWith(IMAGE_PREFIX)) await deletePath(row.imagePath);
      json(res, 200, { ok: true, id });
    } catch (e) {
      json(res, 500, { error: { code: "WRITE_FAILED", message: "Could not delete template." } });
    }
    return;
  }

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

  try {
    const catalog = await readCatalog();
    let row = catalog.templates.find((t) => t.id === id);
    if (!row) {
      if (!dto.label || !dto.plate) {
        json(res, 400, { error: { code: "INVALID", message: "label and plate are required" } });
        return;
      }
      if (!dto.image && !dto.keepImageUrl) {
        json(res, 400, { error: { code: "INVALID", message: "Upload an image or keep a built-in templates/ path" } });
        return;
      }
      row = {
        id,
        label: dto.label,
        imageUrl: dto.keepImageUrl || "",
        imagePath: "",
        plate: dto.plate,
        updatedAt: new Date().toISOString()
      };
      if (dto.image) {
        const uploaded = await putImage(id, dto.image);
        row.imageUrl = uploaded.imageUrl;
        row.imagePath = uploaded.imagePath;
      }
      catalog.templates.push(row);
      await writeCatalog(catalog);
      json(res, 200, { template: publicRow(row) });
      return;
    }

    if (dto.label) row.label = dto.label;
    if (dto.plate) row.plate = dto.plate;
    if (dto.image) {
      const prev = row.imagePath;
      const uploaded = await putImage(id, dto.image);
      row.imageUrl = uploaded.imageUrl;
      row.imagePath = uploaded.imagePath;
      if (prev && prev !== row.imagePath) await deletePath(prev);
    } else if (dto.keepImageUrl) {
      row.imageUrl = dto.keepImageUrl;
    }
    row.updatedAt = new Date().toISOString();
    await writeCatalog(catalog);
    json(res, 200, { template: publicRow(row) });
  } catch (e) {
    json(res, 500, { error: { code: "WRITE_FAILED", message: e.message || "Could not save template." } });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: "4mb" } }
};
