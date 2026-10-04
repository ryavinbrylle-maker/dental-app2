// Back end: returns all registered students — DENTIST ONLY.
// Needs the login token from /api/login.
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET is allowed" });
  }
  if (!isConfigured()) {
    return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  }
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }

  try {
    const rows = await sql`SELECT * FROM students ORDER BY registered_on DESC`;
    return res.status(200).json({ students: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error. Please try again." });
  }
}
