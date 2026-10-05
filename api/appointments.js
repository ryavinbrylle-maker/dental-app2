// Back end: dental appointment queue — DENTIST ONLY.
//   GET  /api/appointments?grade=Grade 1&section=Section A&date=2026-10-05
//        -> that class's appointments for the day (with student name + code)
//   GET  /api/appointments?student_id=5       -> one student's appointment history
//   POST /api/appointments {action:"schedule", grade, section, date}
//        -> adds a Waiting appointment for every student in the class who doesn't
//           have one that day yet (safe to call again), then returns the class list
//   POST /api/appointments {action:"extra", student_id, date}
//        -> intentionally adds another appointment for the same student/day
//   PUT  /api/appointments?id=12 {status, result, notes, visit_id}
//        -> Complete / mark Absent / return an absent student to the queue / edit result
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";

const sql = neon(process.env.DATABASE_URL);
const STATUSES = ["Waiting", "Completed", "Absent"];

function cleanText(v, max) {
  const s = String(v === undefined || v === null ? "" : v).trim().slice(0, max);
  return s === "" ? null : s;
}
function validDate(v) {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d) || d.toISOString().slice(0, 10) !== s ? null : s;
}

function classList(grade, section, date) {
  return sql`
    SELECT a.*, s.name, s.code_gender, s.code_number, s.allergies, s.conditions,
           s.other_conditions, s.medications
    FROM appointments a
    JOIN students s ON s.id = a.student_id
    WHERE a.grade = ${grade} AND a.section = ${section} AND a.appointment_date = ${date}
    ORDER BY CASE s.code_gender WHEN 'M' THEN 0 WHEN 'F' THEN 1 ELSE 2 END,
             s.code_number NULLS LAST, a.id`;
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
    // ---------- read ----------
    if (req.method === "GET") {
      const studentId = parseInt(req.query.student_id, 10);
      if (studentId) {
        const rows = await sql`
          SELECT * FROM appointments WHERE student_id = ${studentId}
          ORDER BY appointment_date DESC, id DESC`;
        return res.status(200).json({ appointments: rows });
      }
      const grade = cleanText(req.query.grade, 40);
      const section = cleanText(req.query.section, 40);
      const date = validDate(req.query.date);
      if (!grade || !section) return res.status(400).json({ error: "Please select a grade and a section first." });
      if (!date) return res.status(400).json({ error: "Please choose a valid date." });
      return res.status(200).json({ appointments: await classList(grade, section, date) });
    }

    // ---------- create ----------
    if (req.method === "POST") {
      const b = req.body || {};
      const date = validDate(b.date);
      if (!date) return res.status(400).json({ error: "Please choose a valid date." });

      if (b.action === "schedule") {
        const grade = cleanText(b.grade, 40);
        const section = cleanText(b.section, 40);
        if (!grade || !section) {
          return res.status(400).json({ error: "Please select a grade and a section first." });
        }
        // Everyone in the class with a student code gets one Waiting appointment for the day.
        // Students who already have one that day are skipped (no duplicates).
        await sql`
          INSERT INTO appointments (student_id, appointment_date, grade, section, created_by)
          SELECT id, ${date}::date, grade, section, ${who}::text
          FROM students
          WHERE grade = ${grade} AND section = ${section}
            AND code_gender IS NOT NULL AND code_number IS NOT NULL
          ON CONFLICT (student_id, appointment_date) WHERE NOT extra DO NOTHING`;
        return res.status(200).json({ appointments: await classList(grade, section, date) });
      }

      if (b.action === "extra") {
        const studentId = parseInt(b.student_id, 10);
        if (!studentId) return res.status(400).json({ error: "student_id is required" });
        const rows = await sql`
          INSERT INTO appointments (student_id, appointment_date, grade, section, extra, created_by)
          SELECT id, ${date}::date, grade, section, TRUE, ${who}::text
          FROM students
          WHERE id = ${studentId} AND grade IS NOT NULL AND section IS NOT NULL
          RETURNING *`;
        if (!rows.length) return res.status(400).json({ error: "The student needs a grade and section first." });
        return res.status(201).json({ appointment: rows[0] });
      }
      return res.status(400).json({ error: "Unknown action" });
    }

    // ---------- update (complete / absent / back to queue / edit) ----------
    if (req.method === "PUT") {
      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: "id is required" });
      const b = req.body || {};
      const status = b.status;
      if (!STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });

      const found = await sql`SELECT * FROM appointments WHERE id = ${id}`;
      if (!found.length) return res.status(400).json({ error: "Appointment not found" });
      const cur = found[0];

      // Allowed changes:
      //   Waiting   -> Completed | Absent
      //   Absent    -> Waiting   (student arrived late; the earlier absence is noted)
      //   Completed -> Completed (edit the result/notes)
      const ok = (cur.status === "Waiting" && status !== "Waiting") ||
                 (cur.status === "Absent" && status === "Waiting") ||
                 (cur.status === "Completed" && status === "Completed");
      if (!ok) {
        return res.status(409).json({ error: "This appointment is already marked " + cur.status + "." });
      }

      let result = cleanText(b.result, 200);
      let notes = cleanText(b.notes, 4000);
      const visitId = parseInt(b.visit_id, 10) || null;

      if (status === "Absent") { result = null; }
      // Finishing a queued appointment keeps any earlier system note (e.g. an earlier absence)
      if (cur.status === "Waiting" && cur.notes) {
        notes = [cur.notes, notes].filter(Boolean).join("\n");
      }
      if (status === "Waiting") {
        // keep a trace of the earlier absence in the notes
        notes = [cur.notes, "Was marked absent earlier, then arrived and returned to the queue."]
          .filter(Boolean).join("\n");
        result = null;
      }

      // finished_at: cleared when back in the queue, kept when only editing, set now otherwise
      const finish = status === "Waiting" ? "clear" : status === cur.status ? "keep" : "now";
      const rows = await sql`
        UPDATE appointments
        SET status = ${status},
            result = ${result},
            notes = ${notes},
            visit_id = COALESCE(${visitId}::int, visit_id),
            finished_at = CASE ${finish}::text WHEN 'clear' THEN NULL
                                               WHEN 'keep' THEN finished_at
                                               ELSE NOW() END
        WHERE id = ${id}
        RETURNING *`;
      return res.status(200).json({ appointment: rows[0] });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ error: "This student already has an appointment on that date." });
    }
    console.error(err);
    return res.status(500).json({ error: "Database error. Did you run the appointments part of schema.sql?" });
  }
}
