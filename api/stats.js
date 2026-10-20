// Back end: dashboard summary for the dentist — DENTIST ONLY. Every number comes from the database.
//   GET /api/stats?date=2026-10-20   (the dentist's own "today", so the time zone is right)
//   -> { school_year, students, examined_students, examinations,
//        today: { date, total, Waiting, "Late Arrival", Completed, Absent },
//        recent: [ { visit_date, name, code, grade, section } ]  (latest 5 examinations) }
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { activeYear } from "./_sy.js";
import { validDate } from "./_visit.js";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isConfigured()) return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Only GET is allowed" });
  const day = validDate(req.query.date) || new Date().toISOString().slice(0, 10);
  try {
    const year = await activeYear(sql);
    const counts = await sql`
      SELECT
        (SELECT COUNT(*) FROM students s WHERE s.school_year = ${year} AND s.removed_at IS NULL)::int AS students,
        (SELECT COUNT(DISTINCT v.student_id) FROM visits v JOIN students s ON s.id = v.student_id
          WHERE v.school_year = ${year} AND s.removed_at IS NULL)::int AS examined_students,
        (SELECT COUNT(*) FROM visits v WHERE v.school_year = ${year})::int AS examinations`;
    const today = await sql`
      SELECT a.status, COUNT(*)::int AS n FROM appointments a
      JOIN students s ON s.id = a.student_id AND s.removed_at IS NULL
      WHERE a.appointment_date = ${day}::date GROUP BY a.status`;
    const recent = await sql`
      SELECT v.visit_date, s.name, s.grade, s.section,
             CASE WHEN s.code_gender IS NOT NULL THEN s.code_gender || '-' || s.code_number END AS code
      FROM visits v JOIN students s ON s.id = v.student_id
      WHERE v.school_year = ${year} AND s.removed_at IS NULL
      ORDER BY v.created_at DESC, v.id DESC LIMIT 5`;
    const t = { date: day, total: 0, "Waiting": 0, "Late Arrival": 0, "Completed": 0, "Absent": 0 };
    today.forEach(function (r) { t[r.status] = r.n; t.total += r.n; });
    return res.status(200).json(Object.assign({ school_year: year, today: t, recent: recent }, counts[0]));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error. Did you run the latest schema.sql in Neon?" });
  }
}
