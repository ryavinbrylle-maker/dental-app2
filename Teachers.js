// Dentist: teacher accounts. Teachers sign up on Teacher.html; the dentist approves them here,
// can change a teacher's section, or remove an account. Uses the dentist token (syApi from SchoolYearDentalRecords.js).
"use strict";
const TEACHER_URL = "/api/portal?as=teacher";
function tchEl(id) { return document.getElementById(id); }

function openTeachers() {
  show("teachers");
  tchEl("tchError").textContent = "";
  loadTeachers();
}
function loadTeachers() {
  const p = tchEl("tchPending"), l = tchEl("tchList");
  if (!navigator.onLine) { p.innerHTML = ""; l.innerHTML = ""; l.appendChild(el("p", "muted", "Teachers can only be managed online.")); return Promise.resolve(); }
  p.innerHTML = ""; p.appendChild(el("p", "muted", "Loading..."));
  return syApi(TEACHER_URL + "&list=1").then(renderTeachers).catch(function (err) {
    p.innerHTML = ""; tchEl("tchError").textContent = err.message;
  });
}
function teacherBadge(n) {
  const b = tchEl("tchBadge");
  b.hidden = !n; b.textContent = n > 9 ? "9+" : String(n || "");
}
function renderTeachers(data) {
  const all = data.teachers || [];
  const pend = all.filter(function (t) { return t.status === "pending"; });
  const rest = all.filter(function (t) { return t.status !== "pending"; });
  teacherBadge(pend.length);
  const p = tchEl("tchPending"), l = tchEl("tchList");
  p.innerHTML = ""; l.innerHTML = "";
  if (!pend.length) p.appendChild(el("p", "muted", "No new teacher accounts."));
  pend.forEach(function (t) { p.appendChild(teacherRow(t, true)); });
  if (!rest.length) l.appendChild(el("p", "muted", "No teacher accounts yet."));
  rest.forEach(function (t) { l.appendChild(teacherRow(t, false)); });
}
function teacherRow(t, pending) {
  const r = el("div", "tch-row");
  const who = el("div", "who");
  const nm = el("b", "", t.full_name);
  if (!pending) nm.appendChild(el("span", "tch-tag " + (t.status === "approved" ? "ok" : "bad"), t.status === "approved" ? "Approved" : "Not approved"));
  who.appendChild(nm);
  who.appendChild(el("span", "", t.grade + " – " + t.section + " · @" + t.username +
    (t.last_login ? " · last sign-in " + niceDate(t.last_login) : " · signed up " + niceDate(t.created_at))));
  r.appendChild(who);
  const acts = el("div", "acts");
  function btn(label, cls, action, confirmText) {
    const b = el("button", cls, label); b.type = "button";
    b.addEventListener("click", function () {
      if (confirmText && !b.dataset.sure) { b.dataset.sure = "1"; b.textContent = confirmText; setTimeout(function () { delete b.dataset.sure; b.textContent = label; }, 4000); return; }
      teacherAction({ action: action, teacher_id: t.id }, b);
    });
    acts.appendChild(b);
  }
  if (t.status !== "approved") btn("Approve", "mini-btn", "teacher_approve");
  if (t.status === "pending") btn("Reject", "mini-btn danger", "teacher_reject");
  if (t.status === "approved") {
    const g = document.createElement("select"), sec = document.createElement("select");
    g.setAttribute("aria-label", "Grade"); sec.setAttribute("aria-label", "Section");
    GRADE_LIST.forEach(function (x) { g.appendChild(new Option(x, x)); });
    g.value = t.grade;
    function fill(v) { sec.innerHTML = ""; sectionsFor(g.value).forEach(function (x) { sec.appendChild(new Option(x, x)); }); if (v) sec.value = v; }
    fill(t.section);
    g.addEventListener("change", function () { fill(); });
    const save = el("button", "mini-btn", "Change section"); save.type = "button";
    save.addEventListener("click", function () {
      if (g.value === t.grade && sec.value === t.section) return;
      teacherAction({ action: "teacher_section", teacher_id: t.id, grade: g.value, section: sec.value }, save);
    });
    acts.appendChild(g); acts.appendChild(sec); acts.appendChild(save);
  }
  if (!pending) btn("Remove", "mini-btn danger", "teacher_remove", "Tap again to remove");
  r.appendChild(acts);
  return r;
}
function teacherAction(body, b) {
  b.disabled = true;
  tchEl("tchError").textContent = "";
  return syApi(TEACHER_URL, { method: "POST", body: JSON.stringify(body) })
    .then(function () {
      showToast({ teacher_approve: "Teacher approved.", teacher_reject: "Teacher account rejected.",
                  teacher_remove: "Teacher account removed.", teacher_section: "Section changed." }[body.action]);
      return loadTeachers();
    })
    .catch(function (err) { tchEl("tchError").textContent = err.message; b.disabled = false; });
}
tchEl("openTeachersBtn").addEventListener("click", openTeachers);
tchEl("tchBack").addEventListener("click", function () { show("dashboard"); });
tchEl("tchRefresh").addEventListener("click", loadTeachers);
// show the number of new teacher accounts on the menu after signing in
function refreshTeacherBadge() {
  if (!document.body.classList.contains("signed-in") || !navigator.onLine) return;
  syApi(TEACHER_URL + "&list=1").then(function (d) {
    teacherBadge((d.teachers || []).filter(function (x) { return x.status === "pending"; }).length);
  }).catch(function () {});
}
let wasSignedIn = false;
new MutationObserver(function () {
  const now = document.body.classList.contains("signed-in");
  if (now && !wasSignedIn) refreshTeacherBadge();
  if (!now) teacherBadge(0);
  wasSignedIn = now;
}).observe(document.body, { attributes: true, attributeFilter: ["class"] });
refreshTeacherBadge(); wasSignedIn = document.body.classList.contains("signed-in");
