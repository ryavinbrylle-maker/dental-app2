// Back end: "My Dental Record" – students see their OWN dental records online.
//
// Students (no dentist login):
//   POST /api/portal {action:"login", name, birthdate, password}            -> { token }
//   POST /api/portal {action:"setup", setup_code, birthdate, password}      -> { token }
//        (first time for students who registered before passwords existed, or a forgotten
//         password: the dentist gives a one-time set-up code)
//   GET  /api/portal            (student token)  -> the student's details, exams, appointments
//   POST /api/portal {action:"password", current, password} (student token) -> { token }
//
// Dentist (dentist token):
//   GET  /api/portal?student_id=5                 -> online access status of that student
//   POST /api/portal {action:"setupcode", student_id} -> a new one-time set-up code (shown once)
//   POST /api/portal {action:"verify", student_id}    -> let the student see earlier school years
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { allow, clientIp, tooMany } from "./_rate.js";
import {
  passwordProblem, hashPassword, checkPassword, makeStudentToken, accountFromToken,
  newSetupCode, cleanSetupCode, hashSetupCode, isLocked, recordFailure, LOCK_MESSAGE,
  identitiesFor, visibleRegistrations, SETUP_CODE_DAYS, setStudentCookie
} from "./_student.js";

const sql = neon(process.env.DATABASE_URL);
const WRONG = "Name, birthdate or password is not correct.";

function validDate(v) {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d) || d.toISOString().slice(0, 10) !== s ? null : s;
}
function iso(d) { return d ? new Date(d).toISOString().slice(0, 10) : null; }
function ageFrom(b) {
  if (!b) return null;
  const d = new Date(b), now = new Date();
  let a = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) a--;
  return a >= 0 && a <= 30 ? a : null;
}
function sendToken(req, res, acct) {
  const token = makeStudentToken(acct);
  setStudentCookie(req, res, token);
  return res.status(200).json({ token: token });
}
function pause() { return new Promise(function (r) { setTimeout(r, 400); }); }   // slows down guessing

async function login(req, b, res) {
  const birth = validDate(b.birthdate);
  if (!b.name || !birth || !b.password) return res.status(400).json({ error: "Please enter your name, birthdate and password." });
  const ids = await identitiesFor(sql, String(b.name).slice(0, 120), birth);
  if (!ids.length) { await pause(); return res.status(401).json({ error: WRONG }); }
  const accts = await sql`SELECT * FROM student_accounts WHERE identity_id = ANY(${ids}) AND password_hash IS NOT NULL`;
  if (!accts.length) {
    await pause();
    return res.status(401).json({ error: WRONG + " If you registered before online records started, ask the school dentist for a set-up code." });
  }
  let locked = false;
  for (const a of accts) {
    if (isLocked(a)) { locked = true; continue; }
    if (await checkPassword(b.password, a.password_hash)) {
      const rows = await sql`UPDATE student_accounts SET failed_attempts = 0, locked_until = NULL, last_login = NOW()
                             WHERE id = ${a.id} RETURNING *`;
      return sendToken(req, res, rows[0]);
    }
    await recordFailure(sql, a);
  }
  await pause();
  return res.status(locked && accts.length === 1 ? 429 : 401).json({ error: locked && accts.length === 1 ? LOCK_MESSAGE : WRONG });
}

async function setup(req, b, res) {
  const code = cleanSetupCode(b.setup_code);
  const birth = validDate(b.birthdate);
  if (!code || !birth) return res.status(400).json({ error: "Please enter the set-up code from the dentist and your birthdate." });
  const prob = passwordProblem(b.password);
  if (prob) return res.status(400).json({ error: prob });
  const found = await sql`SELECT * FROM student_accounts WHERE setup_code_hash = ${hashSetupCode(code)}`;
  const a = found[0];
  if (!a || !a.setup_code_expires || new Date(a.setup_code_expires) < new Date()) {
    await pause();
    return res.status(401).json({ error: "That set-up code is not correct or has expired. Ask the school dentist for a new one." });
  }
  if (isLocked(a)) return res.status(429).json({ error: LOCK_MESSAGE });
  // the birthdate must match what the school has (if the school has one)
  const known = await sql`
    SELECT i.birthdate AS ib, s.birthdate AS sb FROM student_identities i
    LEFT JOIN students s ON s.identity_id = i.id WHERE i.id = ${a.identity_id}`;
  const dates = new Set();
  known.forEach(function (r) { if (r.ib) dates.add(iso(r.ib)); if (r.sb) dates.add(iso(r.sb)); });
  if (dates.size && !dates.has(birth)) {
    await recordFailure(sql, a);
    await pause();
    return res.status(401).json({ error: "The birthdate does not match the school's record." });
  }
  if (!dates.size) await sql`UPDATE student_identities SET birthdate = ${birth} WHERE id = ${a.identity_id}`;
  const hash = await hashPassword(b.password);
  // the dentist handed over the code in person -> it is really the student: verified
  const rows = await sql`
    UPDATE student_accounts SET password_hash = ${hash}, password_changed_at = NOW(), verified = TRUE,
           setup_code_hash = NULL, setup_code_expires = NULL, failed_attempts = 0, locked_until = NULL, last_login = NOW()
    WHERE id = ${a.id} RETURNING *`;
  return sendToken(req, res, rows[0]);
}

async function myRecords(acct, res) {
  const regs = await visibleRegistrations(sql, acct);
  const all = await sql`SELECT COUNT(*)::int AS n FROM students WHERE identity_id = ${acct.identity_id}`;
  const ident = await sql`SELECT full_name, birthdate FROM student_identities WHERE id = ${acct.identity_id}`;
  const ids = regs.map(function (r) { return r.id; });
  const latest = regs[0] || {};
  const visits = ids.length ? await sql`
    SELECT id, visit_date, school_year, grade, section, teeth, exam_notes, decayed, missing, filled
    FROM visits WHERE student_id = ANY(${ids}) ORDER BY visit_date DESC, id DESC` : [];
  const appts = ids.length ? await sql`
    SELECT appointment_date, status, school_year, grade, section, was_absent, (visit_id IS NOT NULL) AS has_exam
    FROM appointments WHERE student_id = ANY(${ids}) ORDER BY appointment_date DESC, id DESC` : [];
  const birth = latest.birthdate || (ident[0] && ident[0].birthdate) || null;
  return res.status(200).json({
    student: {
      name: latest.name || (ident[0] && ident[0].full_name) || "",
      grade: latest.grade || null, section: latest.section || null,
      code_gender: latest.code_gender || null, code_number: latest.code_number || null,
      school_year: latest.school_year || null,
      birthdate: iso(birth), age: ageFrom(birth),
      conditions: latest.conditions || [], other_conditions: latest.other_conditions || null,
      allergies: latest.allergies || null, medications: latest.medications || null
    },
    verified: acct.verified,
    hidden_school_years: Math.max(0, all[0].n - regs.length),
    exams: visits,
    appointments: appts
  });
}

async function changePassword(req, acct, b, res) {
  if (!(await checkPassword(b.current, acct.password_hash))) {
    await recordFailure(sql, acct);
    return res.status(401).json({ error: "Your current password is not correct." });
  }
  const prob = passwordProblem(b.password);
  if (prob) return res.status(400).json({ error: prob });
  const hash = await hashPassword(b.password);
  const rows = await sql`UPDATE student_accounts SET password_hash = ${hash}, password_changed_at = NOW()
                         WHERE id = ${acct.id} RETURNING *`;
  return sendToken(req, res, rows[0]);
}

// ----- dentist side -----
async function identityOfStudent(studentId) {
  const r = await sql`SELECT identity_id FROM students WHERE id = ${studentId}`;
  return r.length ? r[0].identity_id : null;
}
async function dentistStatus(studentId, res) {
  const idn = await identityOfStudent(studentId);
  if (!idn) return res.status(400).json({ error: "Student not found" });
  const a = await sql`SELECT password_hash IS NOT NULL AS has_password, verified, setup_code_expires, last_login, created_at
                      FROM student_accounts WHERE identity_id = ${idn}`;
  const older = await sql`SELECT COUNT(*)::int AS n FROM students WHERE identity_id = ${idn}`;
  if (!a.length) return res.status(200).json({ status: "none", school_years: older[0].n });
  const x = a[0];
  return res.status(200).json({
    status: x.has_password ? (x.verified ? "active" : "unverified") : "code",
    verified: x.verified, last_login: x.last_login, school_years: older[0].n,
    setup_code_expires: x.setup_code_expires && new Date(x.setup_code_expires) > new Date() ? x.setup_code_expires : null
  });
}
async function dentistSetupCode(studentId, res) {
  const idn = await identityOfStudent(studentId);
  if (!idn) return res.status(400).json({ error: "Student not found" });
  const code = newSetupCode();
  const rows = await sql`
    INSERT INTO student_accounts (identity_id, setup_code_hash, setup_code_expires)
    VALUES (${idn}, ${hashSetupCode(code)}, NOW() + (${SETUP_CODE_DAYS} || ' days')::interval)
    ON CONFLICT (identity_id) DO UPDATE SET setup_code_hash = EXCLUDED.setup_code_hash,
      setup_code_expires = EXCLUDED.setup_code_expires, failed_attempts = 0, locked_until = NULL
    RETURNING setup_code_expires`;
  return res.status(200).json({ setup_code: code, expires: rows[0].setup_code_expires });
}
async function dentistVerify(studentId, res) {
  const idn = await identityOfStudent(studentId);
  if (!idn) return res.status(400).json({ error: "Student not found" });
  const rows = await sql`UPDATE student_accounts SET verified = TRUE WHERE identity_id = ${idn} RETURNING id`;
  if (!rows.length) return res.status(400).json({ error: "This student has no online account yet." });
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (!isConfigured()) return res.status(500).json({ error: "The app is not set up yet." });
  try {
    const auth = req.headers.authorization;
    const isDentist = tokenIsValid(auth, req);
    const b = req.body || {};

    if (req.method === "GET") {
      if (isDentist && req.query.student_id) return await dentistStatus(parseInt(req.query.student_id, 10), res);
      const acct = await accountFromToken(sql, auth, req);
      if (!acct) return res.status(401).json({ error: "Please sign in again." });
      return await myRecords(acct, res);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    if (b.action === "logout") {
      setStudentCookie(req, res, "");
      return res.status(200).json({ ok: true });
    }
    if (b.action === "login") {
      // a whole class may share the school's network, so the limit per network is generous
      if (!(await allow(sql, "portal-login:" + clientIp(req), 60, 900))) return tooMany(res, 15);
      return await login(req, b, res);
    }
    if (b.action === "setup") {
      if (!(await allow(sql, "portal-setup:" + clientIp(req), 20, 900))) return tooMany(res, 15);
      return await setup(req, b, res);
    }
    if (b.action === "password") {
      const acct = await accountFromToken(sql, auth, req);
      if (!acct) return res.status(401).json({ error: "Please sign in again." });
      return await changePassword(req, acct, b, res);
    }
    if (b.action === "setupcode" || b.action === "verify") {
      if (!isDentist) return res.status(401).json({ error: "Your login has expired. Please log in again." });
      const sid = parseInt(b.student_id, 10);
      if (!sid) return res.status(400).json({ error: "student_id is required" });
      return b.action === "setupcode" ? await dentistSetupCode(sid, res) : await dentistVerify(sid, res);
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
