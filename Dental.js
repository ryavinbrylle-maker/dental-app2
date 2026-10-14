// Student dental record + check-up (visit) entry with a tooth map.
// Uses `token`, `readJson`, `text`, `studentInfoGrid` and `showToast` from Students.js.

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
const STATUSES = ["Sound", "Decayed", "Missing", "Filled", "Fractured", "Sealant"];
// Conditions that can be COMBINED on one tooth (e.g. Sealant + Decayed).
// "Sound" = checked and healthy, so it replaces the others.
const CONDITIONS = ["Decayed", "Missing", "Filled", "Fractured", "Sealant"];
const COND_COLOR = { Decayed: "#e5483f", Missing: "#6b7280", Filled: "#4a8af4", Fractured: "#f07c12", Sealant: "#43b97f" };
const COND_ABBR = { Decayed: "D", Missing: "M", Filled: "F", Fractured: "Fx", Sealant: "S" };
const TAP_DOUBLE_MS = 300;  // 2nd tap within this time = double-tap
const TAP_MOVE_PX = 10;     // finger moved more than this = scrolling, not a tap

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
const DEFAULT_SYMPTOMS = ["Pain", "Swelling", "Bleeding", "Sensitivity"];

let currentStudent = null;
let visits = [];
let editingVisit = null;
let form = null; // { symptoms:Set, extraSymptoms:[], teeth:{}, dentition, selected }
let recordReturnView = "dashboard"; // where "back" goes from a student record
let visitReturnView = "record";     // where "back"/"cancel" goes from the visit form
let afterVisitSave = null;          // optional hook (used by Appointments.js)

const views = {
  dashboard: document.getElementById("dashboard"),
  record: document.getElementById("record"),
  visitForm: document.getElementById("visitForm"),
  appointments: document.getElementById("appointments")
};
function show(name) {
  Object.keys(views).forEach(function (k) { views[k].style.display = k === name ? "block" : "none"; });
  window.scrollTo(0, 0);
}

// ---------- small helpers ----------
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
// Visit dates are plain dates (no time), so show them without time-zone shifting
function dateOnly(v) {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
}
function niceDate(v) {
  const iso = dateOnly(v);
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return m + "/" + d + "/" + y;
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

// ---------- tooth map ----------
// teeth: { "28": {conditions:[...], note} }
// opts: { rows, mini, selectable, selected, changed, onTap(n), onDouble(n), onKey(n), instant() }
function toothMap(teeth, opts) {
  const wrap = el("div");
  opts.rows.forEach(function (row) {
    const r = el("div", "teeth-row");
    row.forEach(function (num, i) {
      const n = String(num);
      const info = toothInfo(teeth[n]);
      const probs = problemsOf(info);
      const b = el("button", "tooth" + (opts.mini ? " mini" : "") + (opts.selectable ? "" : " static"));
      b.type = "button";
      b.dataset.tooth = n;
      if (i === row.length / 2) b.classList.add("gap"); // small gap at the midline
      b.appendChild(el("span", "num", n));

      if (probs.length === 1) {
        b.classList.add("s-" + probs[0]);
        b.appendChild(el("small", "", probs[0]));
      } else if (probs.length > 1) {
        // Several conditions: split the tile into colour stripes + short codes (e.g. "D+S")
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

      if (opts.selectable) {
        if (opts.selected === n) b.classList.add("selected");
        if (opts.changed === n) b.classList.add("changed");
        if (tapState.timer && tapState.tooth === n) b.classList.add("pending");
        attachToothTap(b, n, opts);
      } else {
        b.tabIndex = -1;
      }
      r.appendChild(b);
    });
    wrap.appendChild(r);
  });
  return wrap;
}

// Touch + mouse handling with ONE code path (pointer events), so a tap never fires twice.
// - Scrolling/zooming (finger moves, or the browser cancels the pointer) is ignored.
// - Single tap waits TAP_DOUBLE_MS; a second tap on the same tooth in that time is a
//   double-tap and cancels the single-tap action, so it can never overwrite it.
let tapState = { tooth: null, timer: null, time: 0, single: null };

function attachToothTap(b, n, opts) {
  let start = null;
  b.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  b.addEventListener("pointermove", function (e) {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_MOVE_PX) start = null;
  });
  b.addEventListener("pointercancel", function () { start = null; });  // browser is scrolling/zooming
  b.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") start = null; });
  b.addEventListener("pointerup", function (e) {
    if (!start) return;
    const longPress = Date.now() - start.t > 700;
    start = null;
    if (longPress) return;
    e.preventDefault();
    handleToothTap(n, opts);
  });
  // Clicks are handled above; block the extra synthetic click (and dblclick zoom)
  b.addEventListener("click", function (e) { e.preventDefault(); });
  b.addEventListener("dblclick", function (e) { e.preventDefault(); });
  // Keyboard: Enter/Space opens the tooth's condition panel
  b.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (opts.onKey) opts.onKey(n); }
  });
}

function flushPendingTap() {
  if (!tapState.timer) return;
  clearTimeout(tapState.timer);
  const fn = tapState.single, tooth = tapState.tooth;
  tapState = { tooth: null, timer: null, time: 0, single: null };
  fn(tooth);
}

function handleToothTap(n, opts) {
  // Marking mode (a condition chosen above): act instantly, no double-tap wait
  if (opts.instant && opts.instant()) { flushPendingTap(); opts.onTap(n); return; }

  const now = Date.now();
  if (tapState.timer && tapState.tooth === n && now - tapState.time <= TAP_DOUBLE_MS) {
    clearTimeout(tapState.timer);                       // cancel the single-tap action
    tapState = { tooth: null, timer: null, time: 0, single: null };
    opts.onDouble(n);
    return;
  }
  flushPendingTap();                                    // a different tooth: finish the last one now
  tapState = {
    tooth: n, time: now, single: opts.onTap,
    timer: setTimeout(function () {
      const fn = tapState.single, tooth = tapState.tooth;
      tapState = { tooth: null, timer: null, time: 0, single: null };
      fn(tooth);
    }, TAP_DOUBLE_MS)
  };
  // Instant feedback while we wait to see if a 2nd tap comes
  const btn = document.querySelector('#examMap [data-tooth="' + n + '"]');
  if (btn) btn.classList.add("pending");
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

// ---------- edit class / student code, delete student ----------
const GRADE_OPTIONS = ["Kinder", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
const SECTION_OPTIONS = ["Section A", "Section B", "Section C"];

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
  fillSelect("editSection", SECTION_OPTIONS, s.section);
  document.getElementById("editGender").value =
    s.code_gender || (s.sex === "Female" ? "F" : "M");
  document.getElementById("editNumber").value = s.code_number || "";
  document.getElementById("editError").textContent = "";
  const del = document.getElementById("deleteStudentBtn");
  del.dataset.confirm = ""; del.textContent = "Delete student";
  updateEditPreview();
}

function updateEditPreview() {
  const g = document.getElementById("editGender").value;
  const raw = document.getElementById("editNumber").value.trim();
  const ok = /^[0-9]+$/.test(raw) && parseInt(raw, 10) >= 1 && parseInt(raw, 10) <= 999;
  document.getElementById("editPreview").textContent =
    "Student code: " + (ok ? g + "-" + parseInt(raw, 10) : "— (enter a number from 1 to 999)");
}

function saveStudent() {
  const err = document.getElementById("editError");
  err.textContent = "";
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
      return loadStudents(true); // refresh the grouped list
    })
    .catch(function (e) { if (!handleAuthError(e)) err.textContent = e.message; })
    .finally(function () { btn.disabled = false; btn.textContent = "Save changes"; });
}

function deleteStudent() {
  const del = document.getElementById("deleteStudentBtn");
  if (del.dataset.confirm !== "1") {
    del.dataset.confirm = "1";
    del.textContent = "Tap again to delete " + (currentStudent.name || "student") + " and all visits";
    setTimeout(function () { del.dataset.confirm = ""; del.textContent = "Delete student"; }, 5000);
    return;
  }
  const name = currentStudent.name;
  api(API_URL + "?id=" + currentStudent.id, { method: "DELETE" })
    .then(function () {
      showToast(name + " was deleted");
      currentStudent = null;
      show("dashboard");
      return loadStudents(true);
    })
    .catch(function (e) {
      if (!handleAuthError(e)) document.getElementById("editError").textContent = e.message;
    });
}

function loadVisits() {
  document.getElementById("visitList").innerHTML = '<p class="muted">Loading visits...</p>';
  return api(VISITS_URL + "?student_id=" + encodeURIComponent(currentStudent.id))
    .then(function (data) {
      visits = data.visits || [];
      renderRecord();
    })
    .catch(function (err) {
      if (handleAuthError(err)) return;
      document.getElementById("visitList").innerHTML = "";
      document.getElementById("visitList").appendChild(el("p", "error", err.message));
    });
}

function renderRecord() {
  const s = currentStudent;

  // Condition box
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

  // Current tooth map = all visits combined, newest result wins
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
    sc.appendChild(toothMap(current, { rows: TEETH[d] }));
    mapBox.appendChild(sc);
  });
  if (!shown) mapBox.appendChild(el("p", "muted", "No check-ups recorded yet."));

  // DMFT from the latest visit
  const dm = document.getElementById("dmftBox");
  dm.innerHTML = "";
  if (visits.length) {
    const v = visits[0];
    const grid = el("div", "dmft");
    [["D (decayed)", v.decayed], ["M (missing)", v.missing], ["F (filled)", v.filled],
     ["Total DMFT", (v.decayed || 0) + (v.missing || 0) + (v.filled || 0)]].forEach(function (pair) {
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

function renderVisitList() {
  const list = document.getElementById("visitList");
  list.innerHTML = "";
  if (!visits.length) {
    list.appendChild(el("p", "muted", "No visits yet. Tap “Add Visit” after the check-up."));
    return;
  }
  const tl = el("div", "timeline");
  visits.forEach(function (v) {
    const item = el("div", "visit");

    const top = el("div", "visit-top");
    const when = el("div", "when");
    when.appendChild(el("b", "", niceDate(v.visit_date)));
    if (v.created_by) when.appendChild(el("span", "muted", "  by " + v.created_by));
    top.appendChild(when);

    const actions = el("div");
    const edit = el("button", "mini-btn", "Edit"); edit.type = "button";
    edit.addEventListener("click", function () {
      visitReturnView = "record"; afterVisitSave = null; openVisitForm(v);
    });
    const del = el("button", "mini-btn danger", "Delete"); del.type = "button";
    del.style.marginLeft = "6px";
    del.addEventListener("click", function () {
      if (del.dataset.confirm !== "1") {
        del.dataset.confirm = "1"; del.textContent = "Tap again to delete";
        setTimeout(function () { del.dataset.confirm = ""; del.textContent = "Delete"; }, 4000);
        return;
      }
      deleteVisit(v.id);
    });
    actions.appendChild(edit); actions.appendChild(del);
    top.appendChild(actions);
    item.appendChild(top);

    if ((v.symptoms && v.symptoms.length) || v.chief_complaint) {
      item.appendChild(el("h5", "", "Chief complaint"));
      if (v.symptoms && v.symptoms.length) item.appendChild(el("p", "", v.symptoms.join(", ")));
      if (v.chief_complaint) item.appendChild(el("p", "muted", v.chief_complaint));
    }

    // Teeth grouped by condition (a tooth with 2 conditions is listed under both)
    const teeth = normalizeTeeth(v.teeth);
    CONDITIONS.forEach(function (st) {
      const nums = Object.keys(teeth).filter(function (n) { return teeth[n].conditions.includes(st); }).sort();
      if (!nums.length) return;
      item.appendChild(el("h5", "", st + " teeth (" + nums.length + ")"));
      const row = el("div", "teeth-row");
      nums.forEach(function (n) {
        const t = el("button", "tooth mini static s-" + st);
        t.type = "button"; t.tabIndex = -1;
        t.appendChild(document.createTextNode(n));
        if (teeth[n].note) t.title = teeth[n].note;
        row.appendChild(t);
      });
      item.appendChild(row);
    });
    const multi = Object.keys(teeth).filter(function (n) { return problemsOf(teeth[n]).length > 1; }).sort();
    multi.forEach(function (n) {
      item.appendChild(el("p", "muted", "Tooth " + n + ": " + teeth[n].conditions.join(" + ")));
    });
    const soundCount = Object.keys(teeth).filter(function (n) { return teeth[n].conditions[0] === "Sound"; }).length;
    if (soundCount) item.appendChild(el("p", "muted", "Checked sound: " + soundCount + " teeth"));
    Object.keys(teeth).sort().forEach(function (n) {
      if (teeth[n].note) item.appendChild(el("p", "muted", "Note, tooth " + n + ": " + teeth[n].note));
    });

    if (v.exam_notes) {
      item.appendChild(el("h5", "", "Examination notes"));
      item.appendChild(el("p", "", v.exam_notes));
    }
    tl.appendChild(item);
  });
  list.appendChild(tl);
}

function deleteVisit(id) {
  api(VISITS_URL + "?id=" + id, { method: "DELETE" })
    .then(function () { showToast("Visit deleted"); return loadVisits(); })
    .catch(function (err) { if (!handleAuthError(err)) showToast(err.message); });
}

// ---------- visit entry form ----------
function openVisitForm(visit) {
  if (tapState.timer) clearTimeout(tapState.timer);   // drop any half-finished tap
  tapState = { tooth: null, timer: null, time: 0, single: null };
  editingVisit = visit || null;
  const teeth = normalizeTeeth(JSON.parse(JSON.stringify((visit && visit.teeth) || {})));
  const chosen = new Set((visit && visit.symptoms) || []);
  const extra = Array.from(chosen).filter(function (x) { return !DEFAULT_SYMPTOMS.includes(x); });

  // Start on Primary if the visit only has primary teeth, or for young students with no teeth recorded
  let dentition = "Permanent";
  if (hasAny(teeth, "Primary") && !hasAny(teeth, "Permanent")) dentition = "Primary";
  else if (!Object.keys(teeth).length && Number(currentStudent.age) > 0 && Number(currentStudent.age) < 6) dentition = "Primary";

  form = { symptoms: chosen, extraSymptoms: extra, teeth: teeth, dentition: dentition,
           selected: null, brush: null, changed: null };

  document.getElementById("visitTitle").textContent = visit ? "Edit Visit" : "Visit Entry";
  document.getElementById("visitName").textContent = recordSubtitle(currentStudent);
  document.getElementById("visitDate").value = visit ? dateOnly(visit.visit_date) : todayIso();
  document.getElementById("complaint").value = (visit && visit.chief_complaint) || "";
  document.getElementById("examNotes").value = (visit && visit.exam_notes) || "";
  document.getElementById("visitError").textContent = "";
  document.getElementById("addSymptomRow").style.display = "none";

  renderSymptoms();
  renderExam();
  show("visitForm");
}

function renderSymptoms() {
  const box = document.getElementById("symptomChips");
  box.innerHTML = "";
  DEFAULT_SYMPTOMS.concat(form.extraSymptoms).forEach(function (name) {
    const c = el("button", "chip" + (form.symptoms.has(name) ? " on" : ""), name);
    c.type = "button";
    c.addEventListener("click", function () {
      if (form.symptoms.has(name)) form.symptoms.delete(name); else form.symptoms.add(name);
      renderSymptoms();
    });
    box.appendChild(c);
  });
  const add = el("button", "chip add", "+");
  add.type = "button"; add.title = "Add a symptom";
  add.addEventListener("click", function () {
    const row = document.getElementById("addSymptomRow");
    row.style.display = "flex";
    document.getElementById("newSymptom").focus();
  });
  box.appendChild(add);
}

function addSymptom() {
  const input = document.getElementById("newSymptom");
  const name = input.value.trim().slice(0, 40);
  if (name && !DEFAULT_SYMPTOMS.concat(form.extraSymptoms).includes(name)) form.extraSymptoms.push(name);
  if (name) form.symptoms.add(name);
  input.value = "";
  document.getElementById("addSymptomRow").style.display = "none";
  renderSymptoms();
}

function renderExam() {
  document.getElementById("segPermanent").classList.toggle("on", form.dentition === "Permanent");
  document.getElementById("segPrimary").classList.toggle("on", form.dentition === "Primary");

  // Optional "marking mode": choose a condition, then tap many teeth (adds/removes it)
  const chips = document.getElementById("statusChips");
  chips.innerHTML = "";
  STATUSES.forEach(function (st) {
    const c = el("button", "chip" + (form.brush === st ? " brush b-" + st : ""), st);
    c.type = "button";
    const n = Object.values(form.teeth).filter(function (t) { return t.conditions.includes(st); }).length;
    if (n && st !== "Sound") c.appendChild(el("span", "cnt", "(" + n + ")"));
    c.addEventListener("click", function () {
      form.brush = form.brush === st ? null : st;
      renderExam();
    });
    chips.appendChild(c);
  });

  document.getElementById("brushHint").textContent = !form.brush
    ? "Tap = Sound · Double-tap = Decayed · Tap a marked tooth to see or change its conditions."
    : form.brush === "Sound"
      ? "Marking mode: tap teeth to mark them Sound (clears other conditions). Tap “Sound” again to stop."
      : "Marking mode: tap teeth to add " + form.brush + " (tap again to remove it). Tap “" + form.brush + "” again to stop.";

  const mapBox = document.getElementById("examMap");
  mapBox.innerHTML = "";
  mapBox.appendChild(toothMap(form.teeth, {
    rows: TEETH[form.dentition],
    selectable: true,
    selected: form.selected,
    changed: form.changed,
    instant: function () { return Boolean(form.brush); },
    onTap: tapTooth,
    onDouble: doubleTapTooth,
    onKey: function (n) { saveToothNote(); form.selected = n; form.changed = null; renderExam(); }
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
}
function removeCondition(n, c) {
  const i = toothInfo(form.teeth[n]);
  if (!i) return;
  const list = i.conditions.filter(function (x) { return x !== c; });
  const next = toothInfo({ conditions: list, note: i.note });
  if (next) form.teeth[n] = next; else delete form.teeth[n];
}
function clearTooth(n) { delete form.teeth[n]; }

// Single tap: Sound for an unmarked tooth. A tooth that already has conditions is
// only selected (so a stray tap can't wipe Decayed/Sealant etc.).
function tapTooth(n) {
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

// Double tap: add Decayed (keeps any other conditions, e.g. Sealant)
function doubleTapTooth(n) {
  saveToothNote();
  form.selected = n;
  form.changed = n;
  addCondition(n, "Decayed");
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
    const chip = el("button", "chip cond-chip brush b-" + c, c + "  ✕");
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

function saveVisit() {
  flushPendingTap();
  saveToothNote();
  const btn = document.getElementById("visitSave");
  const errBox = document.getElementById("visitError");
  errBox.textContent = "";

  const body = {
    student_id: currentStudent.id,
    visit_date: document.getElementById("visitDate").value,
    symptoms: Array.from(form.symptoms),
    chief_complaint: document.getElementById("complaint").value,
    teeth: normalizeTeeth(form.teeth),
    exam_notes: document.getElementById("examNotes").value
  };
  const url = editingVisit ? VISITS_URL + "?id=" + editingVisit.id : VISITS_URL;

  btn.disabled = true; btn.textContent = "Saving...";
  api(url, {
    method: editingVisit ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function (data) {
      showToast(editingVisit ? "Visit updated" : "Check-up saved to " + currentStudent.name + "'s record");
      if (afterVisitSave) {               // e.g. return to the appointment screen
        const hook = afterVisitSave; afterVisitSave = null;
        hook(data.visit);
        return;
      }
      show("record");
      return loadVisits();
    })
    .catch(function (err) { if (!handleAuthError(err)) errBox.textContent = "Could not save: " + err.message; })
    .finally(function () { btn.disabled = false; btn.textContent = "Save visit"; });
}

// ---------- events ----------
document.getElementById("saveStudentBtn").addEventListener("click", saveStudent);
document.getElementById("deleteStudentBtn").addEventListener("click", deleteStudent);
document.getElementById("editGender").addEventListener("change", updateEditPreview);
document.getElementById("editNumber").addEventListener("input", updateEditPreview);
document.getElementById("recordBack").addEventListener("click", function () {
  show(recordReturnView);
  if (recordReturnView === "appointments" && typeof refreshSession === "function") refreshSession();
});
document.getElementById("addVisitBtn").addEventListener("click", function () {
  visitReturnView = "record"; afterVisitSave = null; openVisitForm(null);
});
function leaveVisitForm() {
  const back = visitReturnView;
  visitReturnView = "record"; afterVisitSave = null;
  show(back);
}
document.getElementById("visitBack").addEventListener("click", leaveVisitForm);
document.getElementById("visitCancel").addEventListener("click", leaveVisitForm);
document.getElementById("visitSave").addEventListener("click", saveVisit);
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
document.getElementById("addSymptomOk").addEventListener("click", addSymptom);
document.getElementById("newSymptom").addEventListener("keydown", function (e) {
  if (e.key === "Enter") addSymptom();
});
