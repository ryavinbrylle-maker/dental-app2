// Back end: SchoolYearDentalRecords — school years and their archives — DENTIST ONLY.
//   GET  /api/schoolyears                          -> all school years (+ counts), which one is active
//   GET  /api/schoolyears?year=2025-2026           -> registrations of that year (grade, section, code, name)
//   GET  /api/schoolyears?year=2025-2026&student_id=5
//        -> that student's complete record for that year (frozen archive copy if it exists)
//   POST /api/schoolyears {action:"snapshot"}      -> refresh the archive copy of the active year
//   POST /api/schoolyears {action:"start", new_year:"2027-2028", confirm:"2027-2028"}
//        -> archive the current year, then make the new year active (empty roster).
//           Nothing is deleted. Safe to repeat (no duplicate archives).
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { activeYear, validSchoolYear } from "./_sy.js";

const sql = neon(process.env.DATABASE_URL);

// Frozen copy of every registration of a school year (registration + appointments +
// examinations + status log). One row per student per year; repeating replaces it.
function archiveYear(year) {
  return sql`
    INSERT INTO school_year_archive (school_year, student_id, identity_id, grade, section, student_code, name, snapshot)
    SELECT s.school_year, s.id, s.identity_id, s.grade, s.section,
           CASE WHEN s.code_gender IS NOT NULL THEN s.code_gender || '-' || s.code_number END,
           s.name,
           jsonb_build_object(
             'registration', to_jsonb(s),
             'appointments', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.appointment_date, a.id)
                                       FROM appointments a WHERE a.student_id = s.id), '[]'::jsonb),
             'examinations', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.visit_date, v.id)
                                       FROM visits v WHERE v.student_id = s.id), '[]'::jsonb),
             'status_log',   COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.changed_at, e.id)
                                       FROM appointment_events e JOIN appointments a ON a.id = e.appointment_id
                                       WHERE a.student_id = s.id), '[]'::jsonb),
             'archived_at', NOW())
    FROM students s
    WHERE s.school_year = ${year}
    ON CONFLICT (school_year, student_id) DO UPDATE
      SET snapshot = EXCLUDED.snapshot, identity_id = EXCLUDED.identity_id, grade = EXCLUDED.grade,
          section = EXCLUDED.section, student_code = EXCLUDED.student_code, name = EXCLUDED.name,
          archived_at = NOW()
    RETURNING student_id`;
}

function liveSnapshot(studentId) {
  return sql`
    SELECT jsonb_build_object(
             'registration', to_jsonb(s),
             'appointments', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.appointment_date, a.id)
                                       FROM appointments a WHERE a.student_id = s.id), '[]'::jsonb),
             'examinations', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.visit_date, v.id)
                                       FROM visits v WHERE v.student_id = s.id), '[]'::jsonb),
             'status_log',   COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.changed_at, e.id)
                                       FROM appointment_events e JOIN appointments a ON a.id = e.appointment_id
                                       WHERE a.student_id = s.id), '[]'::jsonb)) AS snapshot
    FROM students s WHERE s.id = ${studentId}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isConfigured()) return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }
  try {
    const active = await activeYear(sql);

    if (req.method === "GET") {
      const year = req.query.year;
      if (!year) {
        const years = await sql`
          SELECT y.id, y.status, y.started_at, y.archived_at,
                 (SELECT COUNT(*) FROM students s WHERE s.school_year = y.id AND s.removed_at IS NULL)::int AS registrations,
                 (SELECT COUNT(*) FROM visits v WHERE v.school_year = y.id)::int AS examinations,
                 (SELECT COUNT(*) FROM appointments a WHERE a.school_year = y.id)::int AS appointments,
                 (SELECT COUNT(*) FROM school_year_archive r WHERE r.school_year = y.id)::int AS archived
          FROM school_years y ORDER BY y.id DESC`;
        const pending = await sql`SELECT COUNT(*)::int AS n FROM identity_matches WHERE status = 'pending'`;
        return res.status(200).json({ active: active, years: years, pending_matches: pending[0].n });
      }
      if (!validSchoolYear(year)) return res.status(400).json({ error: "Invalid school year" });
      const studentId = parseInt(req.query.student_id, 10);
      if (studentId) {
        const frozen = await sql`SELECT snapshot, archived_at FROM school_year_archive
                                 WHERE school_year = ${year} AND student_id = ${studentId}`;
        if (frozen.length) return res.status(200).json({ snapshot: frozen[0].snapshot, frozen: true, archived_at: frozen[0].archived_at });
        const live = await liveSnapshot(studentId);
        if (!live.length) return res.status(400).json({ error: "Student not found" });
        return res.status(200).json({ snapshot: live[0].snapshot, frozen: false });
      }
      const regs = await sql`
        SELECT s.id, s.name, s.grade, s.section, s.code_gender, s.code_number, s.identity_id,
               s.removed_at, s.school_year,
               (SELECT COUNT(*) FROM visits v WHERE v.student_id = s.id)::int AS examinations,
               (SELECT COUNT(*) FROM appointments a WHERE a.student_id = s.id AND a.status = 'Absent')::int AS absences
        FROM students s WHERE s.school_year = ${year}
        ORDER BY s.grade, s.section, s.code_gender DESC NULLS LAST, s.code_number NULLS LAST, s.name`;
      return res.status(200).json({ year: year, registrations: regs });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      if (b.action === "snapshot") {
        const done = await archiveYear(active);
        return res.status(200).json({ ok: true, school_year: active, archived: done.length });
      }
      if (b.action === "start") {
        const next = String(b.new_year || "");
        if (!validSchoolYear(next)) return res.status(400).json({ error: "Write the school year like 2027-2028." });
        if (b.confirm !== next) return res.status(400).json({ error: "Type the new school year exactly to confirm." });
        if (next === active) return res.status(200).json({ ok: true, already: true, active: next });
        if (next < active) return res.status(400).json({ error: "The new school year must come after " + active + "." });
        // 1) make sure the new year exists (not active yet)
        await sql`INSERT INTO school_years (id, status) VALUES (${next}, 'archived') ON CONFLICT (id) DO NOTHING`;
        // 2) frozen archive copy of the current year (safe to repeat)
        const archived = await archiveYear(active);
        // 3) switch: archive the old year, then activate the new one
        await sql`UPDATE school_years SET status = 'archived', archived_at = COALESCE(archived_at, NOW())
                  WHERE status = 'active' AND id <> ${next}`;
        await sql`UPDATE school_years SET status = 'active', started_at = NOW(), archived_at = NULL
                  WHERE id = ${next}`;
        return res.status(200).json({ ok: true, previous: active, active: next, archived: archived.length });
      }
      return res.status(400).json({ error: "Unknown action" });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error. Did you run the latest schema.sql in Neon?" });
  }
}
