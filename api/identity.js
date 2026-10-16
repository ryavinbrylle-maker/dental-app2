// Back end: returning-student check — DENTIST ONLY.
//   GET  /api/identity               -> possible returning students waiting for confirmation
//   POST /api/identity {match_id, decision:"link"}    -> same student: join their dental history
//   POST /api/identity {match_id, decision:"reject"}  -> different student: keep separate
//   POST /api/identity {student_id, decision:"unlink"} -> undo a wrong link (new separate identity)
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { nameKey, nameCompact } from "./_identity.js";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isConfigured()) return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }
  const who = process.env.DENTIST_USERNAME;
  try {
    if (req.method === "GET") {
      const rows = await sql`
        SELECT m.id AS match_id, m.reason, m.created_at,
               json_build_object('id', s.id, 'name', s.name, 'grade', s.grade, 'section', s.section,
                                 'school_year', s.school_year, 'birthdate', s.birthdate,
                                 'code', CASE WHEN s.code_gender IS NOT NULL THEN s.code_gender || '-' || s.code_number END,
                                 'parent_name', s.parent_name) AS registration,
               (SELECT json_agg(json_build_object('id', o.id, 'name', o.name, 'grade', o.grade, 'section', o.section,
                                  'school_year', o.school_year, 'birthdate', o.birthdate, 'parent_name', o.parent_name,
                                  'examinations', (SELECT COUNT(*) FROM visits v WHERE v.student_id = o.id))
                                ORDER BY o.school_year)
                FROM students o WHERE o.identity_id = m.candidate_identity_id) AS candidate
        FROM identity_matches m JOIN students s ON s.id = m.student_id
        WHERE m.status = 'pending' AND s.removed_at IS NULL
        ORDER BY m.created_at, m.id`;
      return res.status(200).json({ matches: rows });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const b = req.body || {};

    if (b.decision === "unlink") {
      const sid = parseInt(b.student_id, 10);
      const st = await sql`SELECT id, name, birthdate FROM students WHERE id = ${sid}`;
      if (!st.length) return res.status(400).json({ error: "Student not found" });
      const idn = await sql`
        INSERT INTO student_identities (full_name, name_key, name_compact, birthdate, first_registration_id)
        VALUES (${st[0].name}, ${nameKey(st[0].name)}, ${nameCompact(st[0].name)}, ${st[0].birthdate}, ${sid})
        ON CONFLICT (first_registration_id) DO UPDATE SET full_name = EXCLUDED.full_name
        RETURNING id`;
      await sql`UPDATE students SET identity_id = ${idn[0].id}, match_status = 'new' WHERE id = ${sid}`;
      await sql`UPDATE identity_matches SET status = 'rejected', decided_by = ${who}, decided_at = NOW()
                WHERE student_id = ${sid} AND status = 'linked'`;
      return res.status(200).json({ ok: true, identity_id: idn[0].id });
    }

    const mid = parseInt(b.match_id, 10);
    const found = await sql`SELECT * FROM identity_matches WHERE id = ${mid}`;
    if (!found.length) return res.status(400).json({ error: "Match not found" });
    const m = found[0];
    if (m.status !== "pending") return res.status(409).json({ error: "Already decided (" + m.status + ")." });

    if (b.decision === "link") {
      // never two registrations of the same student in one school year
      const clash = await sql`
        SELECT 1 FROM students o, students s
        WHERE s.id = ${m.student_id} AND o.identity_id = ${m.candidate_identity_id}
          AND o.school_year = s.school_year AND o.id <> s.id AND o.removed_at IS NULL`;
      if (clash.length) return res.status(409).json({ error: "That student is already registered in this school year." });
      const old = await sql`SELECT identity_id FROM students WHERE id = ${m.student_id}`;
      await sql`UPDATE students SET identity_id = ${m.candidate_identity_id}, match_status = 'confirmed'
                WHERE id = ${m.student_id}`;
      await sql`UPDATE identity_matches
                SET status = CASE WHEN id = ${m.id} THEN 'linked' ELSE 'rejected' END,
                    decided_by = ${who}, decided_at = NOW()
                WHERE student_id = ${m.student_id} AND status = 'pending'`;
      // remove the temporary identity if nothing uses it any more
      if (old.length && old[0].identity_id && old[0].identity_id !== m.candidate_identity_id) {
        await sql`DELETE FROM student_identities i WHERE i.id = ${old[0].identity_id}
                  AND NOT EXISTS (SELECT 1 FROM students WHERE identity_id = i.id)
                  AND NOT EXISTS (SELECT 1 FROM identity_matches WHERE candidate_identity_id = i.id)
                  AND NOT EXISTS (SELECT 1 FROM school_year_archive WHERE identity_id = i.id)`;
      }
      return res.status(200).json({ ok: true, linked: true });
    }
    if (b.decision === "reject") {
      await sql`UPDATE identity_matches SET status = 'rejected', decided_by = ${who}, decided_at = NOW()
                WHERE id = ${m.id}`;
      await sql`UPDATE students s SET match_status = 'new'
                WHERE s.id = ${m.student_id} AND s.match_status = 'pending'
                  AND NOT EXISTS (SELECT 1 FROM identity_matches x WHERE x.student_id = s.id AND x.status = 'pending')`;
      return res.status(200).json({ ok: true, linked: false });
    }
    return res.status(400).json({ error: "Unknown decision" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error. Did you run the latest schema.sql in Neon?" });
  }
}
