// Dentist / nurse view of all registered students.

const API_URL = "/api/students";

let password = "";
let students = [];

const loginBox = document.getElementById("login");
const dashboard = document.getElementById("dashboard");
const loginError = document.getElementById("loginError");
const rowsBody = document.getElementById("studentRows");
const searchInput = document.getElementById("search");
const gradeFilter = document.getElementById("gradeFilter");
const countText = document.getElementById("count");

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

// Anything the dentist should notice before treatment
function healthAlerts(s) {
  const alerts = [];
  if (s.allergies) alerts.push("Allergy");
  if (s.conditions && s.conditions.length) alerts.push(...s.conditions);
  if (s.other_conditions) alerts.push("Other condition");
  if (s.medications) alerts.push("On medication");
  return alerts;
}

// ---------- load data ----------
function loadStudents() {
  countText.textContent = "Loading...";
  return fetch(API_URL, { headers: { "x-staff-password": password } })
    .then(function (res) {
      return res.text().then(function (body) {
        let data = {};
        try { data = JSON.parse(body); } catch (e) {}
        if (res.status === 404) throw new Error("Back end not found (api/students.js is missing on the server)");
        if (!res.ok) throw new Error(data.error || ("Server error " + res.status));
        return data.students || [];
      });
    })
    .then(function (list) {
      students = list;
      fillGradeFilter();
      render();
    });
}

function fillGradeFilter() {
  const current = gradeFilter.value;
  const grades = Array.from(new Set(students.map(function (s) { return s.grade; }).filter(Boolean))).sort();
  gradeFilter.innerHTML = '<option value="">All grades</option>';
  grades.forEach(function (g) {
    const o = document.createElement("option");
    o.value = g; o.textContent = g;
    gradeFilter.appendChild(o);
  });
  gradeFilter.value = current;
}

// ---------- table ----------
function filtered() {
  const q = searchInput.value.trim().toLowerCase();
  const g = gradeFilter.value;
  return students.filter(function (s) {
    if (g && s.grade !== g) return false;
    if (!q) return true;
    return [s.name, s.lrn, s.parent_name, s.section]
      .some(function (v) { return v && String(v).toLowerCase().includes(q); });
  });
}

function render() {
  const list = filtered();
  rowsBody.innerHTML = "";
  countText.textContent = list.length + " of " + students.length + " students";

  if (!list.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9; td.className = "empty";
    td.textContent = students.length ? "No students match your search." : "No students registered yet.";
    tr.appendChild(td); rowsBody.appendChild(tr);
    return;
  }

  list.forEach(function (s) {
    const tr = document.createElement("tr");
    tr.className = "row";

    cell(tr, text(s.name));
    cell(tr, text(s.lrn));
    cell(tr, text([s.grade, s.section].filter(Boolean).join(" - ")));
    cell(tr, text(s.age));
    cell(tr, text(s.sex));
    cell(tr, text(s.contact));

    const alerts = healthAlerts(s);
    cell(tr, alerts.length ? tag(alerts.join(", "), "warn") : "—");
    cell(tr, s.consent ? tag("Yes", "yes") : tag("No", "no"));
    cell(tr, formatDate(s.registered_on));

    tr.addEventListener("click", function () { toggleDetails(tr, s); });
    rowsBody.appendChild(tr);
  });
}

function toggleDetails(tr, s) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains("details")) { next.remove(); return; }

  const sections = [
    ["Student", [
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

  const row = document.createElement("tr");
  row.className = "details";
  const td = document.createElement("td");
  td.colSpan = 9;
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

  td.appendChild(grid); row.appendChild(td);
  tr.after(row);
}

// ---------- CSV export ----------
function downloadCsv() {
  const list = filtered();
  if (!list.length) return;
  const cols = Object.keys(list[0]);
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

// ---------- events ----------
function login() {
  password = document.getElementById("password").value;
  loginError.textContent = "";
  if (!password) { loginError.textContent = "Please enter the password."; return; }

  loadStudents()
    .then(function () {
      loginBox.style.display = "none";
      dashboard.style.display = "block";
    })
    .catch(function (err) {
      loginError.textContent = err.message;
      countText.textContent = "";
    });
}

document.getElementById("loginBtn").addEventListener("click", login);
document.getElementById("password").addEventListener("keydown", function (e) {
  if (e.key === "Enter") login();
});
document.getElementById("refreshBtn").addEventListener("click", function () {
  loadStudents().catch(function (err) { countText.textContent = err.message; });
});
document.getElementById("exportBtn").addEventListener("click", downloadCsv);
searchInput.addEventListener("input", render);
gradeFilter.addEventListener("change", render);
