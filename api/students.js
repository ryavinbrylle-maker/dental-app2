// Back end: registered students — DENTIST ONLY (needs the login token from /api/login).
//   GET    /api/students          -> all students
//   PUT    /api/students?id=5     -> change name, grade, section or student code
//   DELETE /api/students?id=5     -> delete a student (and their visits)
import { neon } from "@neondatabase/serverless";
import { isConfigured, tokenIsValid } from "./_auth.js";
import { checkCode, sexFromCode, isDuplicateError, duplicateMessage } from "./_code.js";

const sql = neon(process.env.DATABASE_URL);

function cleanText(v, max) {
  const s = String(v === undefined || v === null ? "" : v).trim().slice(0, max);
  return s === "" ? null : s;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  if (!isConfigured()) {
    return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  }
  if (!tokenIsValid(req.headers.authorization)) {
    return res.status(401).json({ error: "Your login has expired. Please log in again." });
  }

  try {
    if (req.method === "GET") {
      const rows = await sql`SELECT * FROM students ORDER BY registered_on DESC`;
      return res.status(200).json({ students: rows });
    }

    if (req.method === "PUT") {
      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: "id is required" });
      const b = req.body || {};
      const name = cleanText(b.name, 120);
      const grade = cleanText(b.grade, 40);
      const section = cleanText(b.section, 40);
      if (!name) return res.status(400).json({ error: "Student name is required" });
      if (!grade || !section) return res.status(400).json({ error: "Grade and section are required" });
      const code = checkCode(b.codeGender, b.codeNumber);
      if (code.error) return res.status(400).json({ error: code.error });

      const taken = await sql`
        SELECT 1 FROM students
        WHERE grade = ${grade} AND section = ${section}
          AND code_gender = ${code.gender} AND code_number = ${code.number}
          AND id <> ${id}
        LIMIT 1`;
      if (taken.length) {
        return res.status(409).json({ error: duplicateMessage(grade, section, code.gender, code.number) });
      }

      const rows = await sql`
        UPDATE students
        SET name = ${name}, grade = ${grade}, section = ${section},
            code_gender = ${code.gender}, code_number = ${code.number},
            sex = ${sexFromCode(code.gender)}
        WHERE id = ${id}
        RETURNING *`;
      if (!rows.length) return res.status(400).json({ error: "Student not found" });
      return res.status(200).json({ student: rows[0] });
    }

    if (req.method === "DELETE") {
      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: "id is required" });
      await sql`DELETE FROM students WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (isDuplicateError(err)) {

      return res.status(409).json({ error: "That student code is already used in this grade and section." });
    }
    console.error(err);
    return res.status(500).json({ error: "Database error. Did you run the latest schema.sql in Neon?" });
  }
}
