// Teacher page: sign in / sign up, then approve, reject or move the students of your section.
// Teachers never see dental or medical data – the server only sends name, code and birthdate.
"use strict";
const API = "/api/portal?as=teacher";
const $ = function (id) { return document.getElementById(id); };
let token = null, data = null, moving = null;
try { token = sessionStorage.getItem("teacherToken"); } catch (e) {}

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function readJson(res) {
  return res.text().then(function (body) {
    let d = {};
    try { d = JSON.parse(body); } catch (e) {}
    if (!res.ok) { const err = new Error(d.error || ("Server error " + res.status)); err.status = res.status; throw err; }
    return d;
  });
}
function post(body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  return fetch(API, { method: "POST", headers: headers, body: JSON.stringify(body) }).then(readJson);
}
function saveToken(t) {
  token = t;
  try { if (t) sessionStorage.setItem("teacherToken", t); else sessionStorage.removeItem("teacherToken"); } catch (e) {}
}
function setMsg(e, text, kind) { e.textContent = text || ""; e.className = "msg" + (kind ? " " + kind : ""); }
function busy(btn, on, label) {
  btn.disabled = on;
  if (on) { btn.dataset.label = btn.innerHTML; btn.textContent = label || "Please wait…"; }
  else if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
}
function dateText(v) {
  if (!v) return "";
  const p = String(v).slice(0, 10).split("-");
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return isNaN(d) ? String(v) : d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}
function fillGrades(gSel, sSel, grade, section) {
  gSel.innerHTML = "";
  gSel.appendChild(new Option("Choose…", ""));
  GRADE_LIST.forEach(function (g) { gSel.appendChild(new Option(g, g)); });
  gSel.value = grade || "";
  fillSections(gSel, sSel, section);
}
function fillSections(gSel, sSel, section) {
  sSel.innerHTML = "";
  sSel.appendChild(new Option(gSel.value ? "Choose…" : "Choose a grade first", ""));
  sectionsFor(gSel.value).forEach(function (s) { sSel.appendChild(new Option(s, s)); });
  sSel.value = section || "";
}

// ---------- views ----------
function showView(name) {
  ["authView", "pendingView", "homeView"].forEach(function (v) { $(v).hidden = v !== name + "View"; });
  $("loading").hidden = name !== "loading";
  $("signOutBtn").hidden = name !== "home" && name !== "pending";
  window.scrollTo(0, 0);
}
function showTab(which) {
  const up = which === "signup";
  $("tabSignIn").classList.toggle("on", !up); $("tabSignIn").setAttribute("aria-selected", String(!up));
  $("tabSignUp").classList.toggle("on", up); $("tabSignUp").setAttribute("aria-selected", String(up));
  $("signInForm").hidden = up; $("signUpForm").hidden = !up;
  setMsg($("authMsg"), "");
}
$("tabSignIn").addEventListener("click", function () { showTab("signin"); });
$("tabSignUp").addEventListener("click", function () { showTab("signup"); });
document.querySelectorAll(".showPw").forEach(function (box) {
  box.addEventListener("change", function () {
    box.dataset.for.split(",").forEach(function (id) { $(id).type = box.checked ? "text" : "password"; });
  });
});
fillGrades($("suGrade"), $("suSection"));
$("suGrade").addEventListener("change", function () { fillSections($("suGrade"), $("suSection")); });
const openedAt = Date.now();

$("signInForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const btn = $("signInBtn");
  if (!$("siUser").value.trim() || !$("siPassword").value) { setMsg($("authMsg"), "Please enter your username and password.", "bad"); return; }
  busy(btn, true, "Signing in…"); setMsg($("authMsg"), "");
  post({ action: "login", username: $("siUser").value, password: $("siPassword").value })
    .then(function (r) { saveToken(r.token); $("siPassword").value = ""; return loadHome(); })
    .catch(function (err) { setMsg($("authMsg"), err.message, "bad"); })
    .finally(function () { busy(btn, false); });
});
$("signUpForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const btn = $("signUpBtn"), m = $("authMsg");
  if (!$("suName").value.trim()) return setMsg(m, "Please enter your full name.", "bad");
  if (!$("suGrade").value || !$("suSection").value) return setMsg(m, "Please choose the grade and section you handle.", "bad");
  if (!$("suUser").value.trim()) return setMsg(m, "Please choose a username.", "bad");
  if ($("suPassword").value.length < 8) return setMsg(m, "The password must have at least 8 characters.", "bad");
  if ($("suPassword").value !== $("suPassword2").value) return setMsg(m, "The two passwords are not the same.", "bad");
  busy(btn, true, "Saving…"); setMsg(m, "");
  post({ action: "signup", full_name: $("suName").value, grade: $("suGrade").value, section: $("suSection").value,
         username: $("suUser").value, password: $("suPassword").value, website: $("suWebsite").value,
         elapsedMs: Date.now() - openedAt })
    .then(function () {
      const u = $("suUser").value;
      $("signUpForm").reset(); fillGrades($("suGrade"), $("suSection"));
      showTab("signin"); $("siUser").value = u;
      setMsg(m, "Account made! The school dentist must approve it first. You can sign in now to check.", "ok");
    })
    .catch(function (err) { setMsg(m, err.message, "bad"); })
    .finally(function () { busy(btn, false); });
});
$("signOutBtn").addEventListener("click", function () {
  post({ action: "logout" }).catch(function () {});
  saveToken(null); data = null;
  showTab("signin"); showView("auth");
  setMsg($("authMsg"), "You are signed out.", "ok");
});
$("pendRefresh").addEventListener("click", function () { loadHome(); });

// ---------- home ----------
function loadHome() {
  showView("loading");
  return fetch(API, { headers: { Authorization: "Bearer " + token }, cache: "no-store" })
    .then(readJson)
    .then(function (d) { data = d; render(); })
    .catch(function (err) {
      if (err.status === 401) { saveToken(null); showView("auth"); setMsg($("authMsg"), "Please sign in.", "info"); return; }
      showView("auth"); setMsg($("authMsg"), "Could not load: " + err.message, "bad");
    });
}
function reload(msg) {
  return fetch(API, { headers: { Authorization: "Bearer " + token }, cache: "no-store" })
    .then(readJson).then(function (d) { data = d; render(); if (msg) setMsg($("homeMsg"), msg, "ok"); })
    .catch(function (err) { setMsg($("homeMsg"), err.message, "bad"); });
}
function render() {
  const t = data.teacher;
  if (t.status !== "approved") {
    $("pendTitle").textContent = t.status === "rejected" ? "Your teacher account was not approved" : "Waiting for the school dentist";
    $("pendText").textContent = t.status === "rejected"
      ? "Please talk to the school dentist if this is a mistake."
      : "Hi " + t.full_name + "! Your account for " + t.grade + " – " + t.section + " is saved. The school dentist must approve it before you can approve students.";
    showView("pending");
    return;
  }
  $("tName").textContent = t.full_name;
  const pills = $("tPills"); pills.innerHTML = "";
  [["Class", t.grade + " – " + t.section], ["School year", data.school_year || ""]].forEach(function (p) {
    const s = el("span", "pill"); s.appendChild(el("b", "", p[0] + ": ")); s.appendChild(document.createTextNode(p[1])); pills.appendChild(s);
  });
  const all = data.students || [];
  const pend = all.filter(function (s) { return s.status === "pending"; });
  const ok = all.filter(function (s) { return s.status === "approved"; });
  const rej = all.filter(function (s) { return s.status === "rejected"; });
  $("pendCount").textContent = pend.length; $("pendCount").className = "count" + (pend.length ? "" : " zero");
  $("okCount").textContent = ok.length;
  $("rejCount").textContent = rej.length; $("rejCard").hidden = !rej.length;
  list($("pendList"), pend, ["approve", "reject", "move"], "No students are waiting. New registrations from your section appear here.");
  const q = $("okSearch").value.trim().toLowerCase();
  list($("okList"), ok.filter(function (s) { return !q || (s.name + " " + s.code).toLowerCase().includes(q); }), ["move"],
       q ? "No student matches." : "No approved students yet.");
  list($("rejList"), rej, ["approve", "move"], "");
  showView("home");
}
$("okSearch").addEventListener("input", function () { if (data) render(); });

function list(box, rows, actions, emptyText) {
  box.innerHTML = "";
  if (!rows.length) { if (emptyText) box.appendChild(el("div", "empty", emptyText)); return; }
  rows.forEach(function (s) {
    const r = el("div", "srow");
    const who = el("div", "who");
    const nm = el("b", "", s.name);
    if (!s.has_account) nm.appendChild(el("span", "tag", "no online account"));
    who.appendChild(nm);
    who.appendChild(el("span", "", [s.code, s.birthdate ? "Born " + dateText(s.birthdate) : "", s.registered_on ? "Registered " + dateText(s.registered_on) : ""]
      .filter(Boolean).join(" · ")));
    r.appendChild(who);
    const acts = el("div", "acts");
    actions.forEach(function (a) {
      const b = el("button", a === "approve" ? "" : a === "reject" ? "danger" : "secondary",
                   a === "approve" ? "Approve" : a === "reject" ? "Not my student" : "Move");
      b.type = "button";
      b.addEventListener("click", function () { act(a, s, b); });
      acts.appendChild(b);
    });
    r.appendChild(acts);
    box.appendChild(r);
  });
}
function act(a, s, btn) {
  setMsg($("homeMsg"), "");
  if (a === "move") return openMove(s);
  busy(btn, true, "…");
  post({ action: a, student_id: s.id })
    .then(function () { return reload(a === "approve" ? s.name + " is approved." : s.name + " is marked as not in your class."); })
    .catch(function (err) { setMsg($("homeMsg"), err.message, "bad"); busy(btn, false); });
}

// ---------- move ----------
function openMove(s) {
  moving = s;
  $("mvWho").textContent = s.name + " (" + s.code + ") – now in " + data.teacher.grade + " – " + data.teacher.section;
  fillGrades($("mvGrade"), $("mvSection"), data.teacher.grade, "");
  $("mvNumber").value = ""; setMsg($("mvMsg"), "");
  $("moveDialog").hidden = false; $("mvGrade").focus();
}
function closeMove() { $("moveDialog").hidden = true; moving = null; }
$("mvGrade").addEventListener("change", function () { fillSections($("mvGrade"), $("mvSection")); });
$("mvCancel").addEventListener("click", closeMove);
$("moveDialog").addEventListener("click", function (e) { if (e.target === this) closeMove(); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("moveDialog").hidden) closeMove(); });
$("moveForm").addEventListener("submit", function (e) {
  e.preventDefault();
  if (!moving) return;
  const g = $("mvGrade").value, sec = $("mvSection").value, btn = $("mvSave");
  if (!g || !sec) return setMsg($("mvMsg"), "Please choose the correct grade and section.", "bad");
  if (g === data.teacher.grade && sec === data.teacher.section) return setMsg($("mvMsg"), "The student is already in your section.", "bad");
  busy(btn, true, "Moving…");
  const name = moving.name;
  post({ action: "move", student_id: moving.id, grade: g, section: sec, codeNumber: $("mvNumber").value })
    .then(function (r) { closeMove(); return reload(name + " moved to " + r.grade + " – " + r.section + " as " + r.code + ". Their new teacher will approve them."); })
    .catch(function (err) { setMsg($("mvMsg"), err.message, "bad"); })
    .finally(function () { busy(btn, false); });
});

// ---------- start ----------
if (token) loadHome(); else { showTab("signin"); showView("auth"); }
