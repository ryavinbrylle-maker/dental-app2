// Run the Dental App on your own computer: http://localhost:3000
// Works like Vercel: serves the pages and runs the files in /api.
// Settings come from .env.local (DATABASE_URL, DENTIST_USERNAME, DENTIST_PASSWORD).
// Start it with Start-Local.bat (Windows) or:  node local-server.mjs
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// ---- read .env.local ----
const envFile = path.join(ROOT, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
// ---- first-time setup: ask for the Neon connection string right here in this window ----
function saveSetting(key, value) {
  let text = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const line = key + "=" + value;
  const re = new RegExp("^[ \\t]*" + key + "[ \\t]*=.*$", "m");
  text = re.test(text) ? text.replace(re, () => line) : text.replace(/\s*$/, "\r\n") + line + "\r\n";
  fs.writeFileSync(envFile, text);
  process.env[key] = value;
}
const needsUrl = !process.env.DATABASE_URL || /USER:PASSWORD@HOST/.test(process.env.DATABASE_URL);
if (needsUrl && process.stdin.isTTY) {
  const { createInterface } = await import("readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n  One-time setup: connect to your Neon database.");
  console.log("  In Neon (console.neon.tech): open your project > Connect > Show password > Copy.");
  console.log("  Then right-click in this window to paste it, and press Enter.\n");
  for (;;) {
    const v = (await rl.question("  Neon connection string: ")).trim().replace(/^psql\s+/, "").replace(/^['"]|['"]$/g, "");
    if (/^postgres(ql)?:\/\/[^\s]+@[^\s]+$/.test(v) && !/USER:PASSWORD@HOST/.test(v)) { saveSetting("DATABASE_URL", v); break; }
    console.log("  That doesn't look right. It should start with postgresql:// - try again.");
  }
  rl.close();
  console.log("  Saved in .env.local (on this computer only).\n");
}
const missing = ["DATABASE_URL", "DENTIST_USERNAME", "DENTIST_PASSWORD"].filter((k) => !process.env[k]);
if (/USER:PASSWORD@HOST/.test(process.env.DATABASE_URL || "")) missing.push("DATABASE_URL (still the example text - paste your real Neon connection string)");
if (missing.length) {
  console.log("\n  Missing in .env.local: " + missing.join(", "));
  console.log("  Open .env.local in Notepad, fill them in, save, and start again.\n");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json",
  ".pdf": "application/pdf", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};
const SECURITY = {
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY",
};
// files that must never be served to a browser
const PRIVATE = /^(\.|node_modules|local-server\.mjs|start-local\.bat|package(-lock)?\.json|schema\.sql|test-students\.sql)/i;

async function runApi(name, req, res, url) {
  const file = path.join(ROOT, "api", name + ".js");
  if (!/^[a-z0-9-]+$/i.test(name) || !fs.existsSync(file)) {
    res.writeHead(404, SECURITY); return res.end("The page could not be found");
  }
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 5e6) { res.writeHead(413); return res.end(); } }
  req.query = Object.fromEntries(url.searchParams);
  try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
  const headers = { ...SECURITY, "Cache-Control": "no-store" };
  let code = 200, done = false;
  const out = {
    setHeader(k, v) { headers[k] = v; return out; },
    status(c) { code = c; return out; },
    json(o) { if (done) return; done = true; res.writeHead(code, { ...headers, "Content-Type": "application/json" }); res.end(JSON.stringify(o)); },
    send(s) { if (done) return; done = true; res.writeHead(code, headers); res.end(typeof s === "string" ? s : JSON.stringify(s)); },
    end(s) { if (done) return; done = true; res.writeHead(code, headers); res.end(s); },
  };
  try {
    const mod = await import(pathToFileURL(file).href);
    await mod.default(req, out);
    if (!done) out.end();
  } catch (e) {
    console.error("[api/" + name + "]", e);
    if (!done) out.status(500).json({ error: "Server error: " + e.message });
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith("/api/")) return runApi(p.slice(5).replace(/\/$/, ""), req, res, url);
  if (p === "/") { res.writeHead(302, { Location: "/StudentReg.html" }); return res.end(); }
  const rel = p.replace(/^\/+/, "");
  const file = path.join(ROOT, rel);
  if (PRIVATE.test(rel) || rel.startsWith("api") || !file.startsWith(ROOT) ||
      !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, SECURITY); return res.end("Not found");
  }
  const h = { ...SECURITY, "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" };
  if (rel === "Students.html") h["X-Robots-Tag"] = "noindex, nofollow";
  res.writeHead(200, h);
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log("\n  Dental App is running.\n");
  console.log("  Dentist page:       http://localhost:" + PORT + "/Students.html");
  console.log("  Registration form:  http://localhost:" + PORT + "/StudentReg.html");
  lan.forEach((ip) => console.log("  Phones on the same Wi-Fi:  http://" + ip + ":" + PORT + "/StudentReg.html"));
  console.log("\n  Keep this window open. Close it (or press Ctrl+C) to stop.\n");
}).on("error", (e) => {
  console.log(e.code === "EADDRINUSE" ? "\n  Port " + PORT + " is already in use. Close the other Dental App window first.\n" : e);
  process.exit(1);
});
