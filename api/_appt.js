// Shared rules for dental appointments, used by api/appointments.js and api/sync.js.
import { cleanText, validDate, cleanUid, findVisit } from "./_visit.js";

// Waiting      = scheduled, not seen yet
// Late Arrival = was marked Absent, then arrived – back in the queue for treatment
// Completed    = seen (exam recorded)
// Absent       = did not come (yet)
export const APPT_STATUSES = ["Waiting", "Late Arrival", "Completed", "Absent"];

export function classList(sql, grade, section, date) {
  return sql`
    SELECT a.*, s.name, s.code_gender, s.code_number, s.allergies, s.conditions,
           s.other_conditions, s.medications, s.identity_id
    FROM appointments a
    JOIN students s ON s.id = a.student_id
    WHERE a.grade = ${grade} AND a.section = ${section} AND a.appointment_date = ${date}
    ORDER BY CASE s.code_gender WHEN 'M' THEN 0 WHEN 'F' THEN 1 ELSE 2 END,
             s.code_number NULLS LAST, a.id`;
}

// One Waiting appointment per student of the class (active school year) for the day.
// items = [{student_id, client_uid}] lets an offline device keep its own ids. Safe to repeat.
export async function scheduleClass(sql, year, b, who) {
  const grade = cleanText(b.grade, 40), section = cleanText(b.section, 40), date = validDate(b.date);
  if (!grade || !section) return { status: 400, error: "Please select a grade and a section first." };
  if (!date) return { status: 400, error: "Please choose a valid date." };
  const items = (Array.isArray(b.items) ? b.items : [])
    .map(function (i) { return { student_id: parseInt(i.student_id, 10), client_uid: cleanUid(i.client_uid) }; })
    .filter(function (i) { return i.student_id && i.client_uid; });
  await sql`
    INSERT INTO appointments (student_id, appointment_date, grade, section, school_year, created_by, client_uid)
    SELECT s.id, ${date}::date, s.grade, s.section, s.school_year, ${who}::text, m.client_uid
    FROM students s
    LEFT JOIN jsonb_to_recordset(${JSON.stringify(items)}::jsonb) AS m(student_id int, client_uid text)
           ON m.student_id = s.id
    WHERE s.school_year = ${year} AND s.grade = ${grade} AND s.section = ${section}
      AND s.code_gender IS NOT NULL AND s.code_number IS NOT NULL AND s.removed_at IS NULL
    ON CONFLICT (student_id, appointment_date) WHERE NOT extra DO NOTHING`;
  return { appointments: await classList(sql, grade, section, date) };
}

export async function extraAppointment(sql, b, who) {
  const studentId = parseInt(b.student_id, 10), date = validDate(b.date);
  if (!studentId) return { status: 400, error: "student_id is required" };
  if (!date) return { status: 400, error: "Please choose a valid date." };
  const uid = cleanUid(b.client_uid);
  if (uid) {
    const ex = await sql`SELECT * FROM appointments WHERE client_uid = ${uid}`;
    if (ex.length) return { appointment: ex[0], duplicate: true };
  }
  const rows = await sql`
    INSERT INTO appointments (student_id, appointment_date, grade, section, school_year, extra, created_by, client_uid)
    SELECT id, ${date}::date, grade, section, school_year, TRUE, ${who}::text, ${uid}::text
    FROM students
    WHERE id = ${studentId} AND grade IS NOT NULL AND section IS NOT NULL
    RETURNING *`;
  if (!rows.length) return { status: 400, error: "The student needs a grade and section first." };
  return { appointment: rows[0] };
}

// Find an appointment by server id, then device id, then (student, date) for normal appointments
export async function resolveAppointment(sql, ref) {
  ref = ref || {};
  const id = parseInt(ref.id, 10);
  if (id) {
    const r = await sql`SELECT * FROM appointments WHERE id = ${id}`;
    if (r.length) return r[0];
  }
  const uid = cleanUid(ref.client_uid);
  if (uid) {
    const r = await sql`SELECT * FROM appointments WHERE client_uid = ${uid}`;
    if (r.length) return r[0];
  }
  const sid = parseInt(ref.student_id, 10), date = validDate(ref.date);
  if (sid && date && !ref.extra) {
    const r = await sql`SELECT * FROM appointments WHERE student_id = ${sid}
                        AND appointment_date = ${date} AND NOT extra`;
    if (r.length) return r[0];
  }
  return null;
}

// Complete / Absent / Mark as Arrived / undo a mistaken absence / edit notes.
// Conflict policy: the device sends base_status = the status it saw. If the server has
// a different status, nothing is overwritten:
//   - same result already on the server -> treated as done (no duplicate)
//   - different result                  -> { conflict } for the dentist to resolve
export async function changeAppointment(sql, ref, b, who, opId) {
  const cur = await resolveAppointment(sql, ref);
  if (!cur) return { status: 400, error: "Appointment not found" };
  if (opId && cur.last_op_id === opId) return { appointment: cur, duplicate: true };
  const status = b.status;
  if (!APPT_STATUSES.includes(status)) return { status: 400, error: "Invalid status" };
  const undo = b.undo === true;

  let target = status;
  if (undo) {
    const prev = await sql`
      SELECT from_status FROM appointment_events
      WHERE appointment_id = ${cur.id} AND to_status = 'Absent'
      ORDER BY changed_at DESC, id DESC LIMIT 1`;
    target = prev.length && prev[0].from_status === "Late Arrival" ? "Late Arrival" : "Waiting";
  }

  if (b.base_status && b.base_status !== cur.status) {
    if (cur.status === target && !(status === "Completed" && b.visit_ref && !cur.visit_id)) {
      return { appointment: cur, duplicate: true };
    }
    return { status: 409, conflict: true, appointment: cur,
             error: "Already marked " + cur.status + " on another device – your change (" + target + ") was not applied." };
  }

  const inQueue = cur.status === "Waiting" || cur.status === "Late Arrival";
  const ok = (inQueue && (status === "Completed" || status === "Absent")) ||
             (cur.status === "Absent" && status === "Late Arrival") ||
             (cur.status === "Absent" && status === "Waiting" && undo) ||
             (cur.status === "Completed" && status === "Completed");
  if (!ok) {
    return { status: 409, conflict: true, appointment: cur,
             error: "This appointment is already marked " + cur.status + "." };
  }

  let result = status === "Completed" ? cleanText(b.result, 200) : null;
  if (status === "Completed" && !result && cur.status === "Completed") result = cur.result;
  let notes = cleanText(b.notes, 4000);
  if (status === "Late Arrival" || status === "Waiting") notes = cur.notes;
  else if (inQueue && cur.notes) notes = [cur.notes, notes].filter(Boolean).join("\n");

  let visitId = parseInt(b.visit_id, 10) || null;
  if (!visitId && b.visit_ref) {
    const v = await findVisit(sql, b.visit_ref);
    if (!v) return { status: 400, error: "The examination for this appointment was not uploaded yet." };
    visitId = v.id;
  }

  const mode = status === "Absent" ? "absent"
             : undo ? (target === "Late Arrival" ? "undo-late" : "undo")
             : status === "Late Arrival" ? "arrived"
             : status === cur.status ? "edit" : "finish";

  // update + history entry in ONE statement; "status = cur.status" stops two devices at once
  const rows = await sql`
    WITH upd AS (
      UPDATE appointments
      SET status = ${target},
          result = ${result},
          notes = ${notes},
          visit_id = COALESCE(${visitId}::int, visit_id),
          was_absent = CASE ${mode}::text WHEN 'absent' THEN TRUE
                                          WHEN 'undo' THEN FALSE ELSE was_absent END,
          absent_at  = CASE ${mode}::text WHEN 'absent' THEN COALESCE(absent_at, NOW())
                                          WHEN 'undo' THEN NULL ELSE absent_at END,
          arrived_at = CASE ${mode}::text WHEN 'arrived' THEN NOW() ELSE arrived_at END,
          finished_at = CASE ${mode}::text WHEN 'arrived' THEN NULL
                                           WHEN 'undo' THEN NULL
                                           WHEN 'undo-late' THEN NULL
                                           WHEN 'edit' THEN finished_at
                                           ELSE NOW() END,
          last_op_id = ${opId || null}::text,
          updated_at = NOW()
      WHERE id = ${cur.id} AND status = ${cur.status}::text
      RETURNING *
    ), ev AS (
      INSERT INTO appointment_events (appointment_id, from_status, to_status, changed_by)
      SELECT id, ${cur.status}::text, ${undo ? target + " (undo absent)" : target}::text, ${who}::text
      FROM upd WHERE ${cur.status}::text <> ${target}::text
    )
    SELECT * FROM upd`;
  if (!rows.length) {
    const now = await resolveAppointment(sql, { id: cur.id });
    return { status: 409, conflict: true, appointment: now,
             error: "Someone else just changed this appointment." };
  }
  return { appointment: rows[0] };
}
