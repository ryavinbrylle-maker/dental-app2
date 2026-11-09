// Back end: dental examinations ("visits") — DENTIST ONLY.
//   GET    /api/visits?student_id=5   -> every examination of this student in ALL school years
//                                         (all registrations linked to the same student identity)
//   POST   /api/visits                -> add a NEW examination (never overwrites an older one)
//   PUT    /api/visits?id=12          -> edit an examination (conflict-safe, see _visit.js)
//   DELETE /api/visits?id=12          -> delete one examination (an appointment that pointed to it
//                                         keeps its status; only the link is cleared by the database)
// Each examination keeps its own school year, grade and section (copied when it was made),
// so later changes to the student's class never change old records.
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { createVisit, updateVisit } from "./_visit.js";

const sql = neon(process.env.DATABASE_URL);

function send(res, r, okStatus) {
  if (r.error) return res.status(r.status || 400).json(r);
  return res.status(okStatus || 200).json(r);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isConfigured()) return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }
  const who = process.env.DENTIST_USERNAME;
  try {
    if (req.method === "GET") {
      const studentId = parseInt(req.query.student_id, 10);
      if (!studentId) return res.status(400).json({ error: "student_id is required" });
      const rows = await sql`
        SELECT v.*, s2.identity_id
        FROM students s1
        JOIN students s2 ON s2.id = s1.id OR (s1.identity_id IS NOT NULL AND s2.identity_id = s1.identity_id)
        JOIN visits v ON v.student_id = s2.id
        WHERE s1.id = ${studentId}
        ORDER BY v.visit_date DESC, v.id DESC`;
      return res.status(200).json({ visits: rows });
    }
    if (req.method === "POST") {
      return send(res, await createVisit(sql, req.body || {}, who, null), 201);
    }
    if (req.method === "PUT") {
      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: "id is required" });
      return send(res, await updateVisit(sql, { id: id }, req.body || {}, who, null));
    }
    if (req.method === "DELETE") {
      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: "id is required" });
      await sql`DELETE FROM visits WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error. Did you run the latest schema.sql in Neon?" });
  }
}
