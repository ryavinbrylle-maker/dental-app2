// Student identity across school years + returning-student matching.
// The name rules are the SAME as the SQL functions name_norm / name_key / name_compact in schema.sql.

const ACCENTS = { "á":"a","à":"a","â":"a","ä":"a","ã":"a","å":"a","é":"e","è":"e","ê":"e","ë":"e",
  "í":"i","ì":"i","î":"i","ï":"i","ó":"o","ò":"o","ô":"o","ö":"o","õ":"o","ú":"u","ù":"u","û":"u",
  "ü":"u","ñ":"n","ç":"c" };

export function nameNorm(t) {
  return String(t || "").toLowerCase()
    .replace(/[áàâäãåéèêëíìîïóòôöõúùûüñç]/g, function (c) { return ACCENTS[c]; })
    .replace(/[^a-z0-9]+/g, " ").trim();
}
// words sorted: "Dela Cruz, Juan" -> "cruz dela juan"
export function nameKey(t) {
  return nameNorm(t).split(" ").filter(Boolean).sort().join(" ");
}
// letters only, typed order: "Juan De la Cruz" -> "juandelacruz"
export function nameCompact(t) {
  return nameNorm(t).replace(/ /g, "");
}

function gradeNumber(g) {
  if (/^kinder/i.test(g || "")) return 0;
  const m = String(g || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// Decide how a NEW registration relates to students from EARLIER school years.
//   auto    -> exactly one earlier student with the same name AND the same birthdate,
//              and a sensible grade (same or higher)            => link automatically
//   pending -> a possible match that is not certain               => ask the dentist
//   new     -> nobody with that name before (new / transferee)  => new identity
// Returns { status, identityId?, candidates: [{identity_id, reason}] }
export async function matchReturningStudent(sql, reg) {
  const key = nameKey(reg.name), compact = nameCompact(reg.name);
  if (!key) return { status: "new", candidates: [] };
  const rows = await sql`
    SELECT i.id AS identity_id, i.birthdate,
           s.name, s.grade, s.section, s.school_year, s.birthdate AS reg_birthdate
    FROM student_identities i
    JOIN students s ON s.identity_id = i.id
    WHERE (i.name_key = ${key} OR i.name_compact = ${compact})
      AND s.school_year < ${reg.school_year}
      AND s.removed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM students t                 -- already registered this year
                      WHERE t.identity_id = i.id AND t.school_year = ${reg.school_year}
                        AND t.removed_at IS NULL)
    ORDER BY i.id, s.school_year DESC`;
  // one entry per identity (its most recent registration)
  const byId = new Map();
  rows.forEach(function (r) { if (!byId.has(r.identity_id)) byId.set(r.identity_id, r); });
  const cands = Array.from(byId.values());
  if (!cands.length) return { status: "new", candidates: [] };

  const iso = function (d) { return d ? new Date(d).toISOString().slice(0, 10) : null; };
  const bd = reg.birthdate ? String(reg.birthdate).slice(0, 10) : null;
  const describe = function (c) {
    return "Same name as " + c.name + " (" + c.grade + " – " + c.section + ", " + c.school_year + ")" +
           (bd && iso(c.birthdate || c.reg_birthdate) === bd ? ", same birthdate" : "");
  };

  if (cands.length === 1) {
    const c = cands[0];
    const sameBirth = bd && iso(c.birthdate || c.reg_birthdate) === bd;
    const gNew = gradeNumber(reg.grade), gOld = gradeNumber(c.grade);
    const sensibleGrade = gNew === null || gOld === null || gNew >= gOld;
    if (sameBirth && sensibleGrade) {
      return { status: "auto", identityId: c.identity_id, candidates: [{ identity_id: c.identity_id, reason: describe(c) }] };
    }
  }
  return { status: "pending",
           candidates: cands.map(function (c) { return { identity_id: c.identity_id, reason: describe(c) }; }) };
}

// Create the identity for a registration (or link it), plus any suggestions to review.
// Call AFTER the registration row exists.
export async function attachIdentity(sql, studentId, reg) {
  const m = await matchReturningStudent(sql, reg);
  if (m.status === "auto") {
    await sql`UPDATE students SET identity_id = ${m.identityId}, match_status = 'auto' WHERE id = ${studentId}`;
    return m;
  }
  const created = await sql`
    INSERT INTO student_identities (full_name, name_key, name_compact, birthdate, first_registration_id)
    VALUES (${reg.name}, ${nameKey(reg.name)}, ${nameCompact(reg.name)}, ${reg.birthdate || null}, ${studentId})
    ON CONFLICT (first_registration_id) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id`;
  await sql`UPDATE students SET identity_id = ${created[0].id}, match_status = ${m.status} WHERE id = ${studentId}`;
  for (const c of m.candidates) {
    await sql`
      INSERT INTO identity_matches (student_id, candidate_identity_id, reason)
      VALUES (${studentId}, ${c.identity_id}, ${c.reason})
      ON CONFLICT (student_id, candidate_identity_id) DO NOTHING`;
  }
  return m;
}
