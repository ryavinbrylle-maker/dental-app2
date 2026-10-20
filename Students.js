// Dentist-only view of all registered students.
// - Log in once; the login lasts 12 hours (even if the page is refreshed or the
//   device goes offline – the roster is kept on this device by StudentStorageInfo).
// - The list checks for new registrations every 15 seconds by itself.
// - Shows the active school year and the upload status of records saved on this device.

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
let statsTick = 0;
let currentSchoolYear = null;   // e.g. "2026-2027" (from the server, or this device when offline)
let offlineRoster = false;      // true while showing the copy saved on this device

const loginBox = document.getElementById("login");
const dashboard = document.getElementById("dashboard");
const loginError = document.getElementById("loginError");
const groupsBox = document.getElementById("groups");
const searchInput = document.getElementById("search");
const gradeFilter = document.getElementById("gradeFilter");
const countText = document.getElementById("count");
const liveText = document.getElementById("live");
const toast = document.getElementById("toast");

// ---------- saved login ----------
// Kept on this device until it expires (12 hours, the time is inside the token) so the
// dentist can reopen the app without internet during a school day.
function tokenExpiry(t) { const n = Number(String(t || "").split(".")[0]); return isFinite(n) ? n : 0; }
function saveToken(t) {
  token = t;
  try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
}
function readToken() {
  let t = "";
  try { t = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  if (tokenExpiry(t) < Date.now()) { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} return ""; }
  return t;
}
function clearToken() {
  token = "";
  try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
}
function isNetworkFailure(err) {
  return !navigator.onLine || err instanceof TypeError || /fetch|network/i.test(String(err && err.message));
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
function setSchoolYear(y) {
  if (y) currentSchoolYear = y;
  document.getElementById("syBadge").textContent = currentSchoolYear ? "SY " + currentSchoolYear : "";
}

function loadStudents(quiet) {
  if (!quiet) countText.textContent = "Loading...";
  return fetch(API_URL, { headers: { "Authorization": "Bearer " + token } })
    .then(readJson)
    .then(function (data) {
      const list = data.students || [];
      offlineRoster = false;
      setSchoolYear(data.school_year);
      StudentStorageInfo.cacheStudents(list, data.school_year).catch(function (e) { console.warn(e); });

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
    })
    .catch(function (err) {
      if (err.status === 401 || !isNetworkFailure(err)) throw err;
      return loadStudentsFromDevice().then(function (ok) { if (!ok) throw err; });
    });
}

// No internet: show the roster saved on this device (from the last time it was online)
function loadStudentsFromDevice() {
  return StudentStorageInfo.getStudents().then(function (r) {
    if (!r.students.length && !r.school_year) return false;
    offlineRoster = true;
    students = r.students;
    knownIds = new Set(students.map(function (s) { return s.id; }));
    firstLoad = false;
    setSchoolYear(r.school_year);
    liveText.classList.add("off");
    liveText.textContent = "● Offline – showing the copy saved on this device" +
      (r.saved_at ? " (" + new Date(r.saved_at).toLocaleString() + ")" : "");
    fillGradeFilter();
    render();
    return true;
  });
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(function () {
    if (document.hidden) return; // don't check while the tab is in the background
    loadStudents(true).catch(handleRefreshError);
    if (++statsTick % 4 === 0) loadStats();        // about once a minute
  }, REFRESH_SECONDS * 1000);
}
function stopAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}
function handleRefreshError(err) {
  if (err.status === 401) { logout(err.message); return; }
  if (offlineRoster) return;      // already showing the saved copy
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
// Sections / strands in the school's own order (SchoolClasses.js); others A–Z after them
function compareSections(a, b) { return compareSchoolSections(a, b); }
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
  // only the school's grades (Grade 7–12, SchoolClasses.js)
  const grades = GRADE_LIST.slice();
  gradeFilter.innerHTML = '<option value="">All grades</option>';
  grades.forEach(function (g) {
    const o = document.createElement("option");
    o.value = g; o.textContent = g;
    gradeFilter.appendChild(o);
  });
  gradeFilter.value = grades.includes(current) ? current : "";
}

// ---------- list ----------
// Kinder to Grade 6 are no longer used by the school: those students are never listed
// ("All grades" included) and can be removed with one button (see oldGradeBox below).
function isOldGrade(g) { return Boolean(g) && !GRADE_LIST.includes(g); }
function schoolStudents() { return students.filter(function (s) { return !isOldGrade(s.grade); }); }

function filtered() {
  const q = searchInput.value.trim().toLowerCase();
  return schoolStudents().filter(function (s) {
    if (!q) return true;
    const code = studentCode(s).toLowerCase();
    if (code && (code === q || code.replace("-", "") === q.replace(/[\s-]/g, ""))) return true;
    return [s.name, s.parent_name, s.section, s.grade]
      .some(function (v) { return v && String(v).toLowerCase().includes(q); });
  });
}

const COLUMNS = ["Code", "Name", "Age", "Health alerts", "Consent", "Registered"];

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

// ---------- remove Kinder–Grade 6 students (grades the school no longer uses) ----------
let removingOld = false;
function renderOldGradeBox() {
  let box = document.getElementById("oldGradeBox");
  const old = students.filter(function (s) { return isOldGrade(s.grade); });
  if (!old.length && !removingOld) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement("div");
    box.id = "oldGradeBox";
    box.className = "card match-card";
    groupsBox.parentNode.insertBefore(box, groupsBox);
  }
  if (removingOld) return;                         // progress text is being shown
  box.innerHTML = "";
  const grades = Array.from(new Set(old.map(function (s) { return s.grade; }))).sort(compareGrades);
  box.appendChild(el("h3", "", old.length + " student" + (old.length === 1 ? "" : "s") + " in Kinder – Grade 6"));
  box.appendChild(el("p", "muted", "The school only uses Grade 7 to Grade 12 now, so these students (" + grades.join(", ") +
    ") are hidden from the list. Remove them from the roster? Their dental records are kept in the archive; nothing else is changed."));
  const btn = el("button", "btn-absent", "Remove all " + old.length + " Kinder – Grade 6 students");
  btn.type = "button";
  btn.addEventListener("click", function () {
    if (!navigator.onLine) { showToast("Removing students needs internet."); return; }
    if (btn.dataset.confirm !== "1") {
      btn.dataset.confirm = "1"; btn.textContent = "Tap again to remove " + old.length + " students";
      setTimeout(function () { btn.dataset.confirm = ""; btn.textContent = "Remove all " + old.length + " Kinder – Grade 6 students"; }, 6000);
      return;
    }
    removeOldGradeStudents(old, box);
  });
  box.appendChild(btn);
}

function removeOldGradeStudents(list, box) {
  removingOld = true;
  let done = 0, failed = 0;
  const status = el("p", "muted", "");
  box.innerHTML = ""; box.appendChild(el("h3", "", "Removing Kinder – Grade 6 students...")); box.appendChild(status);
  // a few at a time so a big list finishes quickly without overloading the server
  const queue = list.slice();
  function worker() {
    const s = queue.shift();
    if (!s) return Promise.resolve();
    return fetch(API_URL + "?id=" + s.id, { method: "DELETE", headers: { "Authorization": "Bearer " + token } })
      .then(readJson)
      .then(function () { done++; }, function (err) { failed++; if (err.status === 401) queue.length = 0; })
      .then(function () { status.textContent = done + " of " + list.length + " removed" + (failed ? ", " + failed + " failed" : ""); return worker(); });
  }
  Promise.all([worker(), worker(), worker(), worker()]).then(function () {
    removingOld = false;
    showToast(done + " Kinder – Grade 6 student" + (done === 1 ? "" : "s") + " removed" + (failed ? " (" + failed + " failed – tap the button again)" : ""));
    return loadStudents(true);
  }).catch(function (err) { removingOld = false; handleRefreshError(err); });
}

// ---------- dashboard: Grade tabs -> Section cards -> one section's students ----------
// Instead of one very long page, the dentist picks a grade, then a section (big cards with
// counts), and only that section's students are shown. Typing in the search box searches
// every grade and section at once.
const VIEW_KEY = "dashboardView";
let dashView = (function () {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch (e) { return {}; }
})();
function setDashView(v) {
  dashView = v;
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch (e) { /* not saved – fine */ }
  render();
  window.scrollTo(0, 0);
}

function render() {
  const all = schoolStudents();
  const hint = document.getElementById("groupsHint");
  setTimeout(function () { hint.hidden = !groupsBox.querySelector("tr.row"); }, 0);
  const q = searchInput.value.trim();
  groupsBox.innerHTML = "";
  renderOldGradeBox();
  if (!all.length) {
    countText.textContent = "0 students";
    groupsBox.appendChild(el("p", "empty", "No students registered yet."));
    return;
  }
  if (q) { renderSearchResults(all); return; }

  const groups = groupStudents(all);
  const byGrade = new Map(groups.grades.map(function (g) { return [g.grade, g]; }));
  // grade: remembered choice, else the first grade that has students
  let grade = dashView.grade;
  if (grade !== "unassigned" && !GRADE_LIST.includes(grade)) grade = null;
  if (grade === "unassigned" && !groups.unassigned.length) grade = null;
  if (!grade) grade = (groups.grades[0] && groups.grades[0].grade) || (groups.unassigned.length ? "unassigned" : GRADE_LIST[0]);

  // Grade tabs
  const tabs = el("div", "grade-tabs");
  GRADE_LIST.forEach(function (g) {
    const n = byGrade.has(g) ? byGrade.get(g).sections.reduce(function (t, x) { return t + x.students.length; }, 0) : 0;
    const b = el("button", "grade-tab" + (g === grade ? " on" : "") + (n ? "" : " empty"));
    b.type = "button";
    b.appendChild(el("b", "", g));
    b.appendChild(el("span", "", n + " student" + (n === 1 ? "" : "s")));
    b.addEventListener("click", function () { setDashView({ grade: g }); });
    tabs.appendChild(b);
  });
  if (groups.unassigned.length) {
    const b = el("button", "grade-tab warn" + (grade === "unassigned" ? " on" : ""));
    b.type = "button";
    b.appendChild(el("b", "", "Not placed"));
    b.appendChild(el("span", "", groups.unassigned.length + " to fix"));
    b.addEventListener("click", function () { setDashView({ grade: "unassigned" }); });
    tabs.appendChild(b);
  }
  groupsBox.appendChild(tabs);

  if (grade === "unassigned") {
    countText.textContent = groups.unassigned.length + " student(s) need a grade, section or code · " + all.length + " students in all";
    groupsBox.appendChild(sectionBox("Not yet placed", groups.unassigned, { unassigned: true }));
    return;
  }

  const g = byGrade.get(grade) || { grade: grade, sections: [] };
  const bySection = new Map(g.sections.map(function (x) { return [x.section, x.students]; }));
  // the school's sections for this grade (also empty ones), plus any older section names in use
  const names = sectionsFor(grade);
  g.sections.forEach(function (x) { if (!names.includes(x.section)) names.push(x.section); });
  const gradeTotal = g.sections.reduce(function (t, x) { return t + x.students.length; }, 0);

  const section = dashView.grade === grade && bySection.has(dashView.section) ? dashView.section : null;
  if (!section) {
    countText.textContent = grade + ": " + gradeTotal + " students in " + g.sections.length + " section(s) · " + all.length + " students in all";
    const grid = el("div", "sec-grid");
    names.forEach(function (name) {
      const list = bySection.get(name) || [];
      const card = el("button", "sec-card" + (list.length ? "" : " empty"));
      card.type = "button";
      card.appendChild(el("b", "", name));
      if (list.length) {
        const m = list.filter(function (s) { return s.code_gender === "M"; }).length;
        card.appendChild(el("span", "sec-total", list.length + " students"));
        card.appendChild(el("span", "muted", m + " male · " + (list.length - m) + " female"));
        const alerts = list.filter(function (s) { return healthAlerts(s).length; }).length;
        if (alerts) card.appendChild(el("span", "tag warn", "⚠ " + alerts + " health alert" + (alerts === 1 ? "" : "s")));
        const fresh = list.filter(function (s) { return newIds.has(s.id); }).length;
        if (fresh) card.appendChild(el("span", "tag yes", fresh + " new"));
        card.addEventListener("click", function () { setDashView({ grade: grade, section: name }); });
      } else {
        card.appendChild(el("span", "muted", "No students yet"));
        card.disabled = true;
      }
      grid.appendChild(card);
    });
    groupsBox.appendChild(grid);
    return;
  }

  // one section
  const list = bySection.get(section);
  countText.textContent = grade + " – " + section + ": " + list.length + " students";
  const bar = el("div", "sec-bar");
  const back = el("button", "secondary", "‹ All " + grade + " sections");
  back.type = "button";
  back.addEventListener("click", function () { setDashView({ grade: grade }); });
  bar.appendChild(back);
  // quick switch to another section of the same grade
  const pick = el("select", "box sec-pick");
  names.filter(function (n) { return bySection.has(n); }).forEach(function (n) {
    const o = el("option", "", n + " (" + bySection.get(n).length + ")"); o.value = n;
    if (n === section) o.selected = true;
    pick.appendChild(o);
  });
  pick.addEventListener("change", function () { setDashView({ grade: grade, section: pick.value }); });
  bar.appendChild(pick);
  groupsBox.appendChild(bar);
  groupsBox.appendChild(sectionBox(grade + " – " + section, list));
}

// Search: results from every grade and section, grouped
function renderSearchResults(all) {
  const list = filtered();
  countText.textContent = list.length + " of " + all.length + " students match “" + searchInput.value.trim() + "”";
  if (!list.length) { groupsBox.appendChild(el("p", "empty", "No students match your search.")); return; }
  const groups = groupStudents(list);
  groups.grades.forEach(function (g) {
    g.sections.forEach(function (sec) { groupsBox.appendChild(sectionBox(g.grade + " – " + sec.section, sec.students)); });
  });
  if (groups.unassigned.length) groupsBox.appendChild(sectionBox("Not yet placed", groups.unassigned, { unassigned: true }));
}

// Full student details as a grid (used on the student record page)
// Blood type, height, weight, address, parent/guardian and dental history are no longer asked
// on the registration form; they only appear here for older records that still have them.
function studentInfoGrid(s) {
  const has = function (v) { return v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length); };
  const sections = [
    ["Student", [
      ["Class", text([s.grade, s.section].filter(Boolean).join(" – "))],
      ["Student code", studentCode(s) || "—"],
      ["Birthdate", formatDate(s.birthdate)], ["Age", text(s.age)],
      has(s.blood_type) && ["Blood type", text(s.blood_type)],
      has(s.height_cm) && ["Height", s.height_cm + " cm"], has(s.weight_kg) && ["Weight", s.weight_kg + " kg"],
      has(s.address) && ["Address", text(s.address)]
    ]],
    [s.parent_name, s.relationship, s.contact, s.emergency_contact].some(has) && ["Parent / Guardian", [
      ["Name", text(s.parent_name)], ["Relationship", text(s.relationship)],
      ["Contact", text(s.contact)], ["Emergency", text(s.emergency_contact)]
    ]],
    ["Medical", [
      ["Conditions", text(s.conditions)], ["Other", text(s.other_conditions)],
      ["Allergies", text(s.allergies)], ["Medications", text(s.medications)]
    ]],
    [s.last_visit, s.brushing, s.dental_concerns, s.dental_notes].some(has) && ["Dental history", [
      ["Last visit", formatDate(s.last_visit)], ["Brushing", text(s.brushing)],
      ["Concerns", text(s.dental_concerns)], ["Notes", text(s.dental_notes)]
    ]]
  ].filter(Boolean).map(function (sec) { return [sec[0], sec[1].filter(Boolean)]; });

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
  document.body.classList.add("signed-in");      // shows the navigation, status and log out
  if (typeof show === "function") show("dashboard", true);   // also highlights "Students" in the menu
  startAutoRefresh();
  startStorage();
  loadStats();
  if (typeof loadMatches === "function") loadMatches();   // SchoolYearDentalRecords.js
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
  if (!navigator.onLine) { loginError.textContent = "Logging in needs internet. After that the app works offline for 12 hours."; return; }

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
  syncPanel.hidden = true;
  document.body.classList.remove("signed-in");
  // Privacy: remove this device's copies – but never changes still waiting to upload
  StudentStorageInfo.clearCache().then(function (cleared) {
    if (!cleared) loginError.textContent = (reason ? reason + " " : "") +
      "Some records are still waiting to upload; they stay on this device and upload after you log in again.";
  }).catch(function () {});
  students = []; knownIds = new Set(); newIds = new Set();
  statsBox.hidden = true; statsBox.innerHTML = "";
  groupsBox.innerHTML = "";
  searchInput.value = "";
  dashboard.style.display = "none";
  document.getElementById("record").style.display = "none";
  document.getElementById("visitForm").style.display = "none";
  document.getElementById("appointments").style.display = "none";
  document.getElementById("schoolYears").style.display = "none";
  document.getElementById("matchBox").style.display = "none";
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

// ---------- dashboard summary (real numbers from /api/stats; last copy kept for offline) ----------
const statsBox = document.getElementById("statsBox");
function loadStats() {
  if (!token) return Promise.resolve();
  const fromDevice = function () {
    return StudentStorageInfo.getMeta("stats").then(function (saved) { if (saved) renderStats(saved, true); });
  };
  if (!navigator.onLine) return fromDevice();
  return fetch("/api/stats?date=" + todayIso(), { headers: { "Authorization": "Bearer " + token } })
    .then(readJson)
    .then(function (d) {
      d.saved_at = new Date().toISOString();
      StudentStorageInfo.setMeta("stats", d).catch(function () {});
      renderStats(d, false);
    })
    .catch(function (err) { if (err.status === 401) return; return fromDevice(); });
}
function statCard(label, value, sub, cls) {
  const c = el("div", "stat" + (cls ? " " + cls : ""));
  c.appendChild(el("span", "stat-label", label));
  c.appendChild(el("b", "stat-value", value));
  if (sub) c.appendChild(el("span", "stat-sub", sub));
  return c;
}
function renderStats(d, fromDevice) {
  statsBox.innerHTML = "";
  statsBox.hidden = false;
  const pct = d.students ? Math.round(d.examined_students / d.students * 100) : 0;
  const t = d.today || {};
  const waiting = (t["Waiting"] || 0) + (t["Late Arrival"] || 0);
  statsBox.appendChild(statCard("Registered students", String(d.students), "School year " + d.school_year));
  statsBox.appendChild(statCard("Examined this year", d.examined_students + " / " + d.students,
    pct + "% of students · " + d.examinations + " exam" + (d.examinations === 1 ? "" : "s") + " recorded", "good"));
  statsBox.appendChild(statCard("Today's appointments", String(t.total || 0),
    t.total ? (t["Completed"] || 0) + " done · " + waiting + " waiting · " + (t["Absent"] || 0) + " absent" : "None scheduled yet",
    waiting ? "warn" : ""));
  const recent = el("div", "stat recent");
  recent.appendChild(el("span", "stat-label", "Latest examinations"));
  if (!d.recent || !d.recent.length) recent.appendChild(el("span", "stat-sub", "No examinations yet this school year."));
  else {
    const ul = el("ul");
    d.recent.forEach(function (r) {
      const li = el("li");
      li.appendChild(el("b", "", (r.code ? r.code + " " : "") + r.name));
      li.appendChild(el("span", "", " · " + [r.grade, r.section].filter(Boolean).join(" – ") + " · " + niceDate(r.visit_date)));
      ul.appendChild(li);
    });
    recent.appendChild(ul);
  }
  statsBox.appendChild(recent);
  if (fromDevice && d.saved_at) {
    statsBox.appendChild(el("p", "stat-note", "Offline – summary from " + new Date(d.saved_at).toLocaleString()));
  }
}

// ---------- StudentStorageInfo: upload status (header pill + panel) ----------
const syncPill = document.getElementById("syncStatus");
const syncPanel = document.getElementById("syncPanel");
let storageStarted = false;
let lastSyncStatus = null;

function startStorage() {
  if (storageStarted) { StudentStorageInfo.syncNow(); return; }
  storageStarted = true;
  StudentStorageInfo.onStatus(renderSyncStatus);
  StudentStorageInfo.start({
    getToken: function () { return token; },
    onAuthError: function () { showToast("Your login expired. Log in again to upload the records saved on this device."); },
    onChange: onStorageChange
  });
}

// Uploads finished: redraw whatever page is open from this device's storage
function onStorageChange() {
  loadStats();
  if (typeof refreshFromStorage === "function") refreshFromStorage();       // Appointments.js
  if (document.getElementById("record").style.display === "block" && currentStudent && typeof loadVisits === "function") {
    loadVisits();
  }
}

function renderSyncStatus(st) {
  lastSyncStatus = st;
  const c = st.counts;
  const waiting = c.pending + c.syncing;
  const problems = c.failed + c.conflict;
  let label, cls;
  if (problems) { label = "⚠ " + problems + " need attention"; cls = "bad"; }
  else if (st.syncing || c.syncing) { label = "⟳ Uploading " + waiting + "…"; cls = "pending"; }
  else if (waiting && !st.online) { label = "● Offline – " + waiting + " saved on device"; cls = "offline"; }
  else if (waiting) { label = "● " + waiting + " waiting to upload"; cls = "pending"; }
  else if (!st.online) { label = "● Offline"; cls = "offline"; }
  else { label = "✓ All synced"; cls = "ok"; }
  syncPill.textContent = label;
  syncPill.className = "sync-pill " + cls;
  if (!syncPanel.hidden) renderSyncPanel();
}

const OP_STATE = {
  pending: ["Waiting to upload", "pending"], syncing: ["Uploading…", "syncing"], synced: ["Synced", "synced"],
  failed: ["Upload failed", "failed"], conflict: ["Conflict", "conflict"]
};

function renderSyncPanel() {
  const st = lastSyncStatus;
  if (!st) return;
  const c = st.counts;
  const summary = document.getElementById("syncSummary");
  summary.textContent = (st.online ? "Online. " : "Offline – everything below is safely saved on this device. ") +
    c.pending + " waiting, " + c.syncing + " uploading, " + c.failed + " failed, " + c.conflict + " conflict(s), " +
    c.synced + " uploaded recently." + (st.error ? " Last problem: " + st.error : "") +
    (st.memoryOnly ? " ⚠ This browser does not allow saving on the device (private mode?) – keep the page open until uploads finish." : "");
  document.getElementById("syncNowBtn").disabled = !st.online || st.syncing;

  // Grouped by school year -> grade–section -> student (newest first inside)
  const box = document.getElementById("syncList");
  box.innerHTML = "";
  const shown = st.ops.filter(function (o) { return o.status !== "discarded"; })
    .sort(function (a, b) { return b.seq - a.seq; }).slice(0, 200);
  if (!shown.length) { box.appendChild(el("p", "muted", "Nothing saved on this device yet.")); return; }
  const groups = new Map();
  shown.forEach(function (o) {
    const s = o.summary || {};
    const key = "SY " + (s.school_year || "?") + " · " + ([s.grade, s.section].filter(Boolean).join(" – ") || "No class");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  Array.from(groups.keys()).sort().reverse().forEach(function (key) {
    const g = el("div", "sync-group");
    g.appendChild(el("b", "", key));
    groups.get(key).sort(function (a, b) {
      return String((a.summary || {}).code || "").localeCompare(String((b.summary || {}).code || ""), undefined, { numeric: true }) || b.seq - a.seq;
    }).forEach(function (o) { g.appendChild(syncOpRow(o)); });
    box.appendChild(g);
  });
}

function syncOpRow(o) {
  const s = o.summary || {};
  const row = el("div", "sync-op");
  const what = el("div", "what");
  what.appendChild(el("span", "", [s.code, s.student_name].filter(Boolean).join(" ") || "Class"));
  what.appendChild(document.createTextNode(" – " + (s.label || o.type)));
  what.appendChild(el("small", "", "Saved " + new Date(o.created_at).toLocaleString() +
    (o.status === "synced" && o.synced_at ? " · uploaded " + new Date(o.synced_at).toLocaleString() : "") +
    (o.error && o.status !== "synced" ? " · " + o.error : "")));
  row.appendChild(what);
  const info = OP_STATE[o.status] || [o.status, "pending"];
  row.appendChild(el("span", "sbadge " + info[1], info[0]));

  function button(text, cls, fn) {
    const b = el("button", "mini-btn " + (cls || ""), text); b.type = "button";
    b.addEventListener("click", fn);
    row.appendChild(b);
    return b;
  }
  if (o.status === "failed" || o.status === "conflict") {
    if (o.status === "failed") button("Try again", "", function () { StudentStorageInfo.retry(o.op_id); });
    if (o.status === "conflict" && o.type === "visit.update") {
      button("Keep both (save as new exam)", "", function () {
        StudentStorageInfo.keepBothVisit(o.op_id).then(function () { showToast("Saved as a separate examination"); onStorageChange(); });
      });
    }
    const d = button(o.type === "visit.create" ? "Discard exam" : "Discard change", "danger", function () {
      if (d.dataset.confirm !== "1") {
        d.dataset.confirm = "1";
        d.textContent = o.type === "visit.create" ? "Tap again – this exam is NOT on the server" : "Tap again to discard";
        setTimeout(function () { d.dataset.confirm = ""; d.textContent = "Discard"; }, 5000);
        return;
      }
      StudentStorageInfo.discard(o.op_id).then(function () { showToast("Change discarded – the server version is kept"); });
    });
  }
  return row;
}

syncPill.addEventListener("click", function () {
  syncPanel.hidden = false;
  StudentStorageInfo.status().then(renderSyncStatus);
});
document.getElementById("syncClose").addEventListener("click", function () { syncPanel.hidden = true; });
syncPanel.addEventListener("click", function (e) { if (e.target === syncPanel) syncPanel.hidden = true; });
document.getElementById("syncNowBtn").addEventListener("click", function () { StudentStorageInfo.syncNow(); });
window.addEventListener("online", function () { if (token) loadStudents(true).catch(handleRefreshError); });
window.addEventListener("offline", function () { if (token) { liveText.classList.add("off"); liveText.textContent = "● Offline – changes are saved on this device"; } });

// ---------- start: stay logged in after a page refresh (also without internet) ----------
document.body.classList.remove("signed-in");
token = readToken();
if (token && window.location.protocol !== "file:") {
  loadStudents()
    .then(showDashboard)
    .catch(function (err) { logout(err.status === 401 ? err.message : (isNetworkFailure(err) ? "No internet and nothing saved on this device yet." : "")); });
}
