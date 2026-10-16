// School-year helpers. A school year runs June–May, e.g. '2026-2027'.

export function schoolYearOf(dateStr) {
  const d = dateStr ? new Date(String(dateStr).slice(0, 10) + "T00:00:00Z") : new Date();
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return m >= 6 ? y + "-" + (y + 1) : (y - 1) + "-" + y;
}

export function validSchoolYear(s) {
  const m = /^(\d{4})-(\d{4})$/.exec(String(s || ""));
  return Boolean(m) && parseInt(m[2], 10) === parseInt(m[1], 10) + 1;
}

// The active school year (created from today's date if the table is still empty)
export async function activeYear(sql) {
  const rows = await sql`SELECT id FROM school_years WHERE status = 'active' LIMIT 1`;
  if (rows.length) return rows[0].id;
  const id = schoolYearOf();
  await sql`INSERT INTO school_years (id, status) VALUES (${id}, 'active')
            ON CONFLICT (id) DO UPDATE SET status = 'active'`;
  return id;
}
