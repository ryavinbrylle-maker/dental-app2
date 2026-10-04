// Back end: checks the dentist's username and password and returns a
// login token that lasts 12 hours, so the dentist doesn't need to log in again.
import { isConfigured, same, makeToken } from "./_auth.js";

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed" });
  }
  if (!isConfigured()) {
    return res.status(500).json({ error: "Dentist login is not set up in Vercel yet" });
  }

  const body = req.body || {};
  const ok = same(body.username, process.env.DENTIST_USERNAME) &&
             same(body.password, process.env.DENTIST_PASSWORD);
  if (!ok) {
    await wait(1500); // slows down password guessing
    return res.status(401).json({ error: "Wrong username or password" });
  }
  return res.status(200).json({ token: makeToken() });
}
