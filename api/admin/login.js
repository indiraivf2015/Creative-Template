"use strict";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.statusCode = 405;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: { code: "METHOD", message: "POST only" } }));
    return;
  }
  const { requireAdmin, json } = require("../../lib/server");
  if (!requireAdmin(req, res)) return;
  json(res, 200, { ok: true });
};
