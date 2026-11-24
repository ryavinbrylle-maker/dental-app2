// Shared helpers for teacher accounts (section advisers who approve their students' online accounts).
// Files starting with "_" are not web addresses on Vercel.
//
//   • teachers sign up themselves and choose their grade + section; the DENTIST approves them
//   • an approved teacher approves (or rejects) students who registered in their section, and can
//     move a student who picked the wrong section; the student then waits for the new section's teacher
//   • teachers only ever see name, student code, birthdate and registration date – never dental records
//   • passwords: scrypt (same as students); 5 wrong passwords lock the account for 15 minutes
//   • session: signed token + HttpOnly cookie "tsess" (a separate key from the dentist and students)
import { createHmac, timingSafeEqual } from "crypto";
import { readCookie, setSessionCookie } from "./_auth.js";

const SESSION_HOURS = 12;
export const TEACHER_COOKIE = "tsess";

function secret() {
  return "teacher:" + (process.env.DENTIST_USERNAME || "") + ":" + (process.env.DENTIST_PASSWORD || "");
}
function sign(text) { return createHmac("sha256", secret()).update(text).digest("hex"); }
function eq(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

// ---- the tables this feature needs (created once per server start; safe to repeat) ----
let schemaReady = false;
export async function ensureTeacherSchema(sql) {
  if (schemaReady) return;
  await sql`CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      grade TEXT NOT NULL,
      section TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      decided_at TIMESTAMPTZ,
      password_changed_at TIMESTAMPTZ DEFAULT NOW(),
      last_login TIMESTAMPTZ)`;
  await sql`ALTER TABLE teachers ENABLE ROW LEVEL SECURITY`;
  // a registration's approval by the section's teacher: NULL = registered before this feature (counts as approved)
  await sql`ALTER TABLE students ADD COLUMN IF NOT EXISTS teacher_status TEXT`;
  await sql`ALTER TABLE students ADD COLUMN IF NOT EXISTS teacher_id INTEGER`;
  await sql`ALTER TABLE students ADD COLUMN IF NOT EXISTS teacher_decided_at TIMESTAMPTZ`;
  schemaReady = true;
}

export function cleanUsername(u) {
  const s = String(u || "").trim().toLowerCase();
  return /^[a-z0-9._-]{3,30}$/.test(s) ? s : null;
}
export function teacherPasswordProblem(p) {
  const s = String(p || "");
  if (s.length < 8) return "The password must have at least 8 characters.";
  if (s.length > 72) return "The password is too long (72 characters at most).";
  return null;
}

// ---- sessions: "tc.<id>.<expires>.<signature>" ----
function pwVersion(t) { return String(t.password_hash || "").slice(-12); }
export function makeTeacherToken(t) {
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  return "tc." + t.id + "." + expires + "." + sign(t.id + "." + expires + "." + pwVersion(t));
}
export function setTeacherCookie(req, res, token) {
  setSessionCookie(req, res, TEACHER_COOKIE, token, SESSION_HOURS * 3600);
}
// The teacher row, or null. The HttpOnly cookie must hold the same token as the header.
export async function teacherFromToken(sql, req) {
  const raw = String((req.headers && req.headers.authorization) || "").replace(/^Bearer\s+/i, "");
  if (!eq(readCookie(req, TEACHER_COOKIE), raw)) return null;
  const t = raw.split(".");
  if (t.length !== 4 || t[0] !== "tc") return null;
  const id = parseInt(t[1], 10), expires = Number(t[2]);
  if (!id || !(expires > Date.now())) return null;
  const rows = await sql`SELECT * FROM teachers WHERE id = ${id}`;
  if (!rows.length || rows[0].status === "removed") return null;
  return eq(t[3], sign(id + "." + expires + "." + pwVersion(rows[0]))) ? rows[0] : null;
}
