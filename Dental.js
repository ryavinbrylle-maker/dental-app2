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
                  "Root Fragment", "Impacted", "Crowded", "Temporary Filled"];
// Conditions that can be COMBINED on one tooth (e.g. Sealant + Decayed).
// "Sound" = checked and healthy, so it replaces the others.
const CONDITIONS = STATUSES.filter(function (c) { return c !== "Sound"; });
const COND_COLOR = { Decayed: "#e5483f", Missing: "#6b7280", Filled: "#4a8af4", Fractured: "#f07c12", Sealant: "#43b97f",
                     "Root Fragment": "#8b5a2b", Impacted: "#7c3aed", Crowded: "#0e9fb3", "Temporary Filled": "#a5c8ff" };
const COND_ABBR = { Decayed: "D", Missing: "M", Filled: "F", Fractured: "Fx", Sealant: "S",
                    "Root Fragment": "RF", Impacted: "Im", Crowded: "Cr", "Temporary Filled": "TF" };
function condClass(c) { return String(c).replace(/\s+/g, ""); }   // "Root Fragment" -> "RootFragment"
const TAP_DOUBLE_MS = 300;  // 2nd press within this time = double-tap
const TAP_MOVE_PX = 10;     // finger moved more than this = not a plain tap

// One tooth record -> { conditions: [...], note }.
// Reads the new format ({conditions}) and old saved records ({status}).
function toothInfo(t) {
  if (!t) return null;
  let list = Array.isArray(t.conditions) ? t.conditions : (t.status ? [t.status] : []);
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
        if (tapState.timer && tapState.tooth === n) b.classList.add("pending");
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
//   • tap                         -> Sound (after a short wait, in case a 2nd tap comes)
//   • double-tap                  -> Decayed (the 2nd tap cancels the waiting Sound)
//   • press + slide across teeth  -> every tooth touched becomes Sound
//   • double-tap, keep the finger/mouse button down and slide -> every tooth touched becomes Decayed
//   • with a condition chosen above ("marking mode"): tap toggles it, slide adds it
// Teeth that already have problems are never turned back to Sound by a tap or a slide.
let tapState = { tooth: null, timer: null, time: 0 };
let gest = null;   // the press/drag in progress

function examMapEl() { return document.getElementById("examMap"); }
function toothAt(x, y) {
  const hit = document.elementFromPoint(x, y);
  const b = hit && hit.closest ? hit.closest("#examMap [data-tooth]") : null;
  return b ? b.dataset.tooth : null;
}
function toothBtn(n) { return document.querySelector('#examMap [data-tooth="' + n + '"]'); }

function flushPendingTap() {
  if (!tapState.timer) return;
  clearTimeout(tapState.timer);
  const n = tapState.tooth;
  tapState = { tooth: null, timer: null, time: 0 };
  tapTooth(n);
}
function cancelPendingTap() {
  if (tapState.timer) clearTimeout(tapState.timer);
  tapState = { tooth: null, timer: null, time: 0 };
}

function paintTooth(n) {
  if (!gest || gest.painted.has(n)) return;
  gest.painted.add(n);
  const info = toothInfo(form.teeth[n]);
  if (gest.mode === "decayed") addCondition(n, "Decayed");
  else if (gest.mode === "brush") addCondition(n, form.brush);
  else if (!problemsOf(info).length) addCondition(n, "Sound");   // never wipe existing problems
  else gest.skipped.push(n);
  const b = toothBtn(n);
  if (b) {
    decorateTooth(b, n, toothInfo(form.teeth[n]), { selectable: true });
    b.classList.add("painted");
  }
  const what = gest.mode === "decayed" ? "Decayed" : gest.mode === "brush" ? form.brush : "Sound";
  document.getElementById("paintHint").textContent = "Marking " + what + ": " + gest.painted.size + " teeth";
}

function endGesture(cancelled) {
  const g = gest;
  gest = null;
  examMapEl().classList.remove("painting");
  if (!g) return;
  if (g.painting) {
    const what = g.mode === "decayed" ? "Decayed" : g.mode === "brush" ? form.brush : "Sound";
    form.selected = g.startTooth;
    renderExam();
    document.getElementById("paintHint").textContent = "✓ " + (g.painted.size - g.skipped.length) + " teeth marked " + what +
      (g.skipped.length ? " · kept " + g.skipped.join(", ") + " (already had a problem)" : "");
    return;
  }
  if (cancelled) return;
  if (g.moved) return;                       // finger slid inside one tooth: not a tap
  const n = g.startTooth;
  if (g.mode === "brush") { tapTooth(n); return; }
  if (g.mode === "decayed") {                // plain double-tap (Decayed already applied on the 2nd press)
    saveToothNote(); form.selected = n; form.changed = n; renderExam();
    document.getElementById("paintHint").textContent = "✓ Tooth " + n + " marked Decayed";
    return;
  }
  // single tap: wait briefly in case it becomes a double-tap
  tapState = { tooth: n, time: Date.now(), timer: setTimeout(function () {
    tapState = { tooth: null, timer: null, time: 0 };
    tapTooth(n);
  }, TAP_DOUBLE_MS) };
  const b = toothBtn(n);
  if (b) b.classList.add("pending");         // instant feedback while waiting
}

function setupExamMapGestures() {
  const map = examMapEl();
  map.addEventListener("pointerdown", function (e) {
    const b = e.target.closest("[data-tooth]");
    if (!b || !form) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const n = b.dataset.tooth;
    const now = Date.now();
    let mode = "sound";
    if (form.brush) {
      mode = "brush";
      flushPendingTap();
    } else if (tapState.timer && tapState.tooth === n && now - tapState.time <= TAP_DOUBLE_MS) {
      mode = "decayed";                       // 2nd press of a double-tap
      cancelPendingTap();
    } else {
      flushPendingTap();                      // finish a waiting tap on another tooth first
    }
    saveToothNote();
    gest = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, startTooth: n, mode: mode,
             painting: false, moved: false, painted: new Set(), skipped: [] };
    if (mode === "decayed") {
      // Decayed right away (visible feedback); sliding from here adds more Decayed teeth
      gest.painted.add(n);
      addCondition(n, "Decayed");
      decorateTooth(b, n, toothInfo(form.teeth[n]), { selectable: true });
      b.classList.add("painted");
      document.getElementById("paintHint").textContent = "Decayed – keep holding and slide to mark more teeth";
    }
    if (e.pointerType === "mouse") e.preventDefault();   // no text selection while dragging
  });
  // After a double-tap the page must not scroll or zoom while the finger slides
  map.addEventListener("touchstart", function (e) {
    if (gest && gest.mode === "decayed") e.preventDefault();
  }, { passive: false });
  document.addEventListener("touchmove", function (e) {
    if (gest && (gest.painting || gest.mode === "decayed")) e.preventDefault();
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

function openRecord(student, returnView) {
  recordReturnView = returnView || "dashboard";
  currentStudent = student;
  visits = [];
  fillStudentHeader();
  fillEditForm();
  renderRecord();
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
   ["Medications", text(s.medications)],
   ["Weight", s.weight_kg ? s.weight_kg + " kg" : "—"]].forEach(function (pair) {
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

function renderVisitList() {
  const list = document.getElementById("visitList");
  list.innerHTML = "";
  if (!visits.length) {
    list.appendChild(el("p", "muted", "No examinations yet. Tap “Add Visit” after the check-up."));
    return;
  }
  const tl = el("div", "timeline");
  visits.forEach(function (v) {
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
  document.getElementById("visitError").textContent = "";
  document.getElementById("visitSaved").textContent = "";
  document.getElementById("paintHint").textContent = "";
  document.getElementById("visitAbsent").style.display = appt ? "inline-block" : "none";
  document.getElementById("visitAbsent").dataset.confirm = "";
  document.getElementById("visitAbsent").textContent = "✗ Absent";
  document.getElementById("visitSave").textContent = appt ? "✓ Save & complete appointment" : "Save examination";
  renderExamStudent();
  renderExam();
  show("visitForm");
  loadPreviousRecords(visit);
}

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
    const c = el("button", "chip" + (form.brush === st ? " brush b-" + condClass(st) : ""), st);
    c.type = "button";
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
    ? "Tap = Sound · Double-tap = Decayed · Hold and slide to mark several teeth · Tap a marked tooth to edit it."
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
  } else if (!problemsOf(toothInfo(form.teeth[n])).length) {
    addCondition(n, "Sound");
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
function saveVisit() {
  flushPendingTap();
  saveToothNote();
  const btn = document.getElementById("visitSave");
  const errBox = document.getElementById("visitError");
  errBox.textContent = "";
  const teeth = normalizeTeeth(form.teeth);
  const notes = document.getElementById("examNotes").value.trim();
  const appt = form.appointment;

  if (!editingVisit && !Object.keys(teeth).length && !form.confirmEmpty) {
    form.confirmEmpty = true;
    errBox.textContent = "No teeth are marked. Tap save again to save anyway.";
    return;
  }
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Saving...";
  const student = currentStudent;
  let job;
  if (editingVisit) {
    job = StudentStorageInfo.updateVisit(editingVisit, { teeth: teeth, exam_notes: notes }, student)
      .then(function (v) { return { visit: v }; });
  } else {
    job = StudentStorageInfo.createVisit(student, { visit_date: form.date, teeth: teeth, exam_notes: notes })
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
    errBox.textContent = "Could not save: " + err.message;
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
