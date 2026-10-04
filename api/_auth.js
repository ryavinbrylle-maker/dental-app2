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

export function makeToken() {
  const expires = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  return expires + "." + sign(String(expires));
}

export function tokenIsValid(header) {
  const token = String(header || "").replace(/^Bearer\s+/i, "");
  const [expires, sig] = token.split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return same(sig, sign(expires));
}
