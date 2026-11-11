// Student dental record + Dental Examination page (Record Tooth-Map Exam).
// Uses from Students.js: token, readJson, text, studentInfoGrid, showToast, studentCode, API_URL, loadStudents
// Uses StudentStorageInfo.js for saving (on this device first, then uploaded).

const VISITS_URL = "/api/visits";

// FDI tooth numbers, laid out like the mouth (patient's right on the left)
const TEETH = {
  Permanent: [
    [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
    [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]
  ],
  Primary: [
    [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
    [85, 84, 83, 82, 81, 71, 72, 73, 74, 75]
  ]
};
// On phones each row is split at the midline (no sideways scrolling, so sliding a
// finger across teeth can't be confused with scrolling the row).
const QUADRANT_NAMES = { Permanent: ["Upper right", "Upper left", "Lower right", "Lower left"],
                         Primary: ["Upper right", "Upper left", "Lower right", "Lower left"] };
const narrowScreen = window.matchMedia("(max-width: 700px)");

const STATUSES = ["Sound", "Decayed", "Missing", "Filled", "Fractured", "Sealant",
                  "Root Fragment", "Impacted", "Crowned", "Temporary Filled", "Unerupted"];
// Older records may say "Crowded" – that condition was renamed "Crowned" (Oct 2026)
const RENAMED = { "Crowded": "Crowned" };
// Conditions that can be COMBINED on one tooth (e.g. Sealant + Decayed).
// "Sound" = checked and healthy, so it replaces the others.
const CONDITIONS = STATUSES.filter(function (c) { return c !== "Sound"; });
const COND_COLOR = { Decayed: "#e5483f", Missing: "#6b7280", Filled: "#4a8af4", Fractured: "#f07c12", Sealant: "#43b97f",
                     "Root Fragment": "#8b5a2b", Impacted: "#7c3aed", Crowned: "#c9a227", "Temporary Filled": "#a5c8ff",
                     Unerupted: "#cbd5e1" };
const COND_ABBR = { Decayed: "D", Missing: "M", Filled: "F", Fractured: "Fx", Sealant: "S",
                    "Root Fragment": "RF", Impacted: "Im", Crowned: "Cr", "Temporary Filled": "TF", Unerupted: "U" };
function condClass(c) { return String(c).replace(/\s+/g, ""); }   // "Root Fragment" -> "RootFragment"
const TAP_DOUBLE_MS = 300;  // 2nd press within this time = double-tap
const TAP_MOVE_PX = 10;     // finger moved more than this = not a plain tap

// One tooth record -> { conditions: [...], note }.
// Reads the new format ({conditions}) and old saved records ({status}).
function toothInfo(t) {
  if (!t) return null;
  let list = Array.isArray(t.conditions) ? t.conditions : (t.status ? [t.status] : []);
  list = list.map(function (c) { return RENAMED[c] || c; });
  list = STATUSES.filter(function (c) { return list.includes(c); }); // valid, no duplicates, fixed order
  if (list.length > 1) list = list.filter(function (c) { return c !== "Sound"; });
  const note = t.note || "";
  if (!list.length && note) list = ["Sound"];
  return list.length ? { conditions: list, note: note } : null;
}
function normalizeTeeth(teeth) {
  const out = {};
  Object.keys(teeth || {}).forEach(function (k) {
    const i = toothInfo(teeth[k]);
    if (i) out[k] = i;
  });
  return out;
}
function problemsCount(teeth) {
  return Object.keys(teeth).filter(function (k) { return problemsOf(teeth[k]).length; }).length;
}
function problemsOf(info) {
  return info ? info.conditions.filter(function (c) { return c !== "Sound"; }) : [];
}

let currentStudent = null;
let visits = [];          // examinations of the open student (all school years)
let editingVisit = null;
let form = null;          // { teeth:{}, dentition, selected, brush, changed, appointment }
let recordReturnView = "dashboard"; // where "back" goes from a student record
let visitReturnView = "record";     // where "back"/"cancel" goes from the examination page
let afterVisitSave = null;          // hook (Appointments.js): called after saving
let examAbsentHandler = null;       // hook (Appointments.js): Absent button on the exam page

const views = {
  dashboard: document.getElementById("dashboard"),
  record: document.getElementById("record"),
  visitForm: document.getElementById("visitForm"),
  appointments: document.getElementById("appointments"),
  schoolYears: document.getElementById("schoolYears")
};
// keepScroll: return to a page without jumping to the top (the page restores its own position)
function show(name, keepScroll) {
  Object.keys(views).forEach(function (k) { if (views[k]) views[k].style.display = k === name ? "block" : "none"; });
  if (!keepScroll) window.scrollTo(0, 0);
  // highlight the current page in the main navigation
  const area = name === "appointments" ? "appointments"
             : name === "schoolYears" ? "schoolyears"
             : name === "visitForm" ? (visitReturnView === "appointments" ? "appointments" : "students")
             : name === "record" ? (recordReturnView === "appointments" ? "appointments" : "students")
             : "students";
  document.querySelectorAll(".app-nav .nav-item").forEach(function (b) {
    const on = b.dataset.nav === area;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
}

// ---------- small helpers ----------
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
// Dates without time-zone shifting
function dateOnly(v) { return StudentStorageInfo.dateOnly(v); }
function niceDate(v) {
  const iso = dateOnly(v);
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return m + "/" + d + "/" + y;
}
function longDateText(v) {
  const iso = dateOnly(v);
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
function todayIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function api(url, options) {
  options = options || {};
  options.headers = Object.assign({ "Authorization": "Bearer " + token }, options.headers || {});
  return fetch(url, options).then(readJson);
}
function handleAuthError(err) {
  if (err.status === 401) { logout(err.message); return true; }
  return false;
}
function syncBadge(rec) {
  if (!rec || !rec._sync || rec._sync === "synced") return null;
  const label = { pending: "Saved on this device – waiting to upload", failed: "Upload failed – see status",
                  conflict: "Conflict – see status" }[rec._sync] || rec._sync;
  return el("span", "sbadge " + (rec._sync === "pending" ? "local" : rec._sync), label);
}

// ---------- tooth map ----------
function mapRows(dentition) {
  const rows = TEETH[dentition];
  if (!narrowScreen.matches) return rows.map(function (r) { return { teeth: r }; });
  const out = [];
  rows.forEach(function (r, i) {
    const half = r.length / 2;
    out.push({ teeth: r.slice(0, half), label: QUADRANT_NAMES[dentition][i * 2] });
    out.push({ teeth: r.slice(half), label: QUADRANT_NAMES[dentition][i * 2 + 1] });
  });
  return out;
}

// Draw (or redraw in place) one tooth button
function decorateTooth(b, n, info, opts) {
  const probs = problemsOf(info);
  b.className = "tooth" + (opts.mini ? " mini" : "") + (opts.selectable ? "" : " static") + (b.dataset.gap ? " gap" : "");
  b.style.background = "";
  b.innerHTML = "";
  b.appendChild(el("span", "num", n));
  if (probs.length === 1) {
    b.classList.add("s-" + condClass(probs[0]));
    b.appendChild(el("small", "", COND_ABBR[probs[0]] && probs[0].length > 9 ? COND_ABBR[probs[0]] : probs[0]));
  } else if (probs.length > 1) {
    // Several conditions: colour stripes + short codes (e.g. "D+S")
    b.classList.add("multi");
    const step = 100 / probs.length;
    b.style.background = "linear-gradient(135deg," + probs.map(function (c, k) {
      return COND_COLOR[c] + " " + (k * step) + "% " + ((k + 1) * step) + "%";
    }).join(",") + ")";
    b.appendChild(el("small", "", probs.map(function (c) { return COND_ABBR[c]; }).join("+")));
    b.appendChild(el("span", "count-dot", String(probs.length)));
  } else if (info) {
    b.classList.add("s-Sound");
    b.appendChild(el("small", "", "Sound"));
  }
  const label = "Tooth " + n + ": " + (info ? info.conditions.join(", ") : "not recorded") +
                (info && info.note ? " – " + info.note : "");
  b.title = label;
  b.setAttribute("aria-label", label);
}

// teeth: { "28": {conditions:[...], note} }
// opts: { dentition | rows, mini, selectable, selected, changed }
function toothMap(teeth, opts) {
  const wrap = el("div");
  const rows = opts.rows ? opts.rows.map(function (r) { return { teeth: r }; }) : mapRows(opts.dentition);
  rows.forEach(function (row) {
    if (row.label && !opts.mini) wrap.appendChild(el("div", "quad-label", row.label));
    const r = el("div", "teeth-row");
    row.teeth.forEach(function (num, i) {
      const n = String(num);
      const b = el("button");
      b.type = "button";
      b.dataset.tooth = n;
      if (!row.label && i === row.teeth.length / 2) b.dataset.gap = "1";   // midline gap (wide screens)
      decorateTooth(b, n, toothInfo(teeth[n]), opts);
      if (opts.selectable) {
        if (opts.selected === n) b.classList.add("selected");
        if (opts.changed === n) b.classList.add("changed");
      } else {
        b.tabIndex = -1;
      }
      r.appendChild(b);
    });
    wrap.appendChild(r);
  });
  return wrap;
}

// ---------- tap, double-tap and drag on the examination tooth map ----------
// ONE code path for touch and mouse (pointer events):
//   • tap (single click)              -> Decayed, straight away (no waiting)
//   • double-tap (double click)       -> UNDO: the tooth goes back to unmarked
//                                        (the 2nd tap clears it, so a double-tap never marks twice)
//   • press + slide across teeth      -> every tooth touched becomes Decayed
//   • double-tap, keep holding, slide -> every tooth touched is cleared (unmarked)
//   • with a condition chosen in the colour key ("marking mode"): tap toggles it, slide adds it
// Teeth left unmarked are saved as "Sound" when a NEW examination is saved (saveVisit).
// Undo only changes this unsaved examination – saved examinations are never touched.
let tapState = { tooth: null, time: 0 };   // last single tap (to recognise a double-tap)
let gest = null;   // the press/drag in progress

function examMapEl() { return document.getElementById("examMap"); }
function toothAt(x, y) {
  const hit = document.elementFromPoint(x, y);
  const b = hit && hit.closest ? hit.closest("#examMap [data-tooth]") : null;
  return b ? b.dataset.tooth : null;
}
function toothBtn(n) { return document.querySelector('#examMap [data-tooth="' + n + '"]'); }

// (kept for the rest of the page: nothing waits any more, a tap acts immediately)
function flushPendingTap() { /* nothing pending */ }
function cancelPendingTap() { tapState = { tooth: null, time: 0 }; }

const GEST_LABEL = { decayed: "Decayed", undo: "cleared (unmarked)" };
function gestLabel(g) { return g.mode === "brush" ? form.brush : GEST_LABEL[g.mode]; }

function paintTooth(n) {
  if (!gest || gest.painted.has(n)) return;
  gest.painted.add(n);
  if (gest.mode === "decayed") addCondition(n, "Decayed");
  else if (gest.mode === "brush") addCondition(n, form.brush);
  else if (gest.mode === "undo") clearTooth(n);
  const b = toothBtn(n);
  if (b) {
    decorateTooth(b, n, toothInfo(form.teeth[n]), { selectable: true });
    b.classList.add("painted");
  }
  document.getElementById("paintHint").textContent =
    (gest.mode === "undo" ? "Clearing: " : "Marking " + gestLabel(gest) + ": ") + gest.painted.size + " teeth";
}

function endGesture(cancelled) {
  const g = gest;
  gest = null;
  examMapEl().classList.remove("painting");
  if (!g) return;
  const hint = document.getElementById("paintHint");
  if (g.painting) {
    cancelPendingTap();
    form.selected = g.mode === "undo" ? null : g.startTooth;
    renderExam();
    hint.textContent = "✓ " + g.painted.size + " teeth " + (g.mode === "undo" ? "cleared" : "marked " + gestLabel(g));
    return;
  }
  if (cancelled || g.moved) return;          // scrolled, or the finger slid inside one tooth: not a tap
  const n = g.startTooth;
  saveToothNote();
  if (g.mode === "brush") { cancelPendingTap(); tapTooth(n); return; }
  if (g.mode === "undo") {                   // 2nd tap of a double-tap: back to unmarked
    cancelPendingTap();
    clearTooth(n);
    form.selected = null; form.changed = n;
    renderExam();
    hint.textContent = "↺ Tooth " + n + " cleared – unmarked (it will be saved as Sound unless you mark it)";
    return;
  }
  // single tap: Decayed right away; a 2nd tap soon after undoes it
  addCondition(n, "Decayed");
  tapState = { tooth: n, time: Date.now() };
  form.selected = n; form.changed = n;
  renderExam();
  hint.textContent = "Tooth " + n + " marked Decayed · double-tap to undo";
}

function setupExamMapGestures() {
  const map = examMapEl();
  map.addEventListener("pointerdown", function (e) {
    const b = e.target.closest("[data-tooth]");
    if (!b || !form) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const n = b.dataset.tooth;
    const now = Date.now();
    let mode = "decayed";
    if (form.brush) mode = "brush";
    else if (tapState.tooth === n && now - tapState.time <= TAP_DOUBLE_MS) mode = "undo";   // 2nd press of a double-tap
    else cancelPendingTap();
    saveToothNote();
    gest = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, startTooth: n, mode: mode,
             painting: false, moved: false, painted: new Set() };
    if (e.pointerType === "mouse") e.preventDefault();   // no text selection while dragging
  });
  // After a double-tap (undo) the page must not scroll or zoom while the finger slides
  map.addEventListener("touchstart", function (e) {
    if (gest && gest.mode === "undo") e.preventDefault();
  }, { passive: false });
  document.addEventListener("touchmove", function (e) {
    if (gest && (gest.painting || gest.mode === "undo")) e.preventDefault();
  }, { passive: false });

  document.addEventListener("pointermove", function (e) {
    if (!gest || e.pointerId !== gest.id) return;
    if (Math.hypot(e.clientX - gest.x, e.clientY - gest.y) > TAP_MOVE_PX) gest.moved = true;
    const n = toothAt(e.clientX, e.clientY);
    if (!gest.painting) {
      if (n && n !== gest.startTooth) {        // slid onto another tooth: start marking
        gest.painting = true;
        examMapEl().classList.add("painting");
        paintTooth(gest.startTooth);
        paintTooth(n);
      }
      return;
    }
    if (n) paintTooth(n);
  });
  document.addEventListener("pointerup", function (e) {
    if (gest && e.pointerId === gest.id) endGesture(false);
  });
  document.addEventListener("pointercancel", function (e) {
    if (gest && e.pointerId === gest.id) endGesture(true);   // browser took over (scrolling)
  });
  // clicks/double-clicks are handled above; stop the browser's own (zoom, focus jumps)
  map.addEventListener("click", function (e) { if (e.target.closest("[data-tooth]")) e.preventDefault(); });
  map.addEventListener("dblclick", function (e) { e.preventDefault(); });
  // Keyboard: Enter/Space opens the tooth's condition panel
  map.addEventListener("keydown", function (e) {
    const b = e.target.closest("[data-tooth]");
    if (b && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault(); saveToothNote(); form.selected = b.dataset.tooth; form.changed = null; renderExam();
    }
  });
  // Re-layout when the phone is rotated / window resized across the breakpoint
  narrowScreen.addEventListener("change", function () {
    if (form && views.visitForm.style.display === "block") renderExam();
    if (currentStudent && views.record.style.display === "block") renderRecord();
  });
}

function hasAny(teeth, dentition) {
  return TEETH[dentition].some(function (row) {
    return row.some(function (n) { return teeth[String(n)]; });
  });
}

// ---------- student record ----------
function recordSubtitle(s) {
  const place = [s.grade, s.section].filter(Boolean).join(" – ");
  return [s.name, place, studentCode(s)].filter(Boolean).join(" · ");
}

function openRecord(student, returnView, keepNav) {
  recordReturnView = returnView || "dashboard";
  if (!keepNav) recordNav = null;
  currentStudent = student;
  visits = [];
  fillStudentHeader();
  fillEditForm();
  renderRecord();
  renderRecordNav();
  show("record");
  loadVisits();
  if (typeof loadApptHistory === "function") loadApptHistory(); // Appointments.js
}

function fillStudentHeader() {
  document.getElementById("recordName").textContent = recordSubtitle(currentStudent);
  const info = document.getElementById("studentInfo");
  info.innerHTML = "";
  info.appendChild(studentInfoGrid(currentStudent));
}

// ---------- edit class / student code, remove student (needs internet) ----------
// Grades and sections/strands come from SchoolClasses.js (the school's own list)
const GRADE_OPTIONS = GRADE_LIST;

function fillSelect(id, options, value) {
  const sel = document.getElementById(id);
  sel.innerHTML = "";
  const all = options.slice();
  if (value && !all.includes(value)) all.push(value); // keep unusual existing values
  if (!value) {
    const o = el("option", "", "Choose"); o.value = ""; o.disabled = true; o.selected = true;
    sel.appendChild(o);
  }
  all.forEach(function (v) {
    const o = el("option", "", v); o.value = v;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  });
}

function fillEditForm() {
  const s = currentStudent;
  document.getElementById("editName").value = s.name || "";
  fillSelect("editGrade", GRADE_OPTIONS, s.grade);
  fillSelect("editSection", sectionsFor(s.grade), s.section);
  document.getElementById("editGender").value = s.code_gender || (s.sex === "Female" ? "F" : "M");
  document.getElementById("editNumber").value = s.code_number || "";
  document.getElementById("editError").textContent = "";
  const del = document.getElementById("deleteStudentBtn");
  del.dataset.confirm = ""; del.textContent = "Remove from roster";
  updateEditPreview();
}

function updateEditPreview() {
  const g = document.getElementById("editGender").value;
  const raw = document.getElementById("editNumber").value.trim();
  const ok = /^[0-9]+$/.test(raw) && parseInt(raw, 10) >= 1 && parseInt(raw, 10) <= 999;
  document.getElementById("editPreview").textContent =
    "Student code: " + (ok ? g + "-" + parseInt(raw, 10) : "— (enter a number from 1 to 999)");
}

function needsInternet(errBox) {
  if (navigator.onLine) return false;
  errBox.textContent = "This change needs internet. Examinations and appointments still work offline.";
  return true;
}

function saveStudent() {
  const err = document.getElementById("editError");
  err.textContent = "";
  if (needsInternet(err)) return;
  const body = {
    name: document.getElementById("editName").value.trim(),
    grade: document.getElementById("editGrade").value,
    section: document.getElementById("editSection").value,
    codeGender: document.getElementById("editGender").value,
    codeNumber: document.getElementById("editNumber").value.trim()
  };
  if (!body.name) { err.textContent = "Please enter the student's name."; return; }
  if (!body.grade || !body.section) { err.textContent = "Please choose the grade and section."; return; }
  if (!/^[0-9]+$/.test(body.codeNumber) || +body.codeNumber < 1 || +body.codeNumber > 999) {
    err.textContent = "The code number must be a whole number from 1 to 999."; return;
  }
  const btn = document.getElementById("saveStudentBtn");
  btn.disabled = true; btn.textContent = "Saving...";
  api(API_URL + "?id=" + currentStudent.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function (data) {
      currentStudent = data.student;
      fillStudentHeader();
      fillEditForm();
      renderRecord();
      showToast("Saved: " + recordSubtitle(currentStudent));
      return loadStudents(true);
    })
    .catch(function (e) { if (!handleAuthError(e)) err.textContent = e.message; })
    .finally(function () { btn.disabled = false; btn.textContent = "Save changes"; });
}

// Removing a student only takes them off this year's roster; their dental history is kept.
function deleteStudent() {
  const del = document.getElementById("deleteStudentBtn");
  const err = document.getElementById("editError");
  if (needsInternet(err)) return;
  if (del.dataset.confirm !== "1") {
    del.dataset.confirm = "1";
    del.textContent = "Tap again to remove " + (currentStudent.name || "student") + " from the roster";
    setTimeout(function () { del.dataset.confirm = ""; del.textContent = "Remove from roster"; }, 5000);
    return;
  }
  const name = currentStudent.name;
  api(API_URL + "?id=" + currentStudent.id, { method: "DELETE" })
    .then(function () {
      showToast(name + " was removed from the roster (dental history kept)");
      currentStudent = null;
      show("dashboard");
      return loadStudents(true);
    })
    .catch(function (e) { if (!handleAuthError(e)) err.textContent = e.message; });
}

// All examinations of this student (every school year): server copy + this device, no duplicates
function historyIds(s) {
  return { identity: s.identity_id || null, ids: [s.id] };
}
function fetchHistory(student) {
  if (!navigator.onLine) return Promise.resolve(false);
  return Promise.all([
    api(VISITS_URL + "?student_id=" + encodeURIComponent(student.id)),
    api("/api/appointments?student_id=" + encodeURIComponent(student.id))
  ]).then(function (r) {
    return Promise.all([StudentStorageInfo.cacheVisits(r[0].visits || []),
                        StudentStorageInfo.cacheAppointments(r[1].appointments || [])]).then(function () { return true; });
  }).catch(function (err) { if (!handleAuthError(err)) console.warn("history download failed", err); return false; });
}
function readHistory(student) {
  const h = historyIds(student);
  return StudentStorageInfo.getHistory(h.identity, h.ids);
}

function loadVisits() {
  const s = currentStudent;
  document.getElementById("visitList").innerHTML = '<p class="muted">Loading examinations...</p>';
  const draw = function () {
    return readHistory(s).then(function (h) {
      if (currentStudent !== s) return;
      visits = h.visits;
      renderRecord();
    });
  };
  return draw().then(function () { return fetchHistory(s); }).then(function (got) { if (got) return draw(); });
}

function renderRecord() {
  const s = currentStudent;
  const medical = [].concat(s.conditions || [], s.other_conditions ? [s.other_conditions] : []);
  const hasAlert = Boolean(s.allergies || medical.length || s.medications);
  const box = el("div", "condition" + (hasAlert ? " alert" : ""));
  box.appendChild(el("h4", "", hasAlert ? "⚠ Medical condition" : "Medical condition"));
  [["Allergy", text(s.allergies)],
   ["Medical history", medical.length ? medical.join(", ") : "—"],
   ["Medications", text(s.medications)]]
    .concat(s.weight_kg ? [["Weight", s.weight_kg + " kg"]] : [])      // older records only
    .forEach(function (pair) {
    const p = el("p");
    p.appendChild(el("b", "", pair[0] + ": "));
    p.appendChild(document.createTextNode(pair[1]));
    box.appendChild(p);
  });
  const cBox = document.getElementById("conditionBox");
  cBox.innerHTML = ""; cBox.appendChild(box);

  // Current tooth map = all examinations combined, newest result wins
  const current = {};
  visits.slice().reverse().forEach(function (v) { Object.assign(current, normalizeTeeth(v.teeth)); });
  const mapBox = document.getElementById("currentMap");
  mapBox.innerHTML = "";
  let shown = false;
  ["Permanent", "Primary"].forEach(function (d) {
    if (!hasAny(current, d)) return;
    shown = true;
    mapBox.appendChild(el("p", "", d)).style.cssText = "font-weight:700;font-size:14px;margin:4px 0 6px";
    const sc = el("div", "teeth-scroll");
    sc.appendChild(toothMap(current, { dentition: d }));
    mapBox.appendChild(sc);
  });
  if (!shown) mapBox.appendChild(el("p", "muted", "No examinations recorded yet."));

  const dm = document.getElementById("dmftBox");
  dm.innerHTML = "";
  if (visits.length) {
    const v = visits[0];
    const c = dmftCounts(normalizeTeeth(v.teeth));
    const grid = el("div", "dmft");
    [["D (decayed)", c.d], ["M (missing)", c.m], ["F (filled)", c.f], ["Total DMFT", c.d + c.m + c.f]].forEach(function (pair) {
      const p = el("div");
      p.appendChild(el("span", "muted", pair[0] + ": "));
      p.appendChild(el("b", "", String(pair[1] || 0)));
      grid.appendChild(p);
    });
    dm.appendChild(grid);
  } else {
    dm.appendChild(el("p", "muted", "—"));
  }
  renderVisitList();
}

// Same DMFT rule as the server: each tooth once, Missing > Decayed (incl. root fragment,
// temporary filling) > Filled
function dmftCounts(teeth) {
  const c = { d: 0, m: 0, f: 0 };
  Object.values(teeth).forEach(function (t) {
    const l = t.conditions;
    if (l.includes("Missing")) c.m++;
    else if (l.includes("Decayed") || l.includes("Root Fragment") || l.includes("Temporary Filled")) c.d++;
    else if (l.includes("Filled")) c.f++;
  });
  return c;
}

// The findings of one examination (used on the record page and as "previous records")
function examDetails(item, v) {
  if ((v.symptoms && v.symptoms.length) || v.chief_complaint) {      // older records only
    item.appendChild(el("h5", "", "Chief complaint"));
    if (v.symptoms && v.symptoms.length) item.appendChild(el("p", "", v.symptoms.join(", ")));
    if (v.chief_complaint) item.appendChild(el("p", "muted", v.chief_complaint));
  }
  const teeth = normalizeTeeth(v.teeth);
  CONDITIONS.forEach(function (st) {
    const nums = Object.keys(teeth).filter(function (n) { return teeth[n].conditions.includes(st); }).sort();
    if (!nums.length) return;
    item.appendChild(el("h5", "", st + " (" + nums.length + ")"));
    const row = el("div", "teeth-row");
    nums.forEach(function (n) {
      const t = el("button", "tooth mini static s-" + condClass(st));
      t.type = "button"; t.tabIndex = -1;
      t.appendChild(document.createTextNode(n));
      if (teeth[n].note) t.title = teeth[n].note;
      row.appendChild(t);
    });
    item.appendChild(row);
  });
  Object.keys(teeth).filter(function (n) { return problemsOf(teeth[n]).length > 1; }).sort().forEach(function (n) {
    item.appendChild(el("p", "muted", "Tooth " + n + ": " + teeth[n].conditions.join(" + ")));
  });
  const soundCount = Object.keys(teeth).filter(function (n) { return teeth[n].conditions[0] === "Sound"; }).length;
  if (soundCount) item.appendChild(el("p", "muted", "Checked sound: " + soundCount + " teeth"));
  if (!Object.keys(teeth).length) item.appendChild(el("p", "muted", "No teeth marked."));
  Object.keys(teeth).sort().forEach(function (n) {
    if (teeth[n].note) item.appendChild(el("p", "muted", "Note, tooth " + n + ": " + teeth[n].note));
  });
  if (v.exam_notes) {
    item.appendChild(el("h5", "", "Dentist notes"));
    item.appendChild(el("p", "", v.exam_notes));
  }
}

function classLabel(v) {
  return [v.school_year ? "SY " + v.school_year : "", [v.grade, v.section].filter(Boolean).join(" – ")]
    .filter(Boolean).join(" · ");
}

// History order (newest first by default; remembered on this device)
let histOrder = (function () { try { return localStorage.getItem("histOrder") || "newest"; } catch (e) { return "newest"; } })();
function renderHistOrder() {
  const box = document.getElementById("histOrder");
  box.innerHTML = "";
  [["newest", "Newest first"], ["oldest", "Oldest first"]].forEach(function (o) {
    const c = el("button", "chip" + (histOrder === o[0] ? " on" : ""), o[1]);
    c.type = "button"; c.setAttribute("aria-pressed", histOrder === o[0] ? "true" : "false");
    c.addEventListener("click", function () {
      histOrder = o[0];
      try { localStorage.setItem("histOrder", histOrder); } catch (e) { /* fine */ }
      renderVisitList();
    });
    box.appendChild(c);
  });
}
function examsInDateOrder() {
  return visits.slice().sort(function (a, b) {
    return String(dateOnly(a.visit_date)).localeCompare(String(dateOnly(b.visit_date))) || (a.id || 0) - (b.id || 0);
  });
}

function renderVisitList() {
  const list = document.getElementById("visitList");
  list.innerHTML = "";
  renderHistOrder();
  renderCompare();
  if (!visits.length) {
    list.appendChild(el("p", "muted", "No examinations yet. Tap “Add examination” after the check-up."));
    return;
  }
  const tl = el("div", "timeline");
  const ordered = histOrder === "oldest" ? examsInDateOrder() : examsInDateOrder().reverse();
  let lastGroup = null;
  ordered.forEach(function (v) {
    // a heading for every school year (with the class the student was in that year)
    const group = (v.school_year || "") + "|" + (v.grade || "") + "|" + (v.section || "");
    if (group !== lastGroup) {
      lastGroup = group;
      const h = el("div", "sy-head", v.school_year ? "School year " + v.school_year : "School year not recorded");
      const cls = [v.grade, v.section].filter(Boolean).join(" – ");
      if (cls) h.appendChild(el("span", "", "  ·  " + cls));
      tl.appendChild(h);
    }
    const item = el("div", "visit");
    const top = el("div", "visit-top");
    const when = el("div", "when");
    when.appendChild(el("b", "", niceDate(v.visit_date)));
    const cls = classLabel(v);
    if (cls) when.appendChild(el("span", "muted", "  " + cls));
    if (v.created_by) when.appendChild(el("span", "muted", "  by " + v.created_by));
    const badge = syncBadge(v);
    if (badge) { when.appendChild(document.createTextNode(" ")); when.appendChild(badge); }
    top.appendChild(when);

    const actions = el("div");
    const edit = el("button", "mini-btn", "Edit"); edit.type = "button";
    edit.addEventListener("click", function () {
      visitReturnView = "record"; afterVisitSave = null; examAbsentHandler = null;
      openVisitForm(v, {});
    });
    actions.appendChild(edit);
    if (v.id) {
      const del = el("button", "mini-btn danger", "Delete"); del.type = "button";
      del.style.marginLeft = "6px";
      del.addEventListener("click", function () {
        if (!navigator.onLine) { showToast("Deleting an examination needs internet."); return; }
        if (del.dataset.confirm !== "1") {
          del.dataset.confirm = "1"; del.textContent = "Tap again to delete";
          setTimeout(function () { del.dataset.confirm = ""; del.textContent = "Delete"; }, 4000);
          return;
        }
        deleteVisit(v);
      });
      actions.appendChild(del);
    }
    top.appendChild(actions);
    item.appendChild(top);
    examDetails(item, v);
    tl.appendChild(item);
  });
  list.appendChild(tl);
}

function deleteVisit(v) {
  api(VISITS_URL + "?id=" + v.id, { method: "DELETE" })
    .then(function () {
      return StudentStorageInfo.removeLocal("visits", v.uid);
    })
    .then(function () { showToast("Examination deleted"); return loadVisits(); })
    .catch(function (err) { if (!handleAuthError(err)) showToast(err.message); });
}

// ---------- compare two examinations (e.g. last school year vs this school year) ----------
function examLabel(v) {
  return niceDate(v.visit_date) + " · SY " + (v.school_year || "?") + " · " + ([v.grade, v.section].filter(Boolean).join(" – ") || "—");
}
let cmpPick = { a: null, b: null, student: null, latest: null };
function renderCompare() {
  const card = document.getElementById("compareCard");
  const exams = examsInDateOrder();
  if (exams.length < 2) { card.hidden = true; return; }
  card.hidden = false;
  const key = function (v) { return v.uid || ("srv-" + v.id); };
  const latest = exams[exams.length - 1];
  if (cmpPick.student !== currentStudent || cmpPick.latest !== key(latest) || !exams.some(function (v) { return key(v) === cmpPick.a; }) ||
      !exams.some(function (v) { return key(v) === cmpPick.b; })) {
    // default: the latest exam vs the latest exam of an EARLIER school year (else the one before it)
    const older = exams.slice(0, -1).reverse();
    const prevYear = older.find(function (v) { return v.school_year && v.school_year !== latest.school_year; });
    cmpPick = { a: key(prevYear || older[0]), b: key(latest), student: currentStudent, latest: key(latest) };
  }
  ["cmpA", "cmpB"].forEach(function (id, i) {
    const sel = document.getElementById(id);
    sel.innerHTML = "";
    exams.forEach(function (v) {
      const o = el("option", "", examLabel(v)); o.value = key(v);
      if (key(v) === (i ? cmpPick.b : cmpPick.a)) o.selected = true;
      sel.appendChild(o);
    });
  });
  const A = exams.find(function (v) { return key(v) === cmpPick.a; });
  const B = exams.find(function (v) { return key(v) === cmpPick.b; });
  const ta = normalizeTeeth(A.teeth), tb = normalizeTeeth(B.teeth);
  const nums = Array.from(new Set(Object.keys(ta).concat(Object.keys(tb)))).sort();
  const changed = nums.filter(function (n) {
    return JSON.stringify((ta[n] || { conditions: [] }).conditions) !== JSON.stringify((tb[n] || { conditions: [] }).conditions);
  });
  const body = document.getElementById("cmpBody");
  body.innerHTML = "";
  const grid = el("div", "cmp-grid");
  [[A, ta], [B, tb]].forEach(function (pair) {
    const v = pair[0], t = pair[1];
    const col = el("div", "cmp-col");
    col.appendChild(el("h4", "", niceDate(v.visit_date)));
    col.appendChild(el("p", "muted", "SY " + (v.school_year || "?") + " · " + ([v.grade, v.section].filter(Boolean).join(" – ") || "—")));
    ["Permanent", "Primary"].forEach(function (d) {
      if (!hasAny(t, d)) return;
      const sc = el("div", "teeth-scroll");
      const map = toothMap(t, { dentition: d, mini: true });
      changed.forEach(function (n) { const b = map.querySelector('[data-tooth="' + n + '"]'); if (b) b.classList.add("cmp-changed"); });
      sc.appendChild(map);
      col.appendChild(sc);
    });
    const c = dmftCounts(t);
    col.appendChild(el("p", "cmp-dmft", "DMFT " + (c.d + c.m + c.f) + "  (D " + c.d + " · M " + c.m + " · F " + c.f + ")"));
    grid.appendChild(col);
  });
  body.appendChild(grid);
  const ca = dmftCounts(ta), cb = dmftCounts(tb);
  const diff = (cb.d + cb.m + cb.f) - (ca.d + ca.m + ca.f);
  body.appendChild(el("p", "cmp-summary", changed.length
    ? changed.length + (changed.length === 1 ? " tooth" : " teeth") + " changed (outlined in orange) · DMFT " + (diff > 0 ? "up by " + diff : diff < 0 ? "down by " + (-diff) : "unchanged")
    : "No differences between these two examinations."));
  if (changed.length) {
    const wrap = el("div", "table-wrap cmp-table");
    const table = el("table");
    const head = el("tr");
    ["Tooth", niceDate(A.visit_date), niceDate(B.visit_date)].forEach(function (h) { head.appendChild(el("th", "", h)); });
    const thead = el("thead"); thead.appendChild(head); table.appendChild(thead);
    const tbody = el("tbody");
    changed.forEach(function (n) {
      const tr = el("tr");
      tr.appendChild(el("td", "", n));
      tr.appendChild(el("td", "", ta[n] ? ta[n].conditions.join(" + ") : "not recorded"));
      tr.appendChild(el("td", "", tb[n] ? tb[n].conditions.join(" + ") : "not recorded"));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table);
    // the list can be long: hidden until the dentist asks for it (choice remembered on this device)
    let open = false;
    try { open = localStorage.getItem("cmpList") === "open"; } catch (e) {}
    const btn = el("button", "mini-btn cmp-toggle"); btn.type = "button";
    const show = function () {
      wrap.hidden = !open;
      btn.textContent = open ? "▲ Hide tooth-by-tooth list" : "▼ Show tooth-by-tooth list (" + changed.length + ")";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    btn.addEventListener("click", function () {
      open = !open;
      try { localStorage.setItem("cmpList", open ? "open" : "closed"); } catch (e) {}
      show();
    });
    show();
    body.appendChild(btn); body.appendChild(wrap);
  }
}
document.getElementById("cmpA").addEventListener("change", function () { cmpPick.a = this.value; renderCompare(); });
document.getElementById("cmpB").addEventListener("change", function () { cmpPick.b = this.value; renderCompare(); });

// ---------- previous / next student (in the list the record was opened from) ----------
let recordNav = null;     // { list: [students], index }
function openRecordFrom(student, list) {
  recordNav = list && list.length > 1 ? { list: list.slice(), index: Math.max(0, list.indexOf(student)) } : null;
  openRecord(student, "dashboard", true);
}
function renderRecordNav() {
  const box = document.getElementById("recNav");
  if (!recordNav || recordNav.list[recordNav.index] !== currentStudent) { box.hidden = true; return; }
  box.hidden = false;
  document.getElementById("recPos").textContent = (recordNav.index + 1) + " of " + recordNav.list.length;
  document.getElementById("recPrev").disabled = recordNav.index === 0;
  document.getElementById("recNext").disabled = recordNav.index === recordNav.list.length - 1;
}
function stepRecord(delta) {
  if (!recordNav) return;
  const i = recordNav.index + delta;
  if (i < 0 || i >= recordNav.list.length) return;
  recordNav.index = i;
  if (typeof rememberDashboardStudent === "function") rememberDashboardStudent(recordNav.list[i]);   // Students.js
  openRecord(recordNav.list[i], recordReturnView, true);
}
document.getElementById("recPrev").addEventListener("click", function () { stepRecord(-1); });
document.getElementById("recNext").addEventListener("click", function () { stepRecord(1); });

// ---------- printable dental record (DentalRecordPDF.js) ----------
let pdfUrl = null;
function showRecordPdf(student, examsPromise, schoolYear) {
  const dlg = document.getElementById("pdfDialog");
  const status = document.getElementById("pdfStatus");
  const dl = document.getElementById("pdfDownload"), open = document.getElementById("pdfOpen");
  dlg.hidden = false;
  dl.hidden = true; open.hidden = true;
  status.textContent = "Preparing the dental record of " + (student.name || "the student") + "…";
  document.getElementById("pdfClose").focus();
  if (pdfUrl) { URL.revokeObjectURL(pdfUrl); pdfUrl = null; }
  return Promise.resolve(examsPromise).then(function (exams) {
    const bytes = DentalRecordPDF.build({ student: student, exams: exams, schoolYear: schoolYear });
    pdfUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    dl.href = pdfUrl;
    dl.download = DentalRecordPDF.fileName(student);
    dl.hidden = false; open.hidden = false;
    status.textContent = "Ready: " + exams.length + " examination" + (exams.length === 1 ? "" : "s") +
      " included. Download it, or open it to print.";
  }).catch(function (err) {
    console.error(err);
    status.textContent = "Could not make the PDF: " + err.message;
  });
}
document.getElementById("pdfClose").addEventListener("click", function () { document.getElementById("pdfDialog").hidden = true; });
document.getElementById("pdfOpen").addEventListener("click", function () {
  if (!pdfUrl) return;
  const w = window.open(pdfUrl, "_blank");
  if (!w) showToast("Allow pop-ups for this site to open the PDF, or use Download PDF.");
});
document.getElementById("recPdf").addEventListener("click", function () {
  const s = currentStudent;
  if (!s) return;
  // make sure every school year's examinations are on the device first (works offline too)
  const exams = fetchHistory(s).then(function () { return readHistory(s); }).then(function (h) { return h.visits; });
  showRecordPdf(s, exams, (typeof currentSchoolYear !== "undefined" && currentSchoolYear) || s.school_year);
});

// ---------- Dental Examination page (Record Tooth-Map Exam) ----------
// opts.appointment: the appointment being examined (appointment mode: Save & complete / Absent)
function openVisitForm(visit, opts) {
  opts = opts || {};
  cancelPendingTap();
  gest = null;
  editingVisit = visit || null;
  const teeth = normalizeTeeth(JSON.parse(JSON.stringify((visit && visit.teeth) || {})));

  // Start on Primary if the exam only has primary teeth, or for young students with no teeth recorded
  let dentition = "Permanent";
  if (hasAny(teeth, "Primary") && !hasAny(teeth, "Permanent")) dentition = "Primary";
  else if (!Object.keys(teeth).length && Number(currentStudent.age) > 0 && Number(currentStudent.age) < 6) dentition = "Primary";

  form = { teeth: teeth, dentition: dentition, selected: null, brush: null, changed: null,
           appointment: opts.appointment || null, confirmEmpty: false,
           date: visit ? dateOnly(visit.visit_date) : (opts.appointment ? opts.appointment._date || dateOnly(opts.appointment.appointment_date) : todayIso()) };

  const appt = form.appointment;
  document.getElementById("visitTitle").textContent = visit ? "Edit Examination" : "Dental Examination";
  document.getElementById("visitName").textContent = recordSubtitle(currentStudent);
  document.getElementById("exToday").textContent = "· " + longDateText(form.date);
  document.getElementById("examNotes").value = (visit && visit.exam_notes) || "";
  if (typeof renderQuickNotes === "function") renderQuickNotes();
  document.getElementById("visitError").textContent = "";
  document.getElementById("visitSaved").textContent = "";
  document.getElementById("paintHint").textContent = "";
  document.getElementById("visitAbsent").style.display = appt ? "inline-block" : "none";
  document.getElementById("visitAbsent").dataset.confirm = "";
  document.getElementById("visitAbsent").textContent = "✗ Absent";
  document.getElementById("visitSave").textContent = appt ? "✓ Save & complete appointment" : "Save examination";
  renderExamStudent();
  renderExam();
  form.initial = examSnapshot();                 // to warn before leaving with unsaved changes
  form.saving = false;
  show("visitForm");
  loadPreviousRecords(visit);
}

// ---------- unsaved changes ----------
function examSnapshot() {
  return JSON.stringify([normalizeTeeth(form.teeth), document.getElementById("examNotes").value.trim()]);
}
function isExamDirty() {
  if (!form || form.saving || views.visitForm.style.display !== "block") return false;
  flushPendingTap();
  saveToothNote();
  return examSnapshot() !== form.initial;
}
// "Discard this examination?" – asked before any way of leaving the exam page with unsaved work
function askDiscard(onDiscard) {
  const dlg = document.getElementById("leaveDialog");
  dlg.hidden = false;
  document.getElementById("leaveStay").focus();
  const close = function () { dlg.hidden = true; go.removeEventListener("click", yes); stay.removeEventListener("click", close); };
  const go = document.getElementById("leaveGo"), stay = document.getElementById("leaveStay");
  const yes = function () { close(); onDiscard(); };
  go.addEventListener("click", yes);
  stay.addEventListener("click", close);
}
function resetExamHooks() {
  cancelPendingTap();
  visitReturnView = "record"; afterVisitSave = null; examAbsentHandler = null;
  if (form) form.initial = examSnapshot();
}
// navigation bar: guard the exam page
let leaveConfirmed = false;
document.querySelector(".app-nav").addEventListener("click", function (e) {
  const b = e.target.closest(".nav-item");
  if (!b || leaveConfirmed || !isExamDirty()) return;
  e.stopPropagation(); e.preventDefault();
  askDiscard(function () { resetExamHooks(); leaveConfirmed = true; b.click(); leaveConfirmed = false; });
}, true);
document.getElementById("navStudents").addEventListener("click", function () {
  if (views.visitForm.style.display === "block") resetExamHooks();
  show("dashboard");
});
// closing the tab / reloading with unsaved exam work
window.addEventListener("beforeunload", function (e) {
  if (isExamDirty()) { e.preventDefault(); e.returnValue = ""; }
});

function renderExamStudent() {
  const s = currentStudent, appt = form.appointment;
  const box = document.getElementById("exStudent");
  box.innerHTML = "";
  const who = el("div", "ap-who");
  who.appendChild(el("span", "code-badge " + (s.code_gender || "none"), studentCode(s) || "—"));
  who.appendChild(el("h3", "", s.name || "—"));
  box.appendChild(who);
  const meta = el("div", "ap-meta");
  const rows = [["Grade", s.grade || "—"], ["Section", s.section || "—"], ["Date", longDateText(form.date)]];
  if (appt) {
    rows.push(["Status", appt.status === "Late Arrival"
      ? "🕒 Late arrival" + (appt.arrived_at ? " – arrived " + new Date(appt.arrived_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "")
      : "⏳ Waiting – now being seen"]);
  }
  if (s.school_year) rows.push(["School year", s.school_year]);
  rows.forEach(function (p) {
    const d = el("div");
    d.appendChild(el("span", "muted", p[0] + ": "));
    d.appendChild(el("b", "", p[1]));
    meta.appendChild(d);
  });
  box.appendChild(meta);
  const medical = [].concat(s.conditions || [], s.other_conditions ? [s.other_conditions] : []);
  const alerts = [];
  if (s.allergies) alerts.push("Allergy: " + s.allergies);
  if (medical.length) alerts.push("Medical: " + medical.join(", "));
  if (s.medications) alerts.push("Medication: " + s.medications);
  if (alerts.length) box.appendChild(el("div", "ap-alert", "⚠ " + alerts.join(" · ")));
}

// Previous examinations + absences, separate from the one being recorded now
function loadPreviousRecords(current) {
  const s = currentStudent;
  const box = document.getElementById("prevRecords");
  box.innerHTML = '<p class="muted">Loading previous records...</p>';
  const draw = function () {
    return readHistory(s).then(function (h) {
      if (currentStudent !== s || views.visitForm.style.display !== "block") return;
      const exams = h.visits.filter(function (v) { return !current || v.uid !== current.uid; });
      const absences = h.appointments.filter(function (a) {
        return a.status === "Absent" && !(form.appointment && a.uid === form.appointment.uid);
      });
      const items = exams.map(function (v) { return { kind: "exam", date: v._date, v: v }; })
        .concat(absences.map(function (a) { return { kind: "absent", date: a._date, a: a }; }))
        .sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); });
      document.getElementById("prevCount").textContent = exams.length + " exam(s) · " + absences.length + " absence(s)";
      box.innerHTML = "";
      if (!items.length) {
        box.appendChild(el("p", "muted", "No previous dental records – this is the first examination."));
        return;
      }
      items.forEach(function (it, i) {
        const card = el("div", "prev-item" + (it.kind === "absent" ? " absent" : ""));
        if (it.kind === "absent") {
          card.appendChild(el("h4", "", longDateText(it.date) + " · ABSENT"));
          card.appendChild(el("p", "muted", classLabel(it.a)));
          box.appendChild(card);
          return;
        }
        const v = it.v;
        const head = el("h4", "", longDateText(v._date) + (i === 0 ? "  (most recent)" : ""));
        const badge = syncBadge(v);
        if (badge) { head.appendChild(document.createTextNode(" ")); head.appendChild(badge); }
        card.appendChild(head);
        card.appendChild(el("p", "muted", classLabel(v)));
        const teeth = normalizeTeeth(v.teeth);
        if (Object.keys(teeth).length) {
          ["Permanent", "Primary"].forEach(function (d) {
            if (!hasAny(teeth, d)) return;
            const sc = el("div", "teeth-scroll");
            sc.appendChild(toothMap(teeth, { dentition: d, mini: true }));
            card.appendChild(sc);
          });
        }
        examDetails(card, v);
        box.appendChild(card);
      });
    });
  };
  draw().then(function () { return fetchHistory(s); }).then(function (got) { if (got) return draw(); });
}

function renderExam() {
  document.getElementById("segPermanent").classList.toggle("on", form.dentition === "Permanent");
  document.getElementById("segPrimary").classList.toggle("on", form.dentition === "Primary");

  // Optional "marking mode": choose a condition, then tap or slide across many teeth
  const chips = document.getElementById("statusChips");
  chips.innerHTML = "";
  STATUSES.forEach(function (st) {
    const c = el("button", "chip" + (form.brush === st ? " brush b-" + condClass(st) : ""));
    c.type = "button";
    // colour swatch + abbreviation = the chart's legend
    const dot = el("span", "dot" + (st === "Sound" ? " sound" : ""));
    dot.style.background = st === "Sound" ? "#eaf7ee" : COND_COLOR[st];
    dot.setAttribute("aria-hidden", "true");
    c.appendChild(dot);
    c.appendChild(document.createTextNode(st + (COND_ABBR[st] ? " (" + COND_ABBR[st] + ")" : "")));
    c.setAttribute("aria-pressed", form.brush === st ? "true" : "false");
    c.title = form.brush === st ? "Marking mode on – tap again to stop" : "Mark many teeth as " + st;
    const n = Object.values(form.teeth).filter(function (t) { return t.conditions.includes(st); }).length;
    if (n && st !== "Sound") c.appendChild(el("span", "cnt", "(" + n + ")"));
    c.addEventListener("click", function () {
      flushPendingTap();
      form.brush = form.brush === st ? null : st;
      renderExam();
    });
    chips.appendChild(c);
  });

  document.getElementById("brushHint").textContent = !form.brush
    ? "Tap = Decayed · Double-tap = undo (unmarked) · Slide across teeth to mark several Decayed · Teeth you don't mark are saved as Sound."
    : form.brush === "Sound"
      ? "Marking mode: tap or slide across teeth to mark them Sound (clears other conditions). Tap “Sound” again to stop."
      : "Marking mode: tap teeth to add " + form.brush + " (tap again to remove), or slide across teeth to add it. Tap “" + form.brush + "” again to stop.";

  const mapBox = examMapEl();
  mapBox.innerHTML = "";
  mapBox.appendChild(toothMap(form.teeth, {
    dentition: form.dentition,
    selectable: true,
    selected: form.selected,
    changed: form.changed
  }));
  form.changed = null; // the "just changed" flash plays once
  renderToothPanel();
  renderAutoSoundHint();
}

// ----- tooth condition edits (never mutually exclusive, except Sound) -----
function addCondition(n, c) {
  const i = toothInfo(form.teeth[n]) || { conditions: [], note: "" };
  const list = c === "Sound" ? ["Sound"]
             : i.conditions.filter(function (x) { return x !== "Sound"; }).concat([c]);
  form.teeth[n] = toothInfo({ conditions: list, note: i.note });
  form.confirmEmpty = false;
}
function removeCondition(n, c) {
  const i = toothInfo(form.teeth[n]);
  if (!i) return;
  const list = i.conditions.filter(function (x) { return x !== c; });
  const next = toothInfo({ conditions: list, note: i.note });
  if (next) form.teeth[n] = next; else delete form.teeth[n];
}
function clearTooth(n) { delete form.teeth[n]; }

// Single tap: Sound for an unmarked tooth. A tooth that already has problems is only
// selected (so a stray tap can't wipe Decayed/Sealant etc.). In marking mode: toggle.
function tapTooth(n) {
  if (!form) return;
  saveToothNote();
  form.selected = n;
  form.changed = n;
  if (form.brush) {
    const has = (toothInfo(form.teeth[n]) || { conditions: [] }).conditions.includes(form.brush);
    if (form.brush === "Sound") { if (has) clearTooth(n); else addCondition(n, "Sound"); }
    else if (has) removeCondition(n, form.brush);
    else addCondition(n, form.brush);
  } else {
    addCondition(n, "Decayed");
  }
  renderExam();
}

// Panel to inspect / edit every condition of the selected tooth
function renderToothPanel() {
  const panel = document.getElementById("toothPanel");
  const n = form.selected;
  if (!n) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  document.getElementById("selTooth").textContent = n;
  document.getElementById("selTooth2").textContent = n;
  const info = toothInfo(form.teeth[n]);

  const have = document.getElementById("toothConds");
  have.innerHTML = "";
  if (!info) have.appendChild(el("span", "muted", "Not recorded yet"));
  (info ? info.conditions : []).forEach(function (c) {
    const chip = el("button", "chip cond-chip brush b-" + condClass(c), c + "  ✕");
    chip.type = "button";
    chip.title = "Remove " + c + " from tooth " + n;
    chip.addEventListener("click", function () { removeCondition(n, c); form.changed = n; renderExam(); });
    have.appendChild(chip);
  });

  const add = document.getElementById("toothAdd");
  add.innerHTML = "";
  STATUSES.forEach(function (c) {
    if (info && info.conditions.includes(c)) return;
    const chip = el("button", "chip", "+ " + c);
    chip.type = "button";
    chip.title = c === "Sound" ? "Mark healthy (removes the other conditions)" : "Add " + c + " to tooth " + n;
    chip.addEventListener("click", function () { addCondition(n, c); form.changed = n; renderExam(); });
    add.appendChild(chip);
  });

  document.getElementById("toothNote").value = info ? info.note : "";
  document.getElementById("clearTooth").style.display = info ? "inline-block" : "none";
}

// Keep the note typed for the selected tooth
function saveToothNote() {
  if (!form || !form.selected) return;
  const note = document.getElementById("toothNote").value.trim();
  const i = toothInfo(form.teeth[form.selected]);
  if (i) { i.note = note; form.teeth[form.selected] = i; }
  else if (note) form.teeth[form.selected] = { conditions: ["Sound"], note: note };
}

// Save: on this device FIRST (instant, works offline), then uploaded automatically.
// ---------- automatic "Sound" for teeth that were not marked ----------
// Applies only when a NEW examination is saved. The dentition(s) that were examined are
// completed: every tooth of that chart without a condition is saved as "Sound". Teeth that
// already have a condition keep it. Saved (older) examinations are never changed by this.
function examinedDentitions(teeth) {
  const used = ["Permanent", "Primary"].filter(function (d) { return hasAny(teeth, d); });
  return used.length ? used : [form.dentition];
}
function unmarkedTeeth(teeth) {
  const out = [];
  examinedDentitions(teeth).forEach(function (d) {
    TEETH[d].forEach(function (row) {
      row.forEach(function (num) { if (!teeth[String(num)]) out.push(String(num)); });
    });
  });
  return out;
}
function withAutoSound(teeth) {
  const full = JSON.parse(JSON.stringify(teeth));
  unmarkedTeeth(teeth).forEach(function (n) { full[n] = { conditions: ["Sound"], note: "" }; });
  return full;
}
function renderAutoSoundHint() {
  const box = document.getElementById("autoSoundHint");
  if (!box || !form) return;
  if (editingVisit) { box.textContent = ""; return; }
  const n = unmarkedTeeth(normalizeTeeth(form.teeth)).length;
  box.textContent = n ? (n === 1 ? "1 tooth is" : n + " teeth are") + " not marked – saved as Sound when you save." : "";
}

function saveVisit() {
  flushPendingTap();
  saveToothNote();
  const btn = document.getElementById("visitSave");
  const errBox = document.getElementById("visitError");
  errBox.textContent = "";
  const teeth = normalizeTeeth(form.teeth);
  const notes = document.getElementById("examNotes").value.trim();
  const appt = form.appointment;

  if (!editingVisit && !problemsCount(teeth) && !form.confirmEmpty) {
    form.confirmEmpty = true;
    const n = unmarkedTeeth(teeth).length;
    errBox.textContent = "No problems marked – " + (n ? "all " + n + " unmarked teeth will be saved as Sound. " : "") +
                         "Tap save again to confirm.";
    return;
  }
  if (form.saving) return;                 // already saving: ignore a double tap
  form.saving = true;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Saving...";
  const student = currentStudent;
  let job;
  if (editingVisit) {
    job = StudentStorageInfo.updateVisit(editingVisit, { teeth: teeth, exam_notes: notes }, student)
      .then(function (v) { return { visit: v }; });
  } else {
    job = StudentStorageInfo.createVisit(student, { visit_date: form.date, teeth: withAutoSound(teeth), exam_notes: notes })
      .then(function (v) {
        if (!appt) return { visit: v };
        return StudentStorageInfo.changeAppointment(appt, { status: "Completed", notes: notes, visit_uid: v.client_uid },
          { label: "Completed (examination)" })
          .then(function (a) { return { visit: v, appointment: a }; });
      });
  }
  job.then(function (res) {
    const where = navigator.onLine ? "uploading now" : "will upload when online";
    showToast("✓ Saved on this device – " + where);
    document.getElementById("visitSaved").textContent = "✓ Saved on this device – " + where;
    if (afterVisitSave) {               // e.g. back to the appointment list
      const hook = afterVisitSave; afterVisitSave = null; examAbsentHandler = null;
      hook(res.visit, res.appointment);
      return;
    }
    show("record");
    return loadVisits();
  }).catch(function (err) {
    form.saving = false;
    errBox.textContent = "Could not save: " + err.message + " Nothing was lost – try again.";
  }).finally(function () { btn.disabled = false; btn.textContent = label; });
}

function examAbsent() {
  if (!form || !form.appointment || !examAbsentHandler) return;
  const b = document.getElementById("visitAbsent");
  const marked = Object.keys(normalizeTeeth(form.teeth)).length;
  if (marked && b.dataset.confirm !== "1") {
    b.dataset.confirm = "1";
    b.textContent = "Tap again: absent (marked teeth are NOT saved)";
    setTimeout(function () { b.dataset.confirm = ""; b.textContent = "✗ Absent"; }, 4000);
    return;
  }
  cancelPendingTap();
  form.saving = true;                      // leaving on purpose: no "unsaved changes" question
  const fn = examAbsentHandler;
  examAbsentHandler = null; afterVisitSave = null;
  fn(form.appointment, document.getElementById("examNotes").value.trim());
}

// ---------- events ----------
setupExamMapGestures();
document.getElementById("saveStudentBtn").addEventListener("click", saveStudent);
document.getElementById("deleteStudentBtn").addEventListener("click", deleteStudent);
document.getElementById("editGender").addEventListener("change", updateEditPreview);
document.getElementById("editNumber").addEventListener("input", updateEditPreview);
document.getElementById("recordBack").addEventListener("click", function () {
  if (recordReturnView === "appointments" && typeof returnToList === "function") { returnToList(); return; }
  show(recordReturnView);
});
document.getElementById("addVisitBtn").addEventListener("click", function () {
  visitReturnView = "record"; afterVisitSave = null; examAbsentHandler = null; openVisitForm(null, {});
});
function leaveVisitForm() {
  if (isExamDirty()) { askDiscard(doLeaveVisitForm); return; }
  doLeaveVisitForm();
}
function doLeaveVisitForm() {
  cancelPendingTap();
  const back = visitReturnView;
  visitReturnView = "record"; afterVisitSave = null; examAbsentHandler = null;
  if (back === "appointments" && typeof returnToList === "function") { returnToList(); return; }
  show(back);
}
document.getElementById("visitBack").addEventListener("click", leaveVisitForm);
document.getElementById("visitCancel").addEventListener("click", leaveVisitForm);
document.getElementById("visitSave").addEventListener("click", saveVisit);
document.getElementById("visitAbsent").addEventListener("click", examAbsent);
document.getElementById("clearTooth").addEventListener("click", function () {
  if (!form || !form.selected) return;
  clearTooth(form.selected); form.changed = form.selected; renderExam();
});
document.getElementById("segPermanent").addEventListener("click", function () {
  flushPendingTap(); saveToothNote(); form.dentition = "Permanent"; form.selected = null; renderExam();
});
document.getElementById("segPrimary").addEventListener("click", function () {
  flushPendingTap(); saveToothNote(); form.dentition = "Primary"; form.selected = null; renderExam();
});
document.getElementById("toothNote").addEventListener("input", saveToothNote);

// Changing the grade shows only that grade's sections / strands
document.getElementById("editGrade").addEventListener("change", function () {
  const keep = document.getElementById("editSection").value;
  const secs = sectionsFor(this.value);
  fillSelect("editSection", secs, secs.includes(keep) ? keep : "");
});

// ---------- quick notes for the dentist ----------
// "Presence of Calculus" / "With Orthodontic Appliance" each go on their own line of the notes.
// "Upper" / "Lower" add the arch to the last quick note: "Presence of Calculus – Upper & Lower".
const QN_ARCH = /\s+–\s+(Upper & Lower|Upper|Lower)$/;
function qnLines() {
  return document.getElementById("examNotes").value.split("\n");
}
function qnWrite(lines) {
  const box = document.getElementById("examNotes");
  box.value = lines.join("\n").replace(/^\n+|\n+$/g, "");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  renderQuickNotes();
}
function qnFindLine(lines, note) {
  for (let i = 0; i < lines.length; i++) if (lines[i].replace(QN_ARCH, "").trim() === note) return i;
  return -1;
}
function qnLastNoteLine(lines) {
  const notes = Array.from(document.querySelectorAll("#quickNotes [data-note]")).map(function (b) { return b.dataset.note; });
  for (let i = lines.length - 1; i >= 0; i--) if (notes.indexOf(lines[i].replace(QN_ARCH, "").trim()) >= 0) return i;
  return -1;
}
function qnArches(line) {
  const m = line.match(QN_ARCH);
  return m ? (m[1] === "Upper & Lower" ? ["Upper", "Lower"] : [m[1]]) : [];
}
function toggleQuickNote(note) {
  const lines = qnLines();
  const i = qnFindLine(lines, note);
  if (i >= 0) lines.splice(i, 1);                      // tap again = remove
  else lines.push(note);
  qnWrite(lines);
}
function toggleArch(arch) {
  const lines = qnLines();
  const i = qnLastNoteLine(lines);
  if (i < 0) { showHint("Tap Presence of Calculus or With Orthodontic Appliance first, then " + arch + "."); return; }
  const base = lines[i].replace(QN_ARCH, "").trim();
  let arches = qnArches(lines[i]);
  arches = arches.indexOf(arch) >= 0 ? arches.filter(function (a) { return a !== arch; }) : arches.concat(arch);
  arches.sort(function (a, b) { return a === "Upper" ? -1 : b === "Upper" ? 1 : 0; });
  lines[i] = base + (arches.length ? " – " + arches.join(" & ") : "");
  qnWrite(lines);
}
function showHint(text) {
  const h = document.querySelector(".qn-hint");
  if (!h) return;
  h.textContent = text; h.classList.add("warn");
  clearTimeout(showHint.t);
  showHint.t = setTimeout(function () {
    h.textContent = "Tap a quick note to add it, then Upper / Lower for the arch. Tap again to remove."; h.classList.remove("warn");
  }, 4000);
}
function renderQuickNotes() {
  const box = document.getElementById("quickNotes");
  if (!box) return;
  const lines = qnLines();
  const last = qnLastNoteLine(lines);
  const arches = last >= 0 ? qnArches(lines[last]) : [];
  box.querySelectorAll("[data-note]").forEach(function (b) {
    const on = qnFindLine(lines, b.dataset.note) >= 0;
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  box.querySelectorAll("[data-arch]").forEach(function (b) {
    const on = arches.indexOf(b.dataset.arch) >= 0;
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
if (document.getElementById("quickNotes")) {
  document.getElementById("quickNotes").addEventListener("click", function (e) {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.note) toggleQuickNote(b.dataset.note);
    else if (b.dataset.arch) toggleArch(b.dataset.arch);
  });
  document.getElementById("examNotes").addEventListener("input", renderQuickNotes);
}
