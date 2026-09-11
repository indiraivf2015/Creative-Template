/* Local stand-in for `vercel dev`: static files + /api/* handlers + the
   vercel.json rewrites, so the two routes can be exercised without deploying. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const ROOT = path.resolve(process.argv[2] || __dirname);
const PORT = Number(process.argv[3] || process.env.PORT || 3200);

// `vercel dev` loads .env for you; this harness has to do it itself.
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (m && !line.trim().startsWith("#")) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  console.log(".env loaded:",
    "ADMIN_PIN=" + (process.env.ADMIN_PIN ? "set" : "MISSING"),
    "BLOB=" + (process.env.BLOB_READ_WRITE_TOKEN ? "set" : "MISSING"));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp"
};

function loadHandler(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

function readBody(req) {
  return new Promise((res) => {
    let b = "";
    req.on("data", (c) => { b += c; });
    req.on("end", () => res(b));
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsed.pathname);

  // ---- API ----
  if (pathname.startsWith("/api/")) {
    req.body = await readBody(req);
    req.query = Object.assign({}, parsed.query);
    let handler = null;
    try {
      if (pathname === "/api/templates") handler = loadHandler(path.join(ROOT, "api/templates.js"));
      else if (pathname === "/api/admin/login") handler = loadHandler(path.join(ROOT, "api/admin/login.js"));
      else if (/^\/api\/templates\/[^/]+$/.test(pathname)) {
        req.query.id = pathname.split("/").pop();
        handler = loadHandler(path.join(ROOT, "api/templates/[id].js"));
      }
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: { message: "handler load failed: " + e.message } }));
      return;
    }
    if (!handler) { res.statusCode = 404; res.end('{"error":"no route"}'); return; }
    try { await handler(req, res); }
    catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: e.message } })); }
    return;
  }

  // ---- vercel.json rewrites ----
  if (pathname === "/admin") pathname = "/admin.html";
  const t = pathname.match(/^\/t\/([^/]+)$/);
  if (t) pathname = "/Indira_Creative_Studio.html";
  if (pathname === "/") pathname = "/index.html";

  const file = path.join(ROOT, pathname.replace(/^\/+/, ""));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    res.end("not found: " + pathname);
    return;
  }
  res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});

server.listen(PORT, () => {
  console.log("");
  console.log("  Creative Studio running");
  console.log("");
  console.log("  Home       http://127.0.0.1:" + PORT + "/");
  console.log("  Admin      http://127.0.0.1:" + PORT + "/admin");
  console.log("  Doctor     http://127.0.0.1:" + PORT + "/t/doctor");
  console.log("  Employee   http://127.0.0.1:" + PORT + "/t/employee");
  console.log("");
  console.log("  Ctrl+C to stop.");
  console.log("");
});
