// Back end: dental appointment queue — DENTIST ONLY.
//   GET  /api/appointments?grade=Grade 1&section=Section A&date=2026-10-05  -> class list for the day
//   GET  /api/appointments?student_id=5   -> the student's appointment history (ALL school years)
//   GET  /api/appointments?absent=1&date=2026-10-05  -> everyone marked Absent that day
//   POST /api/appointments {action:"schedule", grade, section, date}  -> schedule the class (safe to repeat)
//   POST /api/appointments {action:"extra", student_id, date}          -> intentional 2nd appointment
//   PUT  /api/appointments?id=12 {status, notes, visit_id, undo, base_status}
// The offline app sends the same changes in batches through /api/sync (same rules: _appt.js).
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { activeYear } from "./_sy.js";
import { cleanText, validDate } from "./_visit.js";
import { classList, scheduleClass, extraAppointment, changeAppointment } from "./_appt.js";

const sql = neon(process.env.DATABASE_URL);

function send(res, r, okStatus) {
  if (r.error) return res.status(r.status || 400).json(r);
  return res.status(okStatus || 200).json(r);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isConfigured()) {
    return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  }
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }
  const who = process.env.DENTIST_USERNAME;

  try {
    if (req.method === "GET") {
      const studentId = parseInt(req.query.student_id, 10);
      if (studentId) {
        // every registration of the same student identity (earlier school years too)
        const rows = await sql`
          SELECT a.*, st.name, st.code_gender, st.code_number, st.identity_id,
                 COALESCE((SELECT json_agg(json_build_object(
                             'from', e.from_status, 'to', e.to_status,
                             'by', e.changed_by, 'at', e.changed_at) ORDER BY e.changed_at, e.id)
                           FROM appointment_events e WHERE e.appointment_id = a.id), '[]') AS events
          FROM appointments a
          JOIN students st ON st.id = a.student_id
          WHERE a.student_id IN (
            SELECT s2.id FROM students s1 JOIN students s2
              ON s2.identity_id = s1.identity_id OR s2.id = s1.id
            WHERE s1.id = ${studentId})
          ORDER BY a.appointment_date DESC, a.id DESC`;
        return res.status(200).json({ appointments: rows });
      }
      if (req.query.absent) {
        const date = validDate(req.query.date);
        if (!date) return res.status(400).json({ error: "Please choose a valid date." });
        const rows = await sql`
          SELECT a.*, s.name, s.code_gender, s.code_number, s.identity_id
          FROM appointments a
          JOIN students s ON s.id = a.student_id
          WHERE a.status = 'Absent' AND a.appointment_date = ${date}
          ORDER BY a.grade, a.section,
                   CASE s.code_gender WHEN 'M' THEN 0 WHEN 'F' THEN 1 ELSE 2 END,
                   s.code_number NULLS LAST, a.id`;
        return res.status(200).json({ appointments: rows });
      }
      const grade = cleanText(req.query.grade, 40);
      const section = cleanText(req.query.section, 40);
      const date = validDate(req.query.date);
      if (!grade || !section) return res.status(400).json({ error: "Please select a grade and a section first." });
      if (!date) return res.status(400).json({ error: "Please choose a valid date." });
      return res.status(200).json({ appointments: await classList(sql, grade, section, date) });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      if (b.action === "schedule") return send(res, await scheduleClass(sql, await activeYear(sql), b, who));
      if (b.action === "extra") return send(res, await extraAppointment(sql, b, who), 201);
      return res.status(400).json({ error: "Unknown action" });
    }

    if (req.method === "PUT") {
      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: "id is required" });
      return send(res, await changeAppointment(sql, { id: id }, req.body || {}, who, null));
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ error: "This student already has an appointment on that date." });
    }
    console.error(err);
    return res.status(500).json({ error: "Database error. Did you run the latest schema.sql in Neon?" });
  }
}
