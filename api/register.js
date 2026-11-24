// Back end: receives the registration form and saves it to Neon.
// Runs on Vercel as a serverless function at /api/register.
import { neon } from "@neondatabase/serverless";
import { checkCode, sexFromCode, isDuplicateError, duplicateMessage } from "./_code.js";
import { activeYear } from "./_sy.js";
import { attachIdentity } from "./_identity.js";
import { passwordProblem, createAccountForRegistration, makeStudentToken, setStudentCookie, setStudentTrust } from "./_student.js";
import { allow, clientIp, tooMany } from "./_rate.js";
import { classExists } from "./_classes.js";
import { ensureTeacherSchema } from "./_teacher.js";

// DATABASE_URL is added automatically when you connect Neon in Vercel.
const sql = neon(process.env.DATABASE_URL);

function cleanText(v, max) {
  const s = String(v === undefined || v === null ? "" : v).trim().slice(0, max);
  return s === "" ? null : s;
}

// The only medical-condition choices on the form (anything else goes in "Other conditions")
const CONDITION_CHOICES = ["Asthma", "Heart condition", "Diabetes", "Bleeding disorder",
                           "Epilepsy / seizures", "Anemia"];
function cleanConditions(v) {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map(function (x) { return String(x); })
    .filter(function (x) { return CONDITION_CHOICES.includes(x); })));
}
// YYYY-MM-DD, a real date, not in the future and not more than 30 years ago (else null / error)
function cleanBirthdate(v) {
  if (v === undefined || v === null || v === "") return { value: null };
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: "Please enter a valid birthdate." };
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d) || d.toISOString().slice(0, 10) !== s) return { error: "Please enter a valid birthdate." };
  const now = new Date();
  if (d > now) return { error: "The birthdate cannot be in the future." };
  if (now.getUTCFullYear() - d.getUTCFullYear() > 30) return { error: "Please check the birthdate year." };
  return { value: s };
}
function cleanAge(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= 30 ? n : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed" });
  }

  const s = req.body || {};

  // ---- bot protection ----
  // 1. a hidden "website" field that people never see or fill in
  if (s.website) return res.status(400).json({ error: "Could not save. Please reload the page and try again." });
  // 2. a form filled in less than 2 seconds was not filled in by a person
  if (s.elapsedMs !== undefined && Number(s.elapsedMs) < 2000) {
    return res.status(400).json({ error: "That was very fast – please check the form and press Confirm again." });
  }
  // 3. at most 150 registrations per network per hour (a whole school may share one network)
  if (!(await allow(sql, "register:" + clientIp(req), 150, 3600))) return tooMany(res, 60);

  // Required: name, grade, section and student code (never trust the browser).
  // Blood type, height, weight, address, parent/guardian and dental history are no longer
  // collected by the form, so they are not accepted from the public endpoint either.
  const name = cleanText(s.name, 120);
  if (!name) return res.status(400).json({ error: "Student name is required" });
  const grade = cleanText(s.grade, 40);
  const section = cleanText(s.section, 40);
  if (!grade || !section) {
    return res.status(400).json({ error: "Please choose the grade and section" });
  }
  if (!classExists(grade, section)) {
    return res.status(400).json({ error: "Please choose a grade and section from the list." });
  }
  const code = checkCode(s.codeGender, s.codeNumber);
  if (code.error) return res.status(400).json({ error: code.error });
  const birth = cleanBirthdate(s.birthdate);
  if (birth.error) return res.status(400).json({ error: birth.error });
  // Password for "My Dental Record" (seeing their own records online)
  const wantsAccount = s.password !== undefined && s.password !== null && s.password !== "";
  if (wantsAccount) {
    const prob = passwordProblem(s.password);
    if (prob) return res.status(400).json({ error: prob });
    if (!birth.value) return res.status(400).json({ error: "Please enter the birthdate – you need it to sign in." });
  }

  try {
    await ensureTeacherSchema(sql);   // the section's teacher approves new registrations
    // Friendly check first; the unique index below is the real guarantee
    const year = await activeYear(sql);
    const taken = await sql`
      SELECT 1 FROM students
      WHERE school_year = ${year} AND removed_at IS NULL
        AND grade = ${grade} AND section = ${section}
        AND code_gender = ${code.gender} AND code_number = ${code.number}
      LIMIT 1`;
    if (taken.length) {
      return res.status(409).json({ error: duplicateMessage(grade, section, code.gender, code.number) });
    }

    const rows = await sql`
      INSERT INTO students (
        name, code_gender, code_number, birthdate, age, sex, blood_type, grade, section,
        height_cm, weight_kg, address,
        parent_name, relationship, contact, emergency_contact,
        conditions, other_conditions, allergies, medications,
        last_visit, brushing, dental_concerns, dental_notes,
        consent, school_year, teacher_status
      ) VALUES (
        ${name}, ${code.gender}, ${code.number}, ${birth.value}, ${cleanAge(s.age)},
        ${sexFromCode(code.gender)}, ${null}, ${grade}, ${section},
        ${null}, ${null}, ${null},
        ${null}, ${null}, ${null}, ${null},
        ${cleanConditions(s.conditions)}, ${cleanText(s.otherConditions, 300)}, ${cleanText(s.allergies, 300)},
        ${cleanText(s.medications, 300)},
        ${null}, ${null}, ${[]}, ${null},
        ${s.consent === true}, ${year}, ${"pending"}
      )
      RETURNING id
    `;
    // Returning student? Link to their earlier school years (or ask the dentist to confirm).
    // The public form is never told about matches (privacy).
    try {
      await attachIdentity(sql, rows[0].id, {
        name: name, birthdate: birth.value, grade: grade, school_year: year
      });
    } catch (e) {
      console.error("identity matching failed", e);   // registration itself is saved
    }
    // Online account: sign the student in straight away (or tell them they already have one)
    let account = null, token = null;
    if (wantsAccount) {
      try {
        const r = await createAccountForRegistration(sql, rows[0].id, s.password);
        if (r.account) { account = "created"; token = makeStudentToken(r.account); setStudentCookie(req, res, token); setStudentTrust(req, res, r.account); }
        else if (r.exists) account = "exists";
      } catch (e) {
        console.error("account creation failed", e);   // registration itself is saved
      }
    }
    return res.status(201).json({ ok: true, account: account, token: token });   // nothing more than the page needs
  } catch (err) {
    if (isDuplicateError(err)) {
      return res.status(409).json({ error: duplicateMessage(grade, section, code.gender, code.number) });
    }
    console.error(err);
    return res.status(500).json({ error: "Database error. Please try again." });
  }
}
