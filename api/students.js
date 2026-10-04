// Back end: returns all registered students — DENTIST ONLY.
// The dentist's username and password are stored in Vercel
// as DENTIST_USERNAME and DENTIST_PASSWORD (never in the code).
import { neon } from "@neondatabase/serverless";
import { timingSafeEqual } from "crypto";

const sql = neon(process.env.DATABASE_URL);

function same(given, real) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(real || ""));
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function wait(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET is allowed" });
  }
  if (!process.env.DENTIST_USERNAME || !process.env.DENTIST_PASSWORD) {
    return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  }

  const userOk = same(req.headers["x-dentist-user"], process.env.DENTIST_USERNAME);
  const passOk = same(req.headers["x-dentist-password"], process.env.DENTIST_PASSWORD);
  if (!userOk || !passOk) {
    await wait(1500); // slows down password guessing
    return res.status(401).json({ error: "Wrong username or password" });
  }

  try {
    const rows = await sql`SELECT * FROM students ORDER BY registered_on DESC`;
    return res.status(200).json({ students: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error. Please try again." });
  }
}
