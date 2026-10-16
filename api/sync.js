// Back end: batch upload of changes saved on the dentist's device (StudentStorageInfo) — DENTIST ONLY.
//   POST /api/sync { ops: [ { op_id, type, payload }, ... ] }   (max 50 per request)
// Each op has a unique op_id made on the device. An op that was already processed is
// NOT applied again – the stored result is returned (safe retries, no duplicates).
// Results: { results: [ { op_id, ok, conflict?, error?, appointment?, visit?, appointments? } ] }
// Op types:
//   visit.create   { client_uid, student_id, visit_date, teeth, exam_notes }
//   visit.update   { ref:{id|client_uid}, base_updated_at, teeth, exam_notes }
//   appt.schedule  { grade, section, date, items:[{student_id, client_uid}] }
//   appt.extra     { client_uid, student_id, date }
//   appt.update    { ref:{id|client_uid|student_id+date}, base_status, status, notes, visit_ref, undo }
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { activeYear } from "./_sy.js";
import { createVisit, updateVisit } from "./_visit.js";
import { scheduleClass, extraAppointment, changeAppointment } from "./_appt.js";

const sql = neon(process.env.DATABASE_URL);
const MAX_OPS = 50;

async function apply(op, who, year) {
  const p = op.payload || {};
  switch (op.type) {
    case "visit.create":  return createVisit(sql, p, who, op.op_id);
    case "visit.update":  return updateVisit(sql, p.ref, p, who, op.op_id);
    case "appt.schedule": return scheduleClass(sql, year, p, who);
    case "appt.extra":    return extraAppointment(sql, p, who);
    case "appt.update":   return changeAppointment(sql, p.ref, p, who, op.op_id);
    default:              return { status: 400, error: "Unknown change type: " + op.type };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isConfigured()) return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST is allowed" });
  const ops = (req.body && Array.isArray(req.body.ops)) ? req.body.ops : null;
  if (!ops) return res.status(400).json({ error: "ops is required" });
  if (ops.length > MAX_OPS) return res.status(400).json({ error: "Too many changes in one upload (max " + MAX_OPS + ")" });
  const who = process.env.DENTIST_USERNAME;

  let year;
  try { year = await activeYear(sql); }
  catch (e) { console.error(e); return res.status(503).json({ error: "Database not reachable, try again later." }); }

  const results = [];
  for (const op of ops) {
    const opId = String((op && op.op_id) || "");
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(opId)) { results.push({ op_id: opId, ok: false, error: "Invalid op_id" }); continue; }
    try {
      const done = await sql`SELECT result FROM sync_ops WHERE op_id = ${opId}`;
      if (done.length) { results.push(Object.assign({}, done[0].result, { op_id: opId, replay: true })); continue; }

      const r = await apply(op, who, year);
      const out = { op_id: opId, ok: !r.error };
      ["error", "conflict", "duplicate", "appointment", "visit", "appointments"].forEach(function (k) {
        if (r[k] !== undefined) out[k] = r[k];
      });
      if (r.error) out.http = r.status || 400;
      // remember the outcome so a retry never applies the change twice
      await sql`INSERT INTO sync_ops (op_id, op_type, result) VALUES (${opId}, ${op.type}, ${JSON.stringify(out)}::jsonb)
                ON CONFLICT (op_id) DO NOTHING`;
      results.push(out);
    } catch (err) {
      // temporary problem: NOT stored, so the device will retry this op later
      console.error("sync op failed", opId, err);
      results.push({ op_id: opId, ok: false, retry: true, error: "Temporary server problem – will retry." });
    }
  }
  return res.status(200).json({ results: results, school_year: year });
}
