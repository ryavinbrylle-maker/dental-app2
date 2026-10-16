// Shared rules for dental examinations ("visits"), used by api/visits.js and api/sync.js.

export const STATUSES = ["Sound", "Decayed", "Missing", "Filled", "Fractured", "Sealant",
                         "Root Fragment", "Impacted", "Crowded", "Temporary Filled"];

// FDI tooth numbers: permanent 11-18, 21-28, 31-38, 41-48; primary 51-55, 61-65, 71-75, 81-85
const VALID_TEETH = new Set();
[[1, 8], [2, 8], [3, 8], [4, 8], [5, 5], [6, 5], [7, 5], [8, 5]].forEach(function (q) {
  for (let i = 1; i <= q[1]; i++) VALID_TEETH.add(String(q[0] * 10 + i));
});

export function cleanText(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, max);
  return s === "" ? null : s;
}
export function validDate(v) {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d) || d.toISOString().slice(0, 10) !== s ? null : s;
}
export function cleanUid(v) {
  const s = String(v || "");
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

// Each tooth can have SEVERAL conditions; "Sound" can't be combined with a problem.
// Old records ({status}) are accepted. Returns { teeth } or { error }.
export function cleanTeeth(teeth) {
  const out = {};
  if (teeth === undefined || teeth === null) return { teeth: out };
  if (typeof teeth !== "object" || Array.isArray(teeth)) return { error: "Tooth map data is invalid." };
  for (const k of Object.keys(teeth)) {
    const t = teeth[k] || {};
    if (!VALID_TEETH.has(k)) return { error: "Unknown tooth number: " + k };
    let list = Array.isArray(t.conditions) ? t.conditions : (t.status ? [t.status] : []);
    const bad = list.filter(function (c) { return !STATUSES.includes(c); });
    if (bad.length) return { error: "Unknown condition on tooth " + k + ": " + bad.join(", ") };
    list = STATUSES.filter(function (c) { return list.includes(c); });
    if (list.length > 1) list = list.filter(function (c) { return c !== "Sound"; });
    const note = cleanText(t.note, 200) || "";
    if (!list.length && note) list = ["Sound"];
    if (list.length) out[k] = { conditions: list, note: note };
  }
  return { teeth: out };
}

// DMFT counts each tooth once (WHO): Missing > Decayed > Filled.
// Retained root fragments and temporary fillings count as decayed (WHO rule).
export function dmft(teeth) {
  const c = { d: 0, m: 0, f: 0 };
  Object.values(teeth).forEach(function (t) {
    const l = t.conditions;
    if (l.includes("Missing")) c.m++;
    else if (l.includes("Decayed") || l.includes("Root Fragment") || l.includes("Temporary Filled")) c.d++;
    else if (l.includes("Filled")) c.f++;
  });
  return c;
}

async function findVisit(sql, ref) {
  ref = ref || {};
  const id = parseInt(ref.id, 10);
  if (id) {
    const r = await sql`SELECT * FROM visits WHERE id = ${id}`;
    if (r.length) return r[0];
  }
  const uid = cleanUid(ref.client_uid);
  if (uid) {
    const r = await sql`SELECT * FROM visits WHERE client_uid = ${uid}`;
    if (r.length) return r[0];
  }
  return null;
}
export { findVisit };

// New examination = always a NEW record (never overwrites an older one).
// Safe to repeat: the device's client_uid makes a 2nd upload return the same record.
export async function createVisit(sql, b, who, opId) {
  const studentId = parseInt(b.student_id, 10);
  if (!studentId) return { status: 400, error: "student_id is required" };
  const cleaned = cleanTeeth(b.teeth);
  if (cleaned.error) return { status: 400, error: cleaned.error };
  const uid = cleanUid(b.client_uid);
  if (uid) {
    const existing = await sql`SELECT * FROM visits WHERE client_uid = ${uid}`;
    if (existing.length) return { visit: existing[0], duplicate: true };
  }
  const reg = await sql`SELECT id, grade, section, school_year FROM students WHERE id = ${studentId}`;
  if (!reg.length) return { status: 400, error: "Student not found" };
  const teeth = cleaned.teeth, counts = dmft(teeth);
  const date = validDate(b.visit_date) || new Date().toISOString().slice(0, 10);
  const rows = await sql`
    INSERT INTO visits (student_id, visit_date, symptoms, chief_complaint, teeth, exam_notes,
                        decayed, missing, filled, created_by, school_year, grade, section,
                        client_uid, last_op_id, updated_at)
    VALUES (${studentId}, ${date}, ${Array.isArray(b.symptoms) ? b.symptoms.slice(0, 20).map(String) : []},
            ${cleanText(b.chief_complaint, 2000)}, ${JSON.stringify(teeth)}::jsonb, ${cleanText(b.exam_notes, 4000)},
            ${counts.d}, ${counts.m}, ${counts.f}, ${who}, ${reg[0].school_year},
            ${reg[0].grade}, ${reg[0].section}, ${uid}, ${opId || null}, NOW())
    ON CONFLICT (client_uid) DO NOTHING
    RETURNING *`;
  if (rows.length) return { visit: rows[0] };
  const again = await sql`SELECT * FROM visits WHERE client_uid = ${uid}`;   // raced with itself
  return { visit: again[0], duplicate: true };
}

// Edit an examination. Only fields that are sent are changed (old chief complaints etc. stay).
// Conflict rule: if the record changed on the server after the device last saw it
// (base_updated_at), nothing is overwritten -> { conflict }.
export async function updateVisit(sql, ref, b, who, opId) {
  const cur = await findVisit(sql, ref);
  if (!cur) return { status: 400, error: "Examination not found" };
  if (opId && cur.last_op_id === opId) return { visit: cur, duplicate: true };
  if (b.base_updated_at && cur.updated_at &&
      new Date(cur.updated_at).getTime() > new Date(b.base_updated_at).getTime() + 1) {
    return { status: 409, conflict: true, visit: cur,
             error: "This examination was changed on another device after you opened it." };
  }
  let teeth = cur.teeth, counts = { d: cur.decayed, m: cur.missing, f: cur.filled };
  if (b.teeth !== undefined) {
    const cleaned = cleanTeeth(b.teeth);
    if (cleaned.error) return { status: 400, error: cleaned.error };
    teeth = cleaned.teeth; counts = dmft(teeth);
  }
  const notes = b.exam_notes !== undefined ? cleanText(b.exam_notes, 4000) : cur.exam_notes;
  const date = b.visit_date !== undefined ? (validDate(b.visit_date) || cur.visit_date) : cur.visit_date;
  const rows = await sql`
    UPDATE visits
    SET teeth = ${JSON.stringify(teeth)}::jsonb, exam_notes = ${notes}, visit_date = ${date},
        decayed = ${counts.d}, missing = ${counts.m}, filled = ${counts.f},
        last_op_id = ${opId || null}, updated_at = NOW()
    WHERE id = ${cur.id}
    RETURNING *`;
  return { visit: rows[0] };
}
