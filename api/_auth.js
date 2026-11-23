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
  if (String(real || "").length > 0) {
    const ha = createHmac("sha256", "cmp").update(String(given || "")).digest();
    const hb = createHmac("sha256", "cmp").update(String(real || "")).digest();
    return timingSafeEqual(ha, hb);
  }
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
export function isHttps(req) {
  const proto = String((req.headers && req.headers["x-forwarded-proto"]) || "");
  return proto ? proto.split(",")[0].trim() === "https" : Boolean(process.env.VERCEL);
}
export function setSessionCookie(req, res, name, value, maxAgeSec) {
  const parts = [name + "=" + encodeURIComponent(value || ""), "Path=/api", "HttpOnly", "SameSite=Strict",
                 "Max-Age=" + (value ? maxAgeSec : 0)];
  if (isHttps(req)) parts.push("Secure");
  appendCookie(res, parts.join("; "));
}
// several cookies in one response (session + trusted device)
export function appendCookie(res, c) {
  res.__cookies = (res.__cookies || []).concat(c);
  res.setHeader("Set-Cookie", res.__cookies.length === 1 ? res.__cookies[0] : res.__cookies);
}
export const DENTIST_COOKIE = "dsess";
export const SESSION_SECONDS = SESSION_HOURS * 3600;

// "Trusted device": after a successful login this browser gets a signed, HttpOnly cookie for
// 90 days. During a password-spraying attack the global login cap blocks everyone EXCEPT
// browsers that have logged in successfully before, so an attacker can't lock the dentist out.
export const TRUST_COOKIE = "dtrust";
const TRUST_DAYS = 90;
export function makeTrust() {
  const expires = Date.now() + TRUST_DAYS * 86400000;
  return "t." + expires + "." + sign("trust." + expires);
}
export function trustIsValid(req) {
  const t = readCookie(req, TRUST_COOKIE).split(".");
  return t.length === 3 && t[0] === "t" && Number(t[1]) > Date.now() && same(t[2], sign("trust." + t[1]));
}
export function setTrustCookie(req, res) {
  const parts = [TRUST_COOKIE + "=" + makeTrust(), "Path=/api/login", "HttpOnly", "SameSite=Strict", "Max-Age=" + TRUST_DAYS * 86400];
  if (isHttps(req)) parts.push("Secure");
  appendCookie(res, parts.join("; "));
}

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
