// Back end: dental appointment queue — DENTIST ONLY.
//   GET  /api/appointments?grade=Grade 1&section=Section A&date=2026-10-05
//        -> that class's appointments for the day (with student name + code)
//   GET  /api/appointments?student_id=5       -> one student's appointment history
//   POST /api/appointments {action:"schedule", grade, section, date}
//        -> adds a Waiting appointment for every student in the class who doesn't
//           have one that day yet (safe to call again), then returns the class list
//   POST /api/appointments {action:"extra", student_id, date}
//        -> intentionally adds another appointment for the same student/day
//   GET  /api/appointments?absent=1&date=2026-10-05
//        -> every student marked Absent that day (all grades/sections), with name + code
//   PUT  /api/appointments?id=12 {status, result, notes, visit_id, undo}
//        -> Complete / mark Absent / Mark as Arrived (Absent -> Late Arrival) /
//           undo a mistaken absence (Absent -> Waiting, undo:true) / edit result
//   Every status change is written to appointment_events (who, when, from -> to).
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";

const sql = neon(process.env.DATABASE_URL);
// Waiting      = scheduled, not seen yet
// Late Arrival = was marked Absent, then arrived – back in the queue for treatment
// Completed    = seen (result recorded)
// Absent       = did not come (yet)
const STATUSES = ["Waiting", "Late Arrival", "Completed", "Absent"];

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
          SELECT a.*,
                 COALESCE((SELECT json_agg(json_build_object(
                             'from', e.from_status, 'to', e.to_status,
                             'by', e.changed_by, 'at', e.changed_at) ORDER BY e.changed_at, e.id)
                           FROM appointment_events e WHERE e.appointment_id = a.id), '[]') AS events
          FROM appointments a WHERE a.student_id = ${studentId}
          ORDER BY a.appointment_date DESC, a.id DESC`;
        return res.status(200).json({ appointments: rows });
      }
      if (req.query.absent) {
        const date = validDate(req.query.date);
        if (!date) return res.status(400).json({ error: "Please choose a valid date." });
        const rows = await sql`
          SELECT a.*, s.name, s.code_gender, s.code_number
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

    // ---------- update (complete / absent / arrived / undo / edit) ----------
    if (req.method === "PUT") {
      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: "id is required" });
      const b = req.body || {};
      const status = b.status;
      if (!STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });

      const found = await sql`SELECT * FROM appointments WHERE id = ${id}`;
      if (!found.length) return res.status(400).json({ error: "Appointment not found" });
      const cur = found[0];
      const undo = b.undo === true;

      // Allowed changes:
      //   Waiting / Late Arrival -> Completed | Absent
      //   Absent    -> Late Arrival   ("Mark as Arrived": student came late, absence is kept)
      //   Absent    -> Waiting        (only with undo:true – the absence was a mistake)
      //   Completed -> Completed      (edit the result/notes)
      const inQueue = cur.status === "Waiting" || cur.status === "Late Arrival";
      const ok = (inQueue && (status === "Completed" || status === "Absent")) ||
                 (cur.status === "Absent" && status === "Late Arrival") ||
                 (cur.status === "Absent" && status === "Waiting" && undo) ||
                 (cur.status === "Completed" && status === "Completed");
      if (!ok) {
        return res.status(409).json({ error: "This appointment is already marked " + cur.status + "." });
      }

      // Undo a mistaken absence: go back to what the student was before (Waiting or Late Arrival)
      let target = status;
      if (undo) {
        const prev = await sql`
          SELECT from_status FROM appointment_events
          WHERE appointment_id = ${id} AND to_status = 'Absent'
          ORDER BY changed_at DESC, id DESC LIMIT 1`;
        target = prev.length && prev[0].from_status === "Late Arrival" ? "Late Arrival" : "Waiting";
      }

      let result = status === "Completed" ? cleanText(b.result, 200) : null;
      let notes = cleanText(b.notes, 4000);
      const visitId = parseInt(b.visit_id, 10) || null;
      if (status === "Completed" && !result) {
        return res.status(400).json({ error: "Please choose the appointment result." });
      }
      // Status-only changes keep the existing notes; finishing keeps earlier notes too
      if (status === "Late Arrival" || status === "Waiting") notes = cur.notes;
      else if (inQueue && cur.notes) notes = [cur.notes, notes].filter(Boolean).join("\n");

      // What happens to the timestamps / absence flag
      //   Absent       -> absent_at = now, was_absent = true (kept forever)
      //   Late Arrival -> arrived_at = now (absence kept)
      //   undo         -> the absence never happened
      //   undo back to Late Arrival -> nothing about the earlier real absence changes
      const mode = status === "Absent" ? "absent"
                 : undo ? (target === "Late Arrival" ? "undo-late" : "undo")
                 : status === "Late Arrival" ? "arrived"
                 : status === cur.status ? "edit" : "finish";

      // One statement = update + history entry together. The "status = cur.status" check
      // stops two devices from changing the same appointment at once.
      const rows = await sql`
        WITH upd AS (
          UPDATE appointments
          SET status = ${target},
              result = ${result},
              notes = ${notes},
              visit_id = COALESCE(${visitId}::int, visit_id),
              was_absent = CASE ${mode}::text WHEN 'absent' THEN TRUE
                                              WHEN 'undo' THEN FALSE ELSE was_absent END,
              -- the FIRST absence time is kept if the student is marked absent again
              absent_at  = CASE ${mode}::text WHEN 'absent' THEN COALESCE(absent_at, NOW())
                                              WHEN 'undo' THEN NULL ELSE absent_at END,
              arrived_at = CASE ${mode}::text WHEN 'arrived' THEN NOW() ELSE arrived_at END,
              finished_at = CASE ${mode}::text WHEN 'arrived' THEN NULL
                                               WHEN 'undo' THEN NULL
                                               WHEN 'undo-late' THEN NULL
                                               WHEN 'edit' THEN finished_at
                                               ELSE NOW() END
          WHERE id = ${id} AND status = ${cur.status}::text
          RETURNING *
        ), ev AS (
          INSERT INTO appointment_events (appointment_id, from_status, to_status, changed_by)
          SELECT id, ${cur.status}::text, ${undo ? target + " (undo absent)" : target}::text, ${who}::text
          FROM upd WHERE ${cur.status}::text <> ${target}::text
        )
        SELECT * FROM upd`;
      if (!rows.length) {
        return res.status(409).json({ error: "Someone else just changed this appointment. The list has been refreshed." });
      }
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
