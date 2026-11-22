// Shared helpers for students' online dental records ("My Dental Record").
// Files starting with "_" are not web addresses on Vercel.
//
// Security model
//   • one account per student identity (so it covers every school year)
//   • passwords: scrypt hash + random salt (never stored as text)
//   • sign-in: name + birthdate + password; 5 wrong passwords lock the account for 15 minutes
//   • session token: signed with a key that is DIFFERENT from the dentist's, so a student
//     token can never open the dentist pages; changing the password ends old sessions
//   • a returning student who makes a password on the public form only sees EARLIER school
//     years after the dentist confirms it is really them (verified), because the public form
//     only knows name + birthdate, which classmates may also know
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import { nameKey, nameCompact } from "./_identity.js";

const scrypt = promisify(scryptCb);
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
export const SETUP_CODE_DAYS = 14;

function secret() {
  return "student-portal:" + (process.env.DENTIST_USERNAME || "") + ":" + (process.env.DENTIST_PASSWORD || "");
}
function sign(text) { return createHmac("sha256", secret()).update(text).digest("hex"); }
function eq(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

// ---------- passwords ----------
export function passwordProblem(p) {
  const s = String(p || "");
  if (s.length < 6) return "The password must have at least 6 characters.";
  if (s.length > 72) return "The password is too long (72 characters at most).";
  return null;
}
export async function hashPassword(p) {
  const salt = randomBytes(16);
  const key = await scrypt(String(p), salt, 32);
  return "scrypt$" + salt.toString("hex") + "$" + key.toString("hex");
}
export async function checkPassword(p, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const key = await scrypt(String(p || ""), Buffer.from(parts[1], "hex"), 32);
  return eq(key.toString("hex"), parts[2]);
}

// ---------- session tokens: "s.<accountId>.<expires>.<signature>" ----------
function pwVersion(acct) { return String(acct.password_hash || "").slice(-12); }
export function makeStudentToken(acct) {
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  return "s." + acct.id + "." + expires + "." + sign(acct.id + "." + expires + "." + pwVersion(acct));
}
// Returns the account row, or null
export async function accountFromToken(sql, header) {
  const t = String(header || "").replace(/^Bearer\s+/i, "").split(".");
  if (t.length !== 4 || t[0] !== "s") return null;
  const id = parseInt(t[1], 10), expires = Number(t[2]);
  if (!id || !expires || expires < Date.now()) return null;
  const rows = await sql`SELECT * FROM student_accounts WHERE id = ${id}`;
  if (!rows.length || !rows[0].password_hash) return null;
  return eq(t[3], sign(id + "." + expires + "." + pwVersion(rows[0]))) ? rows[0] : null;
}

// ---------- one-time set-up codes (given by the dentist) ----------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O, 1/I
export function newSetupCode() {
  const b = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_CHARS[b[i] % CODE_CHARS.length];
  return s.slice(0, 4) + "-" + s.slice(4);
}
export function cleanSetupCode(c) {
  const s = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 8 ? s.slice(0, 4) + "-" + s.slice(4) : null;
}
export function hashSetupCode(c) {
  return createHash("sha256").update(secret() + ":" + c).digest("hex");
}

// ---------- lockout ----------
export function isLocked(acct) {
  return acct.locked_until && new Date(acct.locked_until) > new Date();
}
export async function recordFailure(sql, acct) {
  const fails = (acct.failed_attempts || 0) + 1;
  if (fails >= MAX_FAILS) {
    await sql`UPDATE student_accounts SET failed_attempts = 0,
              locked_until = NOW() + (${LOCK_MINUTES} || ' minutes')::interval WHERE id = ${acct.id}`;
  } else {
    await sql`UPDATE student_accounts SET failed_attempts = ${fails} WHERE id = ${acct.id}`;
  }
}
export const LOCK_MESSAGE = "Too many wrong tries. Please wait " + LOCK_MINUTES + " minutes and try again.";

// Identities whose name and birthdate match (several children can share a name)
export async function identitiesFor(sql, name, birthdate) {
  const key = nameKey(name), compact = nameCompact(name);
  if (!key || !birthdate) return [];
  const rows = await sql`
    SELECT DISTINCT i.id
    FROM student_identities i
    LEFT JOIN students s ON s.identity_id = i.id
    WHERE (i.name_key = ${key} OR i.name_compact = ${compact})
      AND (i.birthdate = ${birthdate}::date OR s.birthdate = ${birthdate}::date)`;
  return rows.map(function (r) { return r.id; });
}

// After a registration is saved (and linked to an identity): make the student's account.
// Returns { account } when a new account was made, or { exists: true } when this student
// already has an account from an earlier school year (they keep their old password).
export async function createAccountForRegistration(sql, studentId, password) {
  const st = await sql`SELECT id, identity_id FROM students WHERE id = ${studentId}`;
  if (!st.length || !st[0].identity_id) return { error: "no identity" };
  const identityId = st[0].identity_id;
  const have = await sql`SELECT * FROM student_accounts WHERE identity_id = ${identityId}`;
  if (have.length && have[0].password_hash) return { exists: true };
  // nothing older to protect -> verified straight away; a returning student waits for the dentist
  const older = await sql`SELECT 1 FROM students WHERE identity_id = ${identityId} AND id <> ${studentId} LIMIT 1`;
  const hash = await hashPassword(password);
  let rows;
  if (have.length) {   // the dentist had prepared a set-up code but no password was set yet
    rows = await sql`UPDATE student_accounts SET password_hash = ${hash}, password_changed_at = NOW(),
                       created_from_student_id = ${studentId}, verified = ${!older.length}
                     WHERE id = ${have[0].id} RETURNING *`;
  } else {
    rows = await sql`INSERT INTO student_accounts (identity_id, password_hash, verified, created_from_student_id, password_changed_at)
                     VALUES (${identityId}, ${hash}, ${!older.length}, ${studentId}, NOW())
                     ON CONFLICT (identity_id) DO NOTHING RETURNING *`;
    if (!rows.length) return { exists: true };
  }
  return { account: rows[0] };
}

// Registrations whose records this account may see
export async function visibleRegistrations(sql, acct) {
  return sql`
    SELECT s.* FROM students s
    WHERE s.identity_id = ${acct.identity_id}
      AND (${acct.verified} OR s.id = ${acct.created_from_student_id} OR s.registered_on >= ${acct.created_at})
    ORDER BY s.school_year DESC, s.registered_on DESC`;
}
