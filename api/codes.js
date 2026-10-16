// Back end: public list of student codes used in each Grade + Section.
// Returns ONLY grade, section and code (no names or health details),
// so the registration page can show the class list and taken codes.
import { neon } from "@neondatabase/serverless";
import { activeYear } from "./_sy.js";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET is allowed" });
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const rows = await sql`
      SELECT grade, section, code_gender, code_number
      FROM students
      WHERE code_number IS NOT NULL AND code_gender IS NOT NULL
        AND grade IS NOT NULL AND section IS NOT NULL
        AND school_year = ${await activeYear(sql)} AND removed_at IS NULL`;
    return res.status(200).json({ codes: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error. Please try again." });
  }
}
