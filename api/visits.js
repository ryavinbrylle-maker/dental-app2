// Back end: dental check-up visits — DENTIST ONLY.
//   GET    /api/visits?student_id=5   -> all visits for a student
//   POST   /api/visits                -> add a visit
//   PUT    /api/visits?id=12          -> edit a visit
//   DELETE /api/visits?id=12          -> delete a visit
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";

const sql = neon(process.env.DATABASE_URL);

const STATUSES = ["Sound", "Decayed", "Missing", "Filled", "Fractured", "Sealant"];

// FDI tooth numbers: permanent 11-18, 21-28, 31-38, 41-48; primary 51-55, 61-65, 71-75, 81-85
const VALID_TEETH = new Set();
[[1, 8], [2, 8], [3, 8], [4, 8], [5, 5], [6, 5], [7, 5], [8, 5]].forEach(function (q) {
  for (let i = 1; i <= q[1]; i++) VALID_TEETH.add(String(q[0] * 10 + i));
});

function cleanText(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, max);
  return s === "" ? null : s;
}

// Each tooth can have SEVERAL conditions at once, e.g.
//   { "28": { "conditions": ["Decayed", "Sealant"], "note": "" } }
// "Sound" means "checked and healthy", so it can't be combined with a problem.
// Old records ({ "status": "Decayed" }) are still accepted and converted.
// Returns { teeth } or { error }.
function cleanTeeth(teeth) {
  const out = {};
  if (teeth === undefined || teeth === null) return { teeth: out };
  if (typeof teeth !== "object" || Array.isArray(teeth)) return { error: "Tooth map data is invalid." };
  const keys = Object.keys(teeth);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const t = teeth[k] || {};
    if (!VALID_TEETH.has(k)) return { error: "Unknown tooth number: " + k };
    let list = Array.isArray(t.conditions) ? t.conditions : (t.status ? [t.status] : []);
    const bad = list.filter(function (c) { return !STATUSES.includes(c); });
    if (bad.length) return { error: "Unknown condition on tooth " + k + ": " + bad.join(", ") };
    list = STATUSES.filter(function (c) { return list.includes(c); }); // no duplicates, fixed order
    if (list.length > 1) list = list.filter(function (c) { return c !== "Sound"; });
    const note = cleanText(t.note, 200) || "";
    if (!list.length && note) list = ["Sound"];
    if (list.length) out[k] = { conditions: list, note: note };
  }
  return { teeth: out };
}

// DMFT counts each tooth once (WHO rule): Missing > Decayed > Filled
function dmft(teeth) {
  const c = { d: 0, m: 0, f: 0 };
  Object.values(teeth).forEach(function (t) {
    const l = t.conditions;
    if (l.includes("Missing")) c.m++;
    else if (l.includes("Decayed")) c.d++;
    else if (l.includes("Filled")) c.f++;
  });
  return c;
}

function cleanSymptoms(list) {
  if (!Array.isArray(list)) return [];
  return list.map(function (s) { return cleanText(s, 40); }).filter(Boolean).slice(0, 20);
}

function validDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? v : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isConfigured()) {
    return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  }
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }

  try {
    if (req.method === "GET") {
      const studentId = parseInt(req.query.student_id, 10);
      if (!studentId) return res.status(400).json({ error: "student_id is required" });
      const rows = await sql`
        SELECT * FROM visits WHERE student_id = ${studentId}
        ORDER BY visit_date DESC, id DESC`;
      return res.status(200).json({ visits: rows });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const b = req.body || {};
      const cleaned = cleanTeeth(b.teeth);
      if (cleaned.error) return res.status(400).json({ error: cleaned.error });
      const teeth = cleaned.teeth;
      const date = validDate(b.visit_date) || new Date().toISOString().slice(0, 10);
      const symptoms = cleanSymptoms(b.symptoms);
      const complaint = cleanText(b.chief_complaint, 2000);
      const notes = cleanText(b.exam_notes, 4000);
      const counts = dmft(teeth);
      const d = counts.d, m = counts.m, f = counts.f;

      if (req.method === "POST") {
        const studentId = parseInt(b.student_id, 10);
        if (!studentId) return res.status(400).json({ error: "student_id is required" });
        const rows = await sql`
          INSERT INTO visits (student_id, visit_date, symptoms, chief_complaint, teeth,
                              exam_notes, decayed, missing, filled, created_by)
          VALUES (${studentId}, ${date}, ${symptoms}, ${complaint}, ${JSON.stringify(teeth)}::jsonb,
                  ${notes}, ${d}, ${m}, ${f}, ${process.env.DENTIST_USERNAME})
          RETURNING *`;
        return res.status(201).json({ visit: rows[0] });
      }

      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: "id is required" });
      const rows = await sql`
        UPDATE visits SET visit_date = ${date}, symptoms = ${symptoms},
               chief_complaint = ${complaint}, teeth = ${JSON.stringify(teeth)}::jsonb,
               exam_notes = ${notes}, decayed = ${d}, missing = ${m}, filled = ${f}
        WHERE id = ${id}
        RETURNING *`;
      if (!rows.length) return res.status(400).json({ error: "Visit not found" });
      return res.status(200).json({ visit: rows[0] });
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
    return res.status(500).json({ error: "Database error. Did you run the visits part of schema.sql?" });
  }
}
