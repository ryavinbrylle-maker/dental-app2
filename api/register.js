// Back end: receives the registration form and saves it to Neon.
// Runs on Vercel as a serverless function at /api/register.
import { neon } from "@neondatabase/serverless";
import { checkCode, sexFromCode, isDuplicateError, duplicateMessage } from "./_code.js";

// DATABASE_URL is added automatically when you connect Neon in Vercel.
const sql = neon(process.env.DATABASE_URL);

// Turn empty text into null so the database stores "no value"
function orNull(v) {
  return v === undefined || v === null || v === "" ? null : v;
}
function cleanText(v, max) {
  const s = String(v === undefined || v === null ? "" : v).trim().slice(0, max);
  return s === "" ? null : s;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed" });
  }

  const s = req.body || {};

  // Required: name, grade, section and student code (never trust the browser)
  const name = cleanText(s.name, 120);
  if (!name) return res.status(400).json({ error: "Student name is required" });
  const grade = cleanText(s.grade, 40);
  const section = cleanText(s.section, 40);
  if (!grade || !section) {
    return res.status(400).json({ error: "Please choose the grade and section" });
  }
  const code = checkCode(s.codeGender, s.codeNumber);
  if (code.error) return res.status(400).json({ error: code.error });

  try {
    // Friendly check first; the unique index below is the real guarantee
    const taken = await sql`
      SELECT 1 FROM students
      WHERE grade = ${grade} AND section = ${section}
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
        consent
      ) VALUES (
        ${name}, ${code.gender}, ${code.number}, ${orNull(s.birthdate)}, ${orNull(s.age)},
        ${sexFromCode(code.gender)}, ${orNull(s.bloodType)}, ${grade}, ${section},
        ${orNull(s.height)}, ${orNull(s.weight)}, ${orNull(s.address)},
        ${orNull(s.parentName)}, ${orNull(s.relationship)}, ${orNull(s.contact)}, ${orNull(s.emergencyContact)},
        ${s.conditions || []}, ${orNull(s.otherConditions)}, ${orNull(s.allergies)}, ${orNull(s.medications)},
        ${orNull(s.lastVisit)}, ${orNull(s.brushing)}, ${s.dentalConcerns || []}, ${orNull(s.dentalNotes)},
        ${s.consent === true}
      )
      RETURNING id
    `;
    return res.status(201).json({ ok: true, id: rows[0].id });
  } catch (err) {
    if (isDuplicateError(err)) {
      return res.status(409).json({ error: duplicateMessage(grade, section, code.gender, code.number) });
    }
    console.error(err);
    return res.status(500).json({ error: "Database error. Please try again." });
  }
}
