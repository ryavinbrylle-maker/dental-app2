// Dentist-only view of all registered students.
// - Log in once; the login lasts 12 hours (even if the page is refreshed).
// - The list checks for new registrations every 15 seconds by itself.

const LOGIN_URL = "/api/login";
const API_URL = "/api/students";
const REFRESH_SECONDS = 15;
const TOKEN_KEY = "dentistToken";

let token = "";
let students = [];
let knownIds = new Set();
let newIds = new Set();
let refreshTimer = null;
let firstLoad = true;

const loginBox = document.getElementById("login");
const dashboard = document.getElementById("dashboard");
const loginError = document.getElementById("loginError");
const groupsBox = document.getElementById("groups");
const searchInput = document.getElementById("search");
const gradeFilter = document.getElementById("gradeFilter");
const countText = document.getElementById("count");
const liveText = document.getElementById("live");
const toast = document.getElementById("toast");

// ---------- saved login (only for this browser tab) ----------
function saveToken(t) {
  token = t;
  try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) {}
}
function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
}
function clearToken() {
  token = "";
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
}

// ---------- helpers ----------
function text(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}
function formatDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d) ? text(v) : d.toLocaleDateString();
}
function cell(row, value) {
  const td = document.createElement("td");
  if (value instanceof Node) td.appendChild(value); else td.textContent = value;
  row.appendChild(td);
}
function tag(label, kind) {
  const span = document.createElement("span");
  span.className = "tag " + kind;
  span.textContent = label;
  return span;
}
function healthAlerts(s) {
  const alerts = [];
  if (s.allergies) alerts.push("Allergy");
  if (s.conditions && s.conditions.length) alerts.push(...s.conditions);
  if (s.other_conditions) alerts.push("Other condition");
  if (s.medications) alerts.push("On medication");
  return alerts;
}
function readJson(res) {
  return res.text().then(function (body) {
    let data = {};
    try { data = JSON.parse(body); } catch (e) {}
    if (res.status === 404) throw new Error("Back end not found (a file in the api folder is missing on the server)");
    if (!res.ok) {
      const err = new Error(data.error || ("Server error " + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  });
}
function showToast(message) {
  toast.textContent = message;
  toast.style.display = "block";
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(function () { toast.style.display = "none"; }, 6000);
}

// ---------- load data ----------
function loadStudents(quiet) {
  if (!quiet) countText.textContent = "Loading...";
  return fetch(API_URL, { headers: { "Authorization": "Bearer " + token } })
    .then(readJson)
    .then(function (data) {
      const list = data.students || [];

      // Find students that weren't there last time
      const added = list.filter(function (s) { return !knownIds.has(s.id); });
      if (!firstLoad && added.length) {
        added.forEach(function (s) { newIds.add(s.id); });
        showToast(added.length === 1
          ? "New student registered: " + added[0].name
          : added.length + " new students registered");
        setTimeout(function () {
          added.forEach(function (s) { newIds.delete(s.id); });
          render();
        }, 60000); // highlight new rows for 1 minute
      }
      knownIds = new Set(list.map(function (s) { return s.id; }));
      firstLoad = false;

      students = list;
      liveText.classList.remove("off");
      liveText.innerHTML = "&#9679; Live &ndash; updated " + new Date().toLocaleTimeString();
      fillGradeFilter();
      render();
    });
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(function () {
    if (document.hidden) return; // don't check while the tab is in the background
    loadStudents(true).catch(handleRefreshError);
  }, REFRESH_SECONDS * 1000);
}
function stopAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}
function handleRefreshError(err) {
  if (err.status === 401) { logout(err.message); return; }
  // Network hiccup: keep the list on screen and try again next time
  liveText.classList.add("off");
  liveText.textContent = "● Reconnecting...";
}

// When the dentist comes back to the tab, update straight away
document.addEventListener("visibilitychange", function () {
  if (!document.hidden && token) loadStudents(true).catch(handleRefreshError);
});

// ---------- student codes & ordering ----------
// "M-1", "F-12" (or "" if the student has no code yet)
function studentCode(s) {
  return s.code_gender && s.code_number ? s.code_gender + "-" + s.code_number : "";
}
function hasPlace(s) {
  return Boolean(s.grade && s.section && studentCode(s));
}

// Kinder first, then Grade 1, 2 ... 10, 11 (by the number, not as text)
function gradeRank(g) {
  if (/^kinder/i.test(g)) return -1;
  const m = String(g).match(/\d+/);
  return m ? parseInt(m[0], 10) : 1000;
}
function compareGrades(a, b) {
  return gradeRank(a) - gradeRank(b) || String(a).localeCompare(String(b), undefined, { numeric: true });
}
function compareSections(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}
// Inside a section: Male first, then Female; each by the code NUMBER (1, 2, 9, 10, 11 ...)
function compareCodes(a, b) {
  const ga = a.code_gender === "M" ? 0 : a.code_gender === "F" ? 1 : 2;
  const gb = b.code_gender === "M" ? 0 : b.code_gender === "F" ? 1 : 2;
  if (ga !== gb) return ga - gb;
  const na = Number(a.code_number) || Infinity;
  const nb = Number(b.code_number) || Infinity;
  if (na !== nb) return na - nb;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

// Build Grade -> Section -> [students]; students without grade/section/code go to "unassigned"
function groupStudents(list) {
  const grades = new Map();
  const unassigned = [];
  list.forEach(function (s) {
    if (!hasPlace(s)) { unassigned.push(s); return; }
    if (!grades.has(s.grade)) grades.set(s.grade, new Map());
    const sections = grades.get(s.grade);
    if (!sections.has(s.section)) sections.set(s.section, []);
    sections.get(s.section).push(s);
  });
  const ordered = Array.from(grades.keys()).sort(compareGrades).map(function (g) {
    const secMap = grades.get(g);
    return {
      grade: g,
      sections: Array.from(secMap.keys()).sort(compareSections).map(function (sec) {
        return { section: sec, students: secMap.get(sec).slice().sort(compareCodes) };
      })
    };
  });
  unassigned.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  return { grades: ordered, unassigned: unassigned };
}

function fillGradeFilter() {
  const current = gradeFilter.value;
  const grades = Array.from(new Set(students.map(function (s) { return s.grade; }).filter(Boolean))).sort(compareGrades);
  gradeFilter.innerHTML = '<option value="">All grades</option>';
  grades.forEach(function (g) {
    const o = document.createElement("option");
    o.value = g; o.textContent = g;
    gradeFilter.appendChild(o);
  });
  gradeFilter.value = grades.includes(current) ? current : "";
}

// ---------- list ----------
function filtered() {
  const q = searchInput.value.trim().toLowerCase();
  const g = gradeFilter.value;
  return students.filter(function (s) {
    if (g && s.grade !== g) return false;
    if (!q) return true;
    const code = studentCode(s).toLowerCase();
    if (code && (code === q || code.replace("-", "") === q.replace(/[\s-]/g, ""))) return true;
    return [s.name, s.parent_name, s.section, s.grade]
      .some(function (v) { return v && String(v).toLowerCase().includes(q); });
  });
}

const COLUMNS = ["Code", "Name", "Age", "Parent contact", "Health alerts", "Consent", "Registered"];

function studentRow(s) {
  const tr = document.createElement("tr");
  tr.className = "row" + (newIds.has(s.id) ? " new" : "");
  const code = studentCode(s);
  const badge = document.createElement("span");
  badge.className = "code-badge " + (code ? s.code_gender : "none");
  badge.textContent = code || "—";
  cell(tr, badge);
  cell(tr, text(s.name));
  cell(tr, text(s.age));
  cell(tr, text(s.contact));
  const alerts = healthAlerts(s);
  cell(tr, alerts.length ? tag(alerts.join(", "), "warn") : "—");
  cell(tr, s.consent ? tag("Yes", "yes") : tag("No", "no"));
  cell(tr, formatDate(s.registered_on));
  tr.addEventListener("click", function () { openRecord(s); }); // in Dental.js
  return tr;
}

function sectionBox(title, list, opts) {
  opts = opts || {};
  const box = document.createElement("div");
  box.className = "section-box" + (opts.unassigned ? " unassigned" : "");

  const head = document.createElement("div");
  head.className = "section-head";
  const h = document.createElement("h3"); h.textContent = title;
  const males = list.filter(function (s) { return s.code_gender === "M"; }).length;
  const females = list.filter(function (s) { return s.code_gender === "F"; }).length;
  const tally = document.createElement("span"); tally.className = "tally";
  tally.textContent = opts.unassigned
    ? list.length + " student" + (list.length === 1 ? "" : "s") + " – tap to add grade, section and code"
    : males + " male · " + females + " female · " + list.length + " total";
  head.appendChild(h); head.appendChild(tally);
  box.appendChild(head);

  const wrap = document.createElement("div"); wrap.className = "table-wrap"; wrap.style.border = "none";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  COLUMNS.forEach(function (c) { const th = document.createElement("th"); th.textContent = c; hr.appendChild(th); });
  thead.appendChild(hr); table.appendChild(thead);

  const tbody = document.createElement("tbody");
  let lastGender = null;
  list.forEach(function (s) {
    if (!opts.unassigned && s.code_gender !== lastGender) {
      lastGender = s.code_gender;
      const gr = document.createElement("tr"); gr.className = "gender-row";
      const td = document.createElement("td"); td.colSpan = COLUMNS.length;
      td.textContent = lastGender === "M" ? "Male" : "Female";
      gr.appendChild(td); tbody.appendChild(gr);
    }
    tbody.appendChild(studentRow(s));
  });
  table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
  return box;
}

function render() {
  const list = filtered();
  groupsBox.innerHTML = "";
  countText.textContent = list.length + " of " + students.length + " students";

  if (!list.length) {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = students.length ? "No students match your search." : "No students registered yet.";
    groupsBox.appendChild(p);
    return;
  }

  const groups = groupStudents(list);
  groups.grades.forEach(function (g) {
    const block = document.createElement("div"); block.className = "grade-block";
    const title = document.createElement("h2"); title.className = "grade-title"; title.textContent = g.grade;
    block.appendChild(title);
    g.sections.forEach(function (sec) {
      block.appendChild(sectionBox(g.grade + " – " + sec.section, sec.students));
    });
    groupsBox.appendChild(block);
  });
  if (groups.unassigned.length) {
    const block = document.createElement("div"); block.className = "grade-block";
    const title = document.createElement("h2"); title.className = "grade-title"; title.textContent = "Needs a grade, section or code";
    block.appendChild(title);
    block.appendChild(sectionBox("Not yet placed", groups.unassigned, { unassigned: true }));
    groupsBox.appendChild(block);
  }
}

// Full student details as a grid (used on the student record page)
function studentInfoGrid(s) {
  const sections = [
    ["Student", [
      ["Class", text([s.grade, s.section].filter(Boolean).join(" – "))],
      ["Student code", studentCode(s) || "—"],
      ["Birthdate", formatDate(s.birthdate)], ["Blood type", text(s.blood_type)],
      ["Height", s.height_cm ? s.height_cm + " cm" : "—"], ["Weight", s.weight_kg ? s.weight_kg + " kg" : "—"],
      ["Address", text(s.address)]
    ]],
    ["Parent / Guardian", [
      ["Name", text(s.parent_name)], ["Relationship", text(s.relationship)],
      ["Contact", text(s.contact)], ["Emergency", text(s.emergency_contact)]
    ]],
    ["Medical", [
      ["Conditions", text(s.conditions)], ["Other", text(s.other_conditions)],
      ["Allergies", text(s.allergies)], ["Medications", text(s.medications)]
    ]],
    ["Dental", [
      ["Last visit", formatDate(s.last_visit)], ["Brushing", text(s.brushing)],
      ["Concerns", text(s.dental_concerns)], ["Notes", text(s.dental_notes)]
    ]]
  ];

  const grid = document.createElement("div");
  grid.className = "detail-grid";
  sections.forEach(function (sec) {
    const box = document.createElement("div");
    const h = document.createElement("h3"); h.textContent = sec[0]; box.appendChild(h);
    sec[1].forEach(function (pair) {
      const p = document.createElement("p");
      const b = document.createElement("b"); b.textContent = pair[0] + ": ";
      p.appendChild(b); p.appendChild(document.createTextNode(pair[1]));
      box.appendChild(p);
    });
    grid.appendChild(box);
  });
  return grid;
}

// ---------- CSV export ----------
function downloadCsv() {
  // Same order as the screen: Grade -> Section -> code number
  const g = groupStudents(filtered());
  const list = [];
  g.grades.forEach(function (gr) { gr.sections.forEach(function (sec) { list.push.apply(list, sec.students); }); });
  list.push.apply(list, g.unassigned);
  if (!list.length) return;
  const hidden = ["lrn", "code_gender", "code_number", "grade", "section", "name", "student_code"];
  const cols = ["grade", "section", "student_code", "name"].concat(
    Object.keys(list[0]).filter(function (c) { return !hidden.includes(c); })
  );
  list.forEach(function (s) { s.student_code = studentCode(s); });
  const esc = function (v) {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) v = v.join("; ");
    v = String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const lines = [cols.join(",")].concat(list.map(function (s) {
    return cols.map(function (c) { return esc(s[c]); }).join(",");
  }));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "registered-students.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- login / logout ----------
function showDashboard() {
  loginBox.style.display = "none";
  dashboard.style.display = "block";
  startAutoRefresh();
}

function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  loginError.textContent = "";
  if (window.location.protocol === "file:") {
    loginError.textContent = "This page only works online. Open it from your Vercel link, e.g. dental-app2-git-main-dental-app1.vercel.app/Students.html";
    return;
  }
  if (!username || !password) { loginError.textContent = "Please enter your username and password."; return; }

  const btn = document.getElementById("loginBtn");
  btn.disabled = true; btn.textContent = "Checking...";

  fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username, password: password })
  })
    .then(readJson)
    .then(function (data) {
      saveToken(data.token);
      document.getElementById("password").value = "";
      firstLoad = true;
      return loadStudents();
    })
    .then(showDashboard)
    .catch(function (err) {
      clearToken();
      loginError.textContent = err.message;
      countText.textContent = "";
    })
    .finally(function () {
      btn.disabled = false; btn.textContent = "Log in";
    });
}

function logout(reason) {
  stopAutoRefresh();
  clearToken();
  students = []; knownIds = new Set(); newIds = new Set();
  groupsBox.innerHTML = "";
  searchInput.value = "";
  dashboard.style.display = "none";
  document.getElementById("record").style.display = "none";
  document.getElementById("visitForm").style.display = "none";
  loginBox.style.display = "block";
  loginError.textContent = reason || "";
}

// ---------- events ----------
document.getElementById("loginBtn").addEventListener("click", login);
["username", "password"].forEach(function (id) {
  document.getElementById(id).addEventListener("keydown", function (e) {
    if (e.key === "Enter") login();
  });
});
document.getElementById("logoutBtn").addEventListener("click", function () { logout(); });
document.getElementById("refreshBtn").addEventListener("click", function () {
  loadStudents().catch(handleRefreshError);
});
document.getElementById("exportBtn").addEventListener("click", downloadCsv);
searchInput.addEventListener("input", render);
gradeFilter.addEventListener("change", render);

// ---------- start: stay logged in after a page refresh ----------
token = readToken();
if (token && window.location.protocol !== "file:") {
  loadStudents()
    .then(showDashboard)
    .catch(function (err) { logout(err.status === 401 ? err.message : ""); });
}
