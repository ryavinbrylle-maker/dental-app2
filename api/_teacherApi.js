// Back end: teacher accounts. Served through /api/portal?as=teacher (Vercel's plan allows 12 functions).
//
// Teachers (no login needed for these two):
//   POST /api/portal?as=teacher {action:"signup", full_name, username, password, grade, section}  -> waits for the dentist
//   POST /api/portal?as=teacher {action:"login", username, password}                               -> { token }
// Teachers (teacher token):
//   GET  /api/portal?as=teacher                     -> own details + students of their section (active school year)
//   POST /api/portal?as=teacher {action:"approve", student_id}   -> the student may now use their online record
//   POST /api/portal?as=teacher {action:"reject",  student_id}   -> "not in my section / not my student"
//   POST /api/portal?as=teacher {action:"move", student_id, grade, section, codeNumber?}
//        -> fixes a wrong section; the student then waits for the new section's teacher
//   POST /api/portal?as=teacher {action:"password", current, password}  -> change own password (new session)
//   POST /api/portal?as=teacher {action:"logout"}
// Dentist (dentist token):
//   GET  /api/portal?as=teacher?list=1                                 -> every teacher account
//   POST /api/portal?as=teacher {action:"teacher_approve" | "teacher_reject" | "teacher_remove", teacher_id}
//   POST /api/portal?as=teacher {action:"teacher_section", teacher_id, grade, section}
//   POST /api/portal?as=teacher {action:"teacher_reset", teacher_id}  -> { temp_password } (forgot password / locked)
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { allow, clientIp, tooMany } from "./_rate.js";
import { activeYear } from "./_sy.js";
import { classExists } from "./_classes.js";
import { MAX_CODE_NUMBER, isDuplicateError } from "./_code.js";
import { hashPassword, checkPassword, isLocked } from "./_student.js";
import {
  ensureTeacherSchema, cleanUsername, teacherPasswordProblem, makeTeacherToken, setTeacherCookie, teacherFromToken, tempPassword
} from "./_teacher.js";

const sql = neon(process.env.DATABASE_URL);
const WRONG = "Username or password is not correct.";
function pause() { return new Promise(function (r) { setTimeout(r, 400); }); }
function text(v, max) { const s = String(v === undefined || v === null ? "" : v).trim().slice(0, max); return s || null; }
function iso(d) { return d ? new Date(d).toISOString().slice(0, 10) : null; }

async function teacherFailure(t) {
  const fails = (t.failed_attempts || 0) + 1;
  if (fails >= 5) await sql`UPDATE teachers SET failed_attempts = 0, locked_until = NOW() + interval '15 minutes' WHERE id = ${t.id}`;
  else await sql`UPDATE teachers SET failed_attempts = ${fails} WHERE id = ${t.id}`;
}
function publicTeacher(t) {
  return { id: t.id, full_name: t.full_name, username: t.username, grade: t.grade, section: t.section, status: t.status,
           created_at: t.created_at, last_login: t.last_login, must_change: !!t.must_change };
}

// ---------- teacher: sign up / sign in ----------
async function signup(req, b, res) {
  if (b.website) return res.status(400).json({ error: "Could not save. Please reload the page and try again." });
  if (b.elapsedMs !== undefined && Number(b.elapsedMs) < 2000) return res.status(400).json({ error: "Please take a moment to check your details, then try again." });
  if (!(await allow(sql, "teacher-signup:" + clientIp(req), 10, 3600))) return tooMany(res, 60);
  const name = text(b.full_name, 120), username = cleanUsername(b.username);
  const grade = text(b.grade, 40), section = text(b.section, 40);
  if (!name || name.length < 3) return res.status(400).json({ error: "Please enter your full name." });
  if (!username) return res.status(400).json({ error: "Username: 3–30 letters, numbers, dots, dashes or underscores." });
  const prob = teacherPasswordProblem(b.password);
  if (prob) return res.status(400).json({ error: prob });
  if (!grade || !section || !classExists(grade, section)) return res.status(400).json({ error: "Please choose your grade and section from the list." });
  try {
    await sql`INSERT INTO teachers (full_name, username, password_hash, grade, section)
              VALUES (${name}, ${username}, ${await hashPassword(b.password)}, ${grade}, ${section})`;
  } catch (e) {
    if (isDuplicateError(e)) return res.status(409).json({ error: "That username is already taken. Please choose another." });
    throw e;
  }
  return res.status(201).json({ ok: true });
}

async function login(req, b, res) {
  if (!(await allow(sql, "teacher-login:" + clientIp(req), 60, 900))) return tooMany(res, 15);
  const username = cleanUsername(b.username);
  const rows = username ? await sql`SELECT * FROM teachers WHERE username = ${username} AND status <> 'removed'` : [];
  const t = rows[0];
  if (!t) { await pause(); return res.status(401).json({ error: WRONG }); }
  if (isLocked(t)) return res.status(429).json({ error: "Too many wrong tries. Please wait 15 minutes, or ask the school dentist to reset your password." });
  if (!(await checkPassword(b.password, t.password_hash))) { await teacherFailure(t); await pause(); return res.status(401).json({ error: WRONG }); }
  const up = await sql`UPDATE teachers SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = ${t.id} RETURNING *`;
  const token = makeTeacherToken(up[0]);
  setTeacherCookie(req, res, token);
  return res.status(200).json({ token: token });
}

// ---------- teacher: their section ----------
async function mySection(t, res) {
  const year = await activeYear(sql);
  const base = { teacher: publicTeacher(t), school_year: year };
  if (t.status !== "approved") return res.status(200).json(base);
  // Only what a teacher needs to recognise their students – never dental or medical data
  const rows = await sql`
    SELECT s.id, s.name, s.code_gender, s.code_number, s.birthdate, s.registered_on,
           COALESCE(s.teacher_status, 'approved') AS teacher_status, s.teacher_decided_at,
           EXISTS (SELECT 1 FROM student_accounts a WHERE a.identity_id = s.identity_id AND a.password_hash IS NOT NULL) AS has_account
    FROM students s
    WHERE s.school_year = ${year} AND s.removed_at IS NULL AND s.grade = ${t.grade} AND s.section = ${t.section}
    ORDER BY s.code_gender, s.code_number, s.name`;
  base.students = rows.map(function (r) {
    return { id: r.id, name: r.name, code: r.code_gender && r.code_number ? r.code_gender + "-" + r.code_number : "",
             birthdate: iso(r.birthdate), registered_on: r.registered_on, status: r.teacher_status,
             decided_at: r.teacher_decided_at, has_account: r.has_account };
  });
  return res.status(200).json(base);
}

// the student must be in this teacher's section, this school year
async function ownStudent(t, studentId) {
  const year = await activeYear(sql);
  const rows = await sql`SELECT * FROM students WHERE id = ${studentId} AND school_year = ${year} AND removed_at IS NULL
                         AND grade = ${t.grade} AND section = ${t.section}`;
  return rows[0] || null;
}

async function decide(t, b, res, status) {
  const s = await ownStudent(t, parseInt(b.student_id, 10));
  if (!s) return res.status(404).json({ error: "That student is not in your section." });
  await sql`UPDATE students SET teacher_status = ${status}, teacher_id = ${t.id}, teacher_decided_at = NOW() WHERE id = ${s.id}`;
  return res.status(200).json({ ok: true });
}

async function nextFreeNumber(year, grade, section, gender) {
  const used = await sql`SELECT code_number FROM students WHERE school_year = ${year} AND removed_at IS NULL
                         AND grade = ${grade} AND section = ${section} AND code_gender = ${gender}`;
  const taken = new Set(used.map(function (r) { return r.code_number; }));
  for (let n = 1; n <= MAX_CODE_NUMBER; n++) if (!taken.has(n)) return n;
  return null;
}

async function move(t, b, res) {
  const s = await ownStudent(t, parseInt(b.student_id, 10));
  if (!s) return res.status(404).json({ error: "That student is not in your section." });
  const grade = text(b.grade, 40), section = text(b.section, 40);
  if (!grade || !section || !classExists(grade, section)) return res.status(400).json({ error: "Please choose the correct grade and section." });
  if (grade === s.grade && section === s.section) return res.status(400).json({ error: "The student is already in that section." });
  const year = s.school_year;
  let number = b.codeNumber === undefined || b.codeNumber === null || b.codeNumber === "" ? null : parseInt(b.codeNumber, 10);
  if (number !== null && !(number >= 1 && number <= MAX_CODE_NUMBER)) return res.status(400).json({ error: "The student number must be 1–" + MAX_CODE_NUMBER + "." });
  if (number === null) number = await nextFreeNumber(year, grade, section, s.code_gender);
  else {
    const clash = await sql`SELECT 1 FROM students WHERE school_year = ${year} AND removed_at IS NULL AND grade = ${grade}
                            AND section = ${section} AND code_gender = ${s.code_gender} AND code_number = ${number} LIMIT 1`;
    if (clash.length) return res.status(409).json({ error: s.code_gender + "-" + number + " is already used in " + grade + " – " + section + "." });
  }
  if (!number) return res.status(409).json({ error: "That section has no free student numbers." });
  try {
    // the new section's teacher confirms the student (status back to pending)
    await sql`UPDATE students SET grade = ${grade}, section = ${section}, code_number = ${number},
                     teacher_status = 'pending', teacher_id = NULL, teacher_decided_at = NULL
              WHERE id = ${s.id}`;
  } catch (e) {
    if (isDuplicateError(e)) return res.status(409).json({ error: "That student number was just taken. Please try again." });
    throw e;
  }
  // today's / future appointments that are still waiting follow the student to the new section
  await sql`UPDATE appointments SET grade = ${grade}, section = ${section}
            WHERE student_id = ${s.id} AND status = 'Waiting' AND appointment_date >= CURRENT_DATE`;
  return res.status(200).json({ ok: true, code: s.code_gender + "-" + number, grade: grade, section: section });
}

async function changePassword(req, t, b, res) {
  if (!(await checkPassword(b.current, t.password_hash))) { await pause(); return res.status(400).json({ error: "Your current password is not correct." }); }
  const prob = teacherPasswordProblem(b.password);
  if (prob) return res.status(400).json({ error: prob });
  if (b.password === b.current) return res.status(400).json({ error: "Please choose a password that is different from the old one." });
  const up = await sql`UPDATE teachers SET password_hash = ${await hashPassword(b.password)}, password_changed_at = NOW(), must_change = false
                       WHERE id = ${t.id} RETURNING *`;
  const token = makeTeacherToken(up[0]);   // old sessions end (the token is tied to the password)
  setTeacherCookie(req, res, token);
  return res.status(200).json({ ok: true, token: token });
}

// ---------- dentist: manage teachers ----------
async function dentistReset(b, res) {
  const id = parseInt(b.teacher_id, 10);
  if (!id) return res.status(400).json({ error: "teacher_id is required" });
  const temp = tempPassword();
  const rows = await sql`UPDATE teachers SET password_hash = ${await hashPassword(temp)}, password_changed_at = NOW(), must_change = true,
                           failed_attempts = 0, locked_until = NULL
                         WHERE id = ${id} AND status <> 'removed' RETURNING username`;
  if (!rows.length) return res.status(404).json({ error: "Teacher not found" });
  return res.status(200).json({ ok: true, username: rows[0].username, temp_password: temp });
}
async function dentistList(res) {
  const rows = await sql`SELECT * FROM teachers WHERE status <> 'removed' ORDER BY (status = 'pending') DESC, grade, section, full_name`;
  return res.status(200).json({ teachers: rows.map(publicTeacher) });
}
async function dentistDecide(b, res) {
  const id = parseInt(b.teacher_id, 10);
  if (!id) return res.status(400).json({ error: "teacher_id is required" });
  const status = { teacher_approve: "approved", teacher_reject: "rejected", teacher_remove: "removed" }[b.action];
  const rows = await sql`UPDATE teachers SET status = ${status}, decided_at = NOW() WHERE id = ${id} RETURNING id`;
  if (!rows.length) return res.status(404).json({ error: "Teacher not found" });
  return res.status(200).json({ ok: true });
}
async function dentistSection(b, res) {
  const id = parseInt(b.teacher_id, 10);
  const grade = text(b.grade, 40), section = text(b.section, 40);
  if (!id || !grade || !section || !classExists(grade, section)) return res.status(400).json({ error: "Please choose a grade and section from the list." });
  const rows = await sql`UPDATE teachers SET grade = ${grade}, section = ${section} WHERE id = ${id} RETURNING id`;
  if (!rows.length) return res.status(404).json({ error: "Teacher not found" });
  return res.status(200).json({ ok: true });
}

export async function teacherHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (!isConfigured()) return res.status(500).json({ error: "The app is not set up yet." });
  try {
    await ensureTeacherSchema(sql);
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const isDentist = tokenIsValid(req.headers.authorization, req);

    if (req.method === "GET") {
      if (req.query.list) {
        if (!isDentist) return res.status(401).json({ error: "Your login has expired. Please log in again." });
        return await dentistList(res);
      }
      const t = await teacherFromToken(sql, req);
      if (!t) return res.status(401).json({ error: "Please sign in again." });
      return await mySection(t, res);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    if (b.action === "signup") return await signup(req, b, res);
    if (b.action === "login") return await login(req, b, res);
    if (b.action === "logout") { setTeacherCookie(req, res, ""); return res.status(200).json({ ok: true }); }

    if (/^teacher_/.test(String(b.action || ""))) {
      if (!isDentist) return res.status(401).json({ error: "Your login has expired. Please log in again." });
      if (b.action === "teacher_section") return await dentistSection(b, res);
      if (b.action === "teacher_reset") return await dentistReset(b, res);
      if (!["teacher_approve", "teacher_reject", "teacher_remove"].includes(b.action)) return res.status(400).json({ error: "Unknown action" });
      return await dentistDecide(b, res);
    }

    const t = await teacherFromToken(sql, req);
    if (!t) return res.status(401).json({ error: "Please sign in again." });
    if (b.action === "password") return await changePassword(req, t, b, res);   // also while waiting for approval
    if (t.status !== "approved") return res.status(403).json({ error: "Your teacher account is waiting for the school dentist's approval." });
    if (b.action === "approve") return await decide(t, b, res, "approved");
    if (b.action === "reject") return await decide(t, b, res, "rejected");
    if (b.action === "move") return await move(t, b, res);
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
