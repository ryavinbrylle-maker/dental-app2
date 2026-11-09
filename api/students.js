// Back end: registered students — DENTIST ONLY (needs the login token from /api/login).
//   GET    /api/students                -> the ACTIVE school year's roster  { students, school_year }
//   GET    /api/students?all_years=1    -> every registration of every school year (archive use)
//   PUT    /api/students?id=5           -> change name, grade, section or student code
//   DELETE /api/students?id=5           -> remove from the roster: a SOFT delete, the student's
//                                          appointments, examinations and archives are all KEPT
//   POST   /api/students {action:"enroll", from_student_id, grade, section, codeGender, codeNumber}
//        -> enrol a student from an earlier school year in the ACTIVE year: a new registration
//           (new grade / section / code) linked to the SAME student identity, so their dental
//           history continues and no duplicate student is created.
// One student identity (student_identities) can have one registration per school year
// (students rows); examinations belong to a registration and keep their own year/grade/section.
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { activeYear } from "./_sy.js";
import { checkCode, sexFromCode, isDuplicateError, duplicateMessage } from "./_code.js";
import { nameKey, nameCompact } from "./_identity.js";

const sql = neon(process.env.DATABASE_URL);

function cleanText(v, max) {
  const s = String(v === undefined || v === null ? "" : v).trim().slice(0, max);
  return s === "" ? null : s;
}
function ageFrom(birthdate) {
  if (!birthdate) return null;
  const b = new Date(birthdate), now = new Date();
  if (isNaN(b)) return null;
  let a = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) a--;
  return a >= 0 && a <= 30 ? a : null;
}

async function enroll(b, res) {
  const fromId = parseInt(b.from_student_id, 10);
  if (!fromId) return res.status(400).json({ error: "from_student_id is required" });
  const grade = cleanText(b.grade, 40);
  const section = cleanText(b.section, 40);
  if (!grade || !section) return res.status(400).json({ error: "Please choose the new grade and section." });
  const code = checkCode(b.codeGender, b.codeNumber);
  if (code.error) return res.status(400).json({ error: code.error });

  const year = await activeYear(sql);
  const src = await sql`SELECT * FROM students WHERE id = ${fromId}`;
  if (!src.length) return res.status(400).json({ error: "Student not found" });
  const s = src[0];
  if (s.school_year === year) {
    return res.status(409).json({ error: s.name + " is already registered in school year " + year + "." });
  }
  // make sure the earlier registration has an identity (very old records may not)
  let identityId = s.identity_id;
  if (!identityId) {
    const idn = await sql`
      INSERT INTO student_identities (full_name, name_key, name_compact, birthdate, first_registration_id)
      VALUES (${s.name}, ${nameKey(s.name)}, ${nameCompact(s.name)}, ${s.birthdate}, ${s.id})
      ON CONFLICT (first_registration_id) DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING id`;
    identityId = idn[0].id;
    await sql`UPDATE students SET identity_id = ${identityId} WHERE id = ${s.id} AND identity_id IS NULL`;
  }
  // never two registrations of the same student in one school year
  const already = await sql`
    SELECT id, grade, section, code_gender, code_number FROM students
    WHERE identity_id = ${identityId} AND school_year = ${year} AND removed_at IS NULL`;
  if (already.length) {
    const a = already[0];
    return res.status(409).json({
      error: s.name + " is already enrolled in " + year + " (" + a.grade + " – " + a.section +
             (a.code_gender ? ", " + a.code_gender + "-" + a.code_number : "") + ").",
      student_id: a.id });
  }
  const taken = await sql`
    SELECT 1 FROM students
    WHERE school_year = ${year} AND removed_at IS NULL AND grade = ${grade} AND section = ${section}
      AND code_gender = ${code.gender} AND code_number = ${code.number} LIMIT 1`;
  if (taken.length) return res.status(409).json({ error: duplicateMessage(grade, section, code.gender, code.number) });

  const rows = await sql`
    INSERT INTO students (name, code_gender, code_number, birthdate, age, sex, grade, section,
                          conditions, other_conditions, allergies, medications, consent,
                          school_year, identity_id, match_status)
    VALUES (${s.name}, ${code.gender}, ${code.number}, ${s.birthdate}, ${ageFrom(s.birthdate) ?? s.age},
            ${sexFromCode(code.gender)}, ${grade}, ${section},
            ${s.conditions || []}, ${s.other_conditions}, ${s.allergies}, ${s.medications}, ${s.consent === true},
            ${year}, ${identityId}, 'confirmed')
    RETURNING *`;
  return res.status(201).json({ student: rows[0], school_year: year });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (!isConfigured()) return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }

  try {
    if (req.method === "GET") {
      const year = await activeYear(sql);
      const rows = req.query.all_years
        ? await sql`SELECT * FROM students WHERE removed_at IS NULL ORDER BY school_year DESC, registered_on DESC`
        : await sql`SELECT * FROM students WHERE school_year = ${year} AND removed_at IS NULL
                    ORDER BY registered_on DESC`;
      res.setHeader("X-School-Year", year);
      return res.status(200).json({ students: rows, school_year: year });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      if (b.action === "enroll") return await enroll(b, res);
      return res.status(400).json({ error: "Unknown action" });
    }

    if (req.method === "PUT") {
      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: "id is required" });
      const b = req.body || {};
      const name = cleanText(b.name, 120);
      const grade = cleanText(b.grade, 40);
      const section = cleanText(b.section, 40);
      if (!name) return res.status(400).json({ error: "Student name is required" });
      if (!grade || !section) return res.status(400).json({ error: "Grade and section are required" });
      const code = checkCode(b.codeGender, b.codeNumber);
      if (code.error) return res.status(400).json({ error: code.error });

      const cur = await sql`SELECT school_year FROM students WHERE id = ${id}`;
      if (!cur.length) return res.status(400).json({ error: "Student not found" });
      // codes are unique per school year + grade + section
      const taken = await sql`
        SELECT 1 FROM students
        WHERE school_year = ${cur[0].school_year} AND removed_at IS NULL
          AND grade = ${grade} AND section = ${section}
          AND code_gender = ${code.gender} AND code_number = ${code.number}
          AND id <> ${id}
        LIMIT 1`;
      if (taken.length) {
        return res.status(409).json({ error: duplicateMessage(grade, section, code.gender, code.number) });
      }
      // Only this registration changes. Examinations keep the grade/section they were made in.
      const rows = await sql`
        UPDATE students
        SET name = ${name}, grade = ${grade}, section = ${section},
            code_gender = ${code.gender}, code_number = ${code.number},
            sex = ${sexFromCode(code.gender)}
        WHERE id = ${id}
        RETURNING *`;
      return res.status(200).json({ student: rows[0] });
    }

    if (req.method === "DELETE") {
      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: "id is required" });
      // Soft delete: the student leaves the roster, but appointments, examinations and
      // archives stay intact (nothing is cascaded away). Their code becomes free again.
      await sql`UPDATE students SET removed_at = NOW() WHERE id = ${id} AND removed_at IS NULL`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (isDuplicateError(err)) {
      return res.status(409).json({ error: "That student code is already used in this grade and section." });
    }
    console.error(err);
    return res.status(500).json({ error: "Database error. Did you run the latest schema.sql in Neon?" });
  }
}
