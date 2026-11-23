// Simple rate limiting stored in the database (works across all Vercel functions).
// Each key (e.g. "login:<hashed ip>") may be used `limit` times per `seconds` window.
// IP addresses are hashed before they are stored (privacy).
// If the table is missing (schema.sql not run yet) the request is allowed, so the
// app never stops working because of the limiter itself.
import { createHash } from "crypto";

export function clientIp(req) {
  const xf = String((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "");
  const ip = xf.split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "unknown";
  return createHash("sha256").update("ip:" + ip).digest("hex").slice(0, 24);
}

let tableReady = false;
async function ensureTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS rate_limits (
              key TEXT PRIMARY KEY, window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(), hits INTEGER NOT NULL DEFAULT 0)`;
  tableReady = true;
}
// Returns true when the request is allowed
export async function allow(sql, key, limit, seconds, retried) {
  try {
    const rows = await sql`
      INSERT INTO rate_limits (key, window_start, hits) VALUES (${key}, NOW(), 1)
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limits.window_start < NOW() - (${seconds} || ' seconds')::interval
                    THEN 1 ELSE rate_limits.hits + 1 END,
        window_start = CASE WHEN rate_limits.window_start < NOW() - (${seconds} || ' seconds')::interval
                    THEN NOW() ELSE rate_limits.window_start END
      RETURNING hits`;
    if (Math.random() < 0.02) {       // tidy up old entries now and then
      sql`DELETE FROM rate_limits WHERE window_start < NOW() - interval '2 days'`.catch(function () {});
    }
    return rows[0].hits <= limit;
  } catch (e) {
    // first use on a database without the table: create it once, then count again
    if (!retried && !tableReady && /rate_limits/.test(String(e.message))) {
      try { await ensureTable(sql); return await allow(sql, key, limit, seconds, true); } catch (e2) {}
    }
    console.error("rate limit check skipped:", e.message);
    return true;
  }
}

export function tooMany(res, minutes) {
  res.setHeader("Retry-After", String(minutes * 60));
  return res.status(429).json({ error: "Too many tries from this network. Please wait " + minutes + " minutes and try again." });
}
