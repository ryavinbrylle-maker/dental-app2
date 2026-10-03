// Back end: receives the registration form and saves it to Neon.
// Runs on Vercel as a serverless function at /api/register.
import { neon } from "@neondatabase/serverless";

// DATABASE_URL is added automatically when you connect Neon in Vercel.
const sql = neon(process.env.DATABASE_URL);

// Turn empty text into null so the database stores "no value"
function orNull(v) {
  return v === undefined || v === null || v === "" ? null : v;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed" });
  }

  const s = req.body || {};

  // Basic checks (the form checks these too, but never trust the browser)
  if (!s.name || typeof s.name !== "string") {
    return res.status(400).json({ error: "Student name is required" });
  }
  // Everything else is optional, but if an LRN is given it must be 12 digits
  if (s.lrn && !/^[0-9]{12}$/.test(s.lrn)) {
    return res.status(400).json({ error: "LRN must be 12 digits" });
  }

  try {
    const rows = await sql`
      INSERT INTO students (
        lrn, name, birthdate, age, sex, blood_type, grade, section,
        height_cm, weight_kg, address,
        parent_name, relationship, contact, emergency_contact,
        conditions, other_conditions, allergies, medications,
        last_visit, brushing, dental_concerns, dental_notes,
        consent
      ) VALUES (
        ${orNull(s.lrn)}, ${s.name.trim()}, ${orNull(s.birthdate)}, ${orNull(s.age)},
        ${orNull(s.sex)}, ${orNull(s.bloodType)}, ${orNull(s.grade)}, ${orNull(s.section)},
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
    console.error(err);
    return res.status(500).json({ error: "Database error. Please try again." });
  }
}
