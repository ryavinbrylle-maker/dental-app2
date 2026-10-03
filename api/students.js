// Back end: returns all registered students for the dentist / nurse.
// Protected by a staff password stored in Vercel (STAFF_PASSWORD).
import { neon } from "@neondatabase/serverless";
import { timingSafeEqual } from "crypto";

const sql = neon(process.env.DATABASE_URL);

function passwordMatches(given) {
  const real = process.env.STAFF_PASSWORD || "";
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(real);
  return real.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET is allowed" });
  }
  if (!process.env.STAFF_PASSWORD) {
    return res.status(500).json({ error: "STAFF_PASSWORD is not set in Vercel yet" });
  }
  if (!passwordMatches(req.headers["x-staff-password"])) {
    return res.status(401).json({ error: "Wrong password" });
  }

  try {
    const rows = await sql`SELECT * FROM students ORDER BY registered_on DESC`;
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ students: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error. Please try again." });
  }
}
