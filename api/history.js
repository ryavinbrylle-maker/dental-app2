// Back end: earlier dental history for a whole class — DENTIST ONLY.
//   GET /api/history?grade=Grade 7&section=Section A
//     -> every examination and appointment (ALL school years) of the students
//        registered in that class this school year.
// The app downloads this when a class is loaded, so previous records can be
// reviewed on the device even without internet.
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { activeYear } from "./_sy.js";
import { cleanText } from "./_visit.js";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isConfigured()) return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Only GET is allowed" });
  const grade = cleanText(req.query.grade, 40), section = cleanText(req.query.section, 40);
  if (!grade || !section) return res.status(400).json({ error: "Grade and section are required" });
  try {
    const year = await activeYear(sql);
    const visits = await sql`
      SELECT v.*, s2.identity_id
      FROM students s1
      JOIN students s2 ON s2.identity_id = s1.identity_id
      JOIN visits v ON v.student_id = s2.id
      WHERE s1.school_year = ${year} AND s1.grade = ${grade} AND s1.section = ${section}
        AND s1.removed_at IS NULL
      ORDER BY v.visit_date DESC, v.id DESC`;
    const appointments = await sql`
      SELECT a.*, s2.identity_id, s2.name, s2.code_gender, s2.code_number,
             s2.allergies, s2.conditions, s2.other_conditions, s2.medications
      FROM students s1
      JOIN students s2 ON s2.identity_id = s1.identity_id
      JOIN appointments a ON a.student_id = s2.id
      WHERE s1.school_year = ${year} AND s1.grade = ${grade} AND s1.section = ${section}
        AND s1.removed_at IS NULL
      ORDER BY a.appointment_date DESC, a.id DESC`;
    return res.status(200).json({ visits: visits, appointments: appointments, school_year: year });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error. Did you run the latest schema.sql in Neon?" });
  }
}
