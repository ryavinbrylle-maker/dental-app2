// SchoolYearDentalRecords — school years, their dental archives, the new-school-year
// transition, and the returning-student check.
// ---------------------------------------------------------------------------
// • Every school year keeps its own registrations. Starting a new year saves a frozen
//   archive copy of each student's record and starts an EMPTY roster – nothing is deleted.
// • Archived records can be opened here at any time (and are kept on this device for
//   offline viewing once opened).
// • When a student registers again in a later year, the server links them to their old
//   history only when it is certain (same name AND birthdate, one candidate). Otherwise
//   the dentist confirms here ("Same student" / "Different student"). Names alone never
//   merge two students.
// Uses from Students.js / Dental.js: token, readJson, showToast, el, show, niceDate,
//   longDateText, examDetails, toothMap, normalizeTeeth, dmftCounts, studentCode,
//   compareGrades, compareSections, compareCodes, currentSchoolYear, setSchoolYear,
//   loadStudents, handleAuthError.
const SY_URL = "/api/schoolyears";
const IDENTITY_URL = "/api/identity";

const sy = { years: [], active: null, year: null, regs: [], cls: "", search: "" };

function syApi(url, options) {
  options = options || {};
  options.headers = Object.assign({ "Authorization": "Bearer " + token, "Content-Type": "application/json" },
                                  options.headers || {});
  return fetch(url, options).then(readJson);
}
function syEl(id) { return document.getElementById(id); }

// ---------- school year list ----------
function openSchoolYears() {
  show("schoolYears");
  syEl("syError").textContent = "";
  syEl("syStartError").textContent = "";
  syEl("sySub").textContent = currentSchoolYear ? "Active school year: " + currentSchoolYear : "";
  if (!syEl("syNewYear").value && currentSchoolYear) {
    const a = Number(currentSchoolYear.slice(0, 4)) + 1;
    syEl("syNewYear").placeholder = "e.g. " + a + "-" + (a + 1);
  }
  loadYears();
}

function loadYears() {
  const box = syEl("syYears");
  if (!navigator.onLine) {
    return StudentStorageInfo.getArchive("years").then(function (saved) {
      if (saved) { applyYears(saved.value, true); }
      else { box.innerHTML = ""; box.appendChild(el("p", "muted", "No internet. School years appear here after opening this page online once.")); }
    });
  }
  box.innerHTML = "";
  box.appendChild(el("p", "muted", "Loading..."));
  return syApi(SY_URL).then(function (data) {
    StudentStorageInfo.putArchive("years", data).catch(function () {});
    applyYears(data, false);
  }).catch(function (err) {
    if (handleAuthError(err)) return;
    return StudentStorageInfo.getArchive("years").then(function (saved) {
      if (saved) applyYears(saved.value, true);
      else { box.innerHTML = ""; syEl("syError").textContent = err.message; }
    });
  });
}

function applyYears(data, fromDevice) {
  sy.years = data.years || [];
  sy.active = data.active;
  setSchoolYear(data.active);
  syEl("sySub").textContent = "Active school year: " + data.active + (fromDevice ? " (saved copy – offline)" : "");
  const box = syEl("syYears");
  box.innerHTML = "";
  if (!sy.years.length) { box.appendChild(el("p", "muted", "No school years yet.")); return; }
  sy.years.forEach(function (y) {
    const row = el("div", "sy-year" + (y.status === "active" ? " active" : ""));
    row.dataset.year = y.id;
    const left = el("div");
    left.appendChild(el("b", "", "SY " + y.id));
    left.appendChild(document.createTextNode(y.status === "active" ? "  · active (current roster)" : "  · archived"));
    row.appendChild(left);
    row.appendChild(el("span", "counts",
      y.registrations + " students · " + y.examinations + " exams · " + y.appointments + " appointments" +
      (y.status !== "active" ? " · " + y.archived + " archived records" : "")));
    const btn = el("button", "mini-btn", "Open"); btn.type = "button";
    row.appendChild(btn);
    row.addEventListener("click", function () { openYear(y.id); });
    box.appendChild(row);
  });
}

// ---------- one school year: registrations by grade / section ----------
function openYear(year) {
  sy.year = year; sy.cls = ""; sy.search = ""; syEl("sySearch").value = "";
  syEl("syArchiveCard").style.display = "block";
  syEl("syRecordCard").style.display = "none";
  syEl("syArchiveTitle").textContent = "SY " + year;
  const list = syEl("syStudents");
  list.innerHTML = "";
  list.appendChild(el("p", "muted", "Loading..."));
  const key = "year:" + year;
  const fromDevice = function () {
    return StudentStorageInfo.getArchive(key).then(function (saved) {
      if (saved) { sy.regs = saved.value.registrations || []; renderYear(true); return; }
      list.innerHTML = "";
      list.appendChild(el("p", "muted", "Not saved on this device. Open it once with internet to view it offline."));
    });
  };
  if (!navigator.onLine) return fromDevice();
  return syApi(SY_URL + "?year=" + encodeURIComponent(year)).then(function (data) {
    StudentStorageInfo.putArchive(key, data).catch(function () {});
    sy.regs = data.registrations || [];
    renderYear(false);
  }).catch(function (err) { if (!handleAuthError(err)) return fromDevice(); });
}

function renderYear(fromDevice) {
  const chips = syEl("syClassChips");
  chips.innerHTML = "";
  const classes = [];
  const seen = new Set();
  sy.regs.forEach(function (r) {
    const k = (r.grade || "?") + "|" + (r.section || "?");
    if (!seen.has(k)) { seen.add(k); classes.push({ key: k, grade: r.grade || "?", section: r.section || "?" }); }
  });
  classes.sort(function (a, b) { return compareGrades(a.grade, b.grade) || compareSections(a.section, b.section); });
  const all = el("button", "chip" + (sy.cls ? "" : " on"), "All (" + sy.regs.length + ")"); all.type = "button";
  all.addEventListener("click", function () { sy.cls = ""; renderYear(fromDevice); });
  chips.appendChild(all);
  classes.forEach(function (c) {
    const n = sy.regs.filter(function (r) { return (r.grade || "?") + "|" + (r.section || "?") === c.key; }).length;
    const b = el("button", "chip" + (sy.cls === c.key ? " on" : ""), c.grade + " – " + c.section + " (" + n + ")");
    b.type = "button";
    b.addEventListener("click", function () { sy.cls = c.key; renderYear(fromDevice); });
    chips.appendChild(b);
  });

  const q = sy.search.trim().toLowerCase().replace(/[\s-]/g, "");
  const list = syEl("syStudents");
  list.innerHTML = "";
  if (fromDevice) list.appendChild(el("p", "muted", "Offline – showing the copy saved on this device."));
  const rows = sy.regs.filter(function (r) {
    if (sy.cls && (r.grade || "?") + "|" + (r.section || "?") !== sy.cls) return false;
    if (!q) return true;
    const code = studentCode(r).toLowerCase().replace("-", "");
    return code === q || String(r.name || "").toLowerCase().replace(/[\s-]/g, "").includes(q);
  });
  if (!rows.length) { list.appendChild(el("p", "muted", sy.regs.length ? "No students match." : "No registrations in this school year.")); return; }

  // group by grade – section, students by code (M first, then F, numeric)
  const groups = new Map();
  rows.forEach(function (r) {
    const k = (r.grade || "No grade") + " – " + (r.section || "No section");
    if (!groups.has(k)) groups.set(k, { grade: r.grade || "", section: r.section || "", list: [] });
    groups.get(k).list.push(r);
  });
  Array.from(groups.entries()).sort(function (a, b) {
    return compareGrades(a[1].grade, b[1].grade) || compareSections(a[1].section, b[1].section);
  }).forEach(function (entry) {
    const box = el("div", "section-box");
    const head = el("div", "section-head");
    head.appendChild(el("h3", "", entry[0]));
    head.appendChild(el("span", "tally", entry[1].list.length + " students"));
    box.appendChild(head);
    entry[1].list.sort(compareCodes).forEach(function (r) {
      const row = el("div", "sy-student");
      row.dataset.studentId = r.id;
      const code = el("span", "code-badge " + (studentCode(r) ? r.code_gender : "none"), studentCode(r) || "—");
      row.appendChild(code);
      row.appendChild(el("b", "", " " + r.name));
      row.appendChild(el("span", "muted", "  " + r.examinations + " exam(s)" + (r.absences ? " · " + r.absences + " absence(s)" : "") +
        (r.removed_at ? " · removed from roster" : "")));
      row.addEventListener("click", function () { openArchivedRecord(sy.year, r); });
      box.appendChild(row);
    });
    list.appendChild(box);
  });
}

// ---------- one archived record (read-only) ----------
function openArchivedRecord(year, reg) {
  const card = syEl("syRecordCard");
  const body = syEl("syRecord");
  card.style.display = "block";
  syEl("syRecordTitle").textContent = (studentCode(reg) ? studentCode(reg) + " " : "") + reg.name + " · SY " + year;
  body.innerHTML = "";
  body.appendChild(el("p", "muted", "Loading..."));
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  const key = "rec:" + year + ":" + reg.id;
  const fromDevice = function () {
    return StudentStorageInfo.getArchive(key).then(function (saved) {
      if (saved) renderArchivedRecord(saved.value, true);
      else { body.innerHTML = ""; body.appendChild(el("p", "muted", "Not saved on this device. Open it once with internet to view it offline.")); }
    });
  };
  if (!navigator.onLine) return fromDevice();
  return syApi(SY_URL + "?year=" + encodeURIComponent(year) + "&student_id=" + reg.id).then(function (data) {
    StudentStorageInfo.putArchive(key, data).catch(function () {});
    renderArchivedRecord(data, false);
  }).catch(function (err) { if (!handleAuthError(err)) return fromDevice(); });
}

function renderArchivedRecord(data, fromDevice) {
  const body = syEl("syRecord");
  body.innerHTML = "";
  const snap = data.snapshot || {};
  const reg = snap.registration || {};
  body.appendChild(el("p", "muted",
    (data.frozen ? "Frozen archive copy saved " + new Date(data.archived_at || snap.archived_at).toLocaleString()
                 : reg.school_year === currentSchoolYear
                   ? "Current year – live record (archived when the next school year starts)"
                   : "Saved records of this school year (from before archiving was added)") +
    (fromDevice ? " · offline copy" : "")));
  const info = el("p");
  info.appendChild(el("b", "", "Class: "));
  info.appendChild(document.createTextNode([reg.grade, reg.section].filter(Boolean).join(" – ") || "—"));
  info.appendChild(el("b", "", "   Birthdate: "));
  info.appendChild(document.createTextNode(reg.birthdate ? niceDate(reg.birthdate) : "—"));
  body.appendChild(info);

  const exams = (snap.examinations || []).slice().sort(function (a, b) {
    return String(b.visit_date).localeCompare(String(a.visit_date)) || (b.id || 0) - (a.id || 0);
  });
  body.appendChild(el("h4", "", "Dental examinations (" + exams.length + ")"));
  if (!exams.length) body.appendChild(el("p", "muted", "No examinations this school year."));
  exams.forEach(function (v) {
    const item = el("div", "visit");
    const top = el("div", "visit-top");
    top.appendChild(el("b", "", longDateText(v.visit_date)));
    const c = dmftCounts(normalizeTeeth(v.teeth));
    top.appendChild(el("span", "muted", "D " + c.d + " · M " + c.m + " · F " + c.f + " · DMFT " + (c.d + c.m + c.f)));
    item.appendChild(top);
    const teeth = normalizeTeeth(v.teeth);
    ["Permanent", "Primary"].forEach(function (d) {
      if (!hasAny(teeth, d)) return;
      const sc = el("div", "teeth-scroll");
      sc.appendChild(toothMap(teeth, { dentition: d, mini: true }));
      item.appendChild(sc);
    });
    examDetails(item, v);
    body.appendChild(item);
  });

  const appts = (snap.appointments || []).slice().sort(function (a, b) {
    return String(b.appointment_date).localeCompare(String(a.appointment_date));
  });
  body.appendChild(el("h4", "", "Appointments (" + appts.length + ")"));
  if (!appts.length) body.appendChild(el("p", "muted", "No appointments."));
  appts.forEach(function (a) {
    const p = el("p");
    p.appendChild(el("b", "", niceDate(a.appointment_date) + " "));
    p.appendChild(el("span", "tag " + (a.status === "Absent" ? "no" : a.status === "Completed" ? "yes" : "warn"), a.status));
    if (a.was_absent && a.status !== "Absent") p.appendChild(el("span", "muted", " (was absent first)"));
    if (a.notes) p.appendChild(el("span", "muted", " · " + a.notes));
    body.appendChild(p);
  });
}

// ---------- start a new school year ----------
function startNewYear() {
  const btn = syEl("syStartBtn");
  const errBox = syEl("syStartError");
  const next = syEl("syNewYear").value.trim();
  const confirm = syEl("syConfirm").value.trim();
  errBox.textContent = "";
  if (!navigator.onLine) { errBox.textContent = "Starting a new school year needs internet."; return; }
  if (!/^\d{4}-\d{4}$/.test(next) || Number(next.slice(5)) !== Number(next.slice(0, 4)) + 1) {
    errBox.textContent = "Write the school year like 2027-2028."; return;
  }
  if (confirm !== next) { errBox.textContent = "Type the new school year again exactly to confirm."; return; }
  StudentStorageInfo.status().then(function (st) {
    const open = st.counts.pending + st.counts.syncing + st.counts.failed + st.counts.conflict;
    if (open) {
      errBox.textContent = "First upload the " + open + " record(s) still saved only on this device (tap the status button at the top).";
      return;
    }
    if (btn.dataset.confirm !== "1") {
      btn.dataset.confirm = "1";
      btn.textContent = "Tap again: archive SY " + (currentSchoolYear || "") + " and start SY " + next;
      setTimeout(function () { btn.dataset.confirm = ""; btn.textContent = "Start new school year"; }, 6000);
      return;
    }
    btn.dataset.confirm = "";
    btn.disabled = true; btn.textContent = "Archiving...";
    return syApi(SY_URL, { method: "POST", body: JSON.stringify({ action: "start", new_year: next, confirm: confirm }) })
      .then(function (r) {
        showToast(r.already ? "SY " + next + " is already the active school year."
                            : "SY " + r.previous + " archived (" + r.archived + " records). SY " + r.active + " started with an empty roster.");
        syEl("syNewYear").value = ""; syEl("syConfirm").value = "";
        setSchoolYear(r.active);
        syEl("syArchiveCard").style.display = "none";
        syEl("syRecordCard").style.display = "none";
        return Promise.all([loadYears(), loadStudents(true)]);
      })
      .catch(function (err) { if (!handleAuthError(err)) errBox.textContent = err.message; })
      .finally(function () { btn.disabled = false; btn.textContent = "Start new school year"; });
  });
}

// ---------- returning-student check (dashboard card) ----------
function loadMatches() {
  const box = syEl("matchBox");
  if (!navigator.onLine || !token) return Promise.resolve();
  return syApi(IDENTITY_URL).then(function (data) {
    renderMatches(data.matches || []);
  }).catch(function (err) { if (!handleAuthError(err)) box.style.display = "none"; });
}

function personLine(p) {
  return [p.name, p.school_year ? "SY " + p.school_year : "", [p.grade, p.section].filter(Boolean).join(" – "),
          p.birthdate ? "born " + niceDate(p.birthdate) : "born ?", p.parent_name ? "parent: " + p.parent_name : ""]
    .filter(Boolean).join(" · ");
}

function renderMatches(matches) {
  const box = syEl("matchBox");
  box.innerHTML = "";
  if (!matches.length) { box.style.display = "none"; return; }
  box.style.display = "block";
  const head = el("div", "card-head");
  head.appendChild(el("h3", "", "Returning students to confirm (" + matches.length + ")"));
  box.appendChild(head);
  box.appendChild(el("p", "muted",
    "These new registrations have the same name as a student from an earlier year, but the app is not sure it is the same child. " +
    "Linking joins their dental history. Students are never linked by name alone."));
  matches.forEach(function (m) {
    const item = el("div", "match-item");
    item.dataset.matchId = m.match_id;
    const cols = el("div", "match-cols");
    const a = el("div");
    a.appendChild(el("b", "", "New registration " + (m.registration.code ? "(" + m.registration.code + ")" : "")));
    a.appendChild(el("p", "", personLine(m.registration)));
    const b = el("div");
    b.appendChild(el("b", "", "Earlier student"));
    (m.candidate || []).forEach(function (c) {
      b.appendChild(el("p", "", personLine(c) + " · " + c.examinations + " exam(s)"));
    });
    cols.appendChild(a); cols.appendChild(b);
    item.appendChild(cols);
    item.appendChild(el("p", "muted", "Why suggested: " + ({
      same_name_and_birthdate: "same name and birthdate, but more than one possible match",
      same_name_birthdate_missing: "same name; a birthdate is missing",
      same_name_different_birthdate: "same name but a DIFFERENT birthdate – probably another child",
      same_name: "same name"
    }[m.reason] || m.reason)));
    const actions = el("div", "save-row");
    const no = el("button", "secondary", "Different student"); no.type = "button";
    const yes = el("button", "", "Same student – link history"); yes.type = "button";
    no.addEventListener("click", function () { decideMatch(m, "reject", item); });
    yes.addEventListener("click", function () {
      if (yes.dataset.confirm !== "1") {
        yes.dataset.confirm = "1"; yes.textContent = "Tap again to link";
        setTimeout(function () { yes.dataset.confirm = ""; yes.textContent = "Same student – link history"; }, 5000);
        return;
      }
      decideMatch(m, "link", item);
    });
    actions.appendChild(no); actions.appendChild(yes);
    item.appendChild(actions);
    box.appendChild(item);
  });
}

function decideMatch(m, decision, item) {
  if (!navigator.onLine) { showToast("Confirming a returning student needs internet."); return; }
  item.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
  syApi(IDENTITY_URL, { method: "POST", body: JSON.stringify({ match_id: m.match_id, decision: decision }) })
    .then(function () {
      showToast(decision === "link" ? m.registration.name + " linked to their earlier dental records"
                                    : "Kept as a different student");
      return Promise.all([loadMatches(), loadStudents(true)]);
    })
    .catch(function (err) {
      if (handleAuthError(err)) return;
      showToast(err.message);
      return loadMatches();
    });
}

// ---------- events ----------
syEl("openSyBtn").addEventListener("click", openSchoolYears);
syEl("syBack").addEventListener("click", function () { show("dashboard"); });
syEl("syRecordClose").addEventListener("click", function () { syEl("syRecordCard").style.display = "none"; });
syEl("sySearch").addEventListener("input", function () { sy.search = syEl("sySearch").value; renderYear(!navigator.onLine); });
syEl("syStartBtn").addEventListener("click", startNewYear);
setInterval(function () {
  if (token && !document.hidden && navigator.onLine && syEl("dashboard").style.display === "block") loadMatches();
}, 60000);
window.addEventListener("online", function () { if (token) loadMatches(); });
