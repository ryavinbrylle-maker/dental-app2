// Shared login helpers for the dentist pages.
// Files starting with "_" are not turned into web addresses by Vercel.
import { createHmac, timingSafeEqual } from "crypto";

const SESSION_HOURS = 12; // dentist stays logged in for a school day

function secret() {
  // Signing key comes from the dentist login itself, so changing the
  // password in Vercel automatically logs everyone out.
  return "dental:" + (process.env.DENTIST_USERNAME || "") + ":" + (process.env.DENTIST_PASSWORD || "");
}

export function isConfigured() {
  return Boolean(process.env.DENTIST_USERNAME && process.env.DENTIST_PASSWORD);
}

export function same(given, real) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(real || ""));
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function sign(text) {
  return createHmac("sha256", secret()).update(text).digest("hex");
}

// ---- session cookie (HttpOnly) ----
// The login token is ALSO sent as an HttpOnly cookie that page scripts cannot read.
// The server only accepts a request when the header token AND the cookie match, so a token
// copied out of the browser (e.g. by a malicious script) is useless on its own.
export function readCookie(req, name) {
  const all = String((req && req.headers && req.headers.cookie) || "");
  for (const part of all.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}
function isHttps(req) {
  const proto = String((req.headers && req.headers["x-forwarded-proto"]) || "");
  return proto ? proto.split(",")[0].trim() === "https" : Boolean(process.env.VERCEL);
}
export function setSessionCookie(req, res, name, value, maxAgeSec) {
  const parts = [name + "=" + encodeURIComponent(value || ""), "Path=/api", "HttpOnly", "SameSite=Strict",
                 "Max-Age=" + (value ? maxAgeSec : 0)];
  if (isHttps(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
export const DENTIST_COOKIE = "dsess";
export const SESSION_SECONDS = SESSION_HOURS * 3600;

export function makeToken() {
  const expires = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  return expires + "." + sign(String(expires));
}

// req given -> the HttpOnly session cookie must hold the same token
export function tokenIsValid(header, req) {
  const token = String(header || "").replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expires, sig] = parts;
  if (!expires || !sig || !(Number(expires) > Date.now())) return false;
  if (!same(sig, sign(expires))) return false;
  return req ? same(readCookie(req, DENTIST_COOKIE), token) : true;
}
