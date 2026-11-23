// Back end: checks the dentist's username and password and returns a
// login token that lasts 12 hours, so the dentist doesn't need to log in again.
import { neon } from "@neondatabase/serverless";
import { isConfigured, same, makeToken, setSessionCookie, DENTIST_COOKIE, SESSION_SECONDS } from "./_auth.js";
import { allow, clientIp, tooMany } from "./_rate.js";

const sql = neon(process.env.DATABASE_URL);

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "DELETE") {             // log out: remove the session cookie
    setSessionCookie(req, res, DENTIST_COOKIE, "", 0);
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed" });
  }
  if (!isConfigured()) {
    return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  }

  // at most 10 tries per network per 15 minutes (and 60 in total), so passwords can't be guessed
  if (!(await allow(sql, "dentist-login:" + clientIp(req), 10, 900)) || !(await allow(sql, "dentist-login:all", 60, 900))) {
    return tooMany(res, 15);
  }
  const body = req.body || {};
  const ok = same(body.username, process.env.DENTIST_USERNAME) &&
             same(body.password, process.env.DENTIST_PASSWORD);
  if (!ok) {
    await wait(1500); // slows down password guessing
    return res.status(401).json({ error: "Wrong username or password" });
  }
  const token = makeToken();
  setSessionCookie(req, res, DENTIST_COOKIE, token, SESSION_SECONDS);
  return res.status(200).json({ token: token });
}
