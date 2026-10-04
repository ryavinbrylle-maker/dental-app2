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
const DEFAULT_SYMPTOMS = ["Pain", "Swelling", "Bleeding", "Sensitivity"];

let currentStudent = null;
let visits = [];
let editingVisit = null;
let form = null; // { symptoms:Set, extraSymptoms:[], teeth:{}, dentition, selected }

const views = {
  dashboard: document.getElementById("dashboard"),
  record: document.getElementById("record"),
  visitForm: document.getElementById("visitForm")
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
// teeth: { "54": {status, note} }, opts: { selectable, selected, onSelect, mini, rows }
function toothMap(teeth, opts) {
  const wrap = el("div");
  opts.rows.forEach(function (row) {
    const r = el("div", "teeth-row");
    row.forEach(function (num, i) {
      const n = String(num);
      const info = teeth[n];
      const b = el("button", "tooth" + (opts.mini ? " mini" : "") + (opts.selectable ? "" : " static"));
      b.type = "button";
      if (i === row.length / 2) b.classList.add("gap"); // small gap at the midline
      b.appendChild(document.createTextNode(n));
      if (info && info.status && info.status !== "Sound") {
        b.classList.add("s-" + info.status);
        b.appendChild(el("small", "", info.status));
      }
      if (info && info.note) b.title = info.note;
      if (opts.selectable) {
        if (opts.selected === n) b.classList.add("selected");
        b.addEventListener("click", function () { opts.onSelect(n); });
      } else {
        b.tabIndex = -1;
      }
      r.appendChild(b);
    });
    wrap.appendChild(r);
  });
  return wrap;
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

function openRecord(student) {
  currentStudent = student;
  visits = [];
  fillStudentHeader();
  fillEditForm();
  renderRecord();
  show("record");
  loadVisits();
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
  visits.slice().reverse().forEach(function (v) { Object.assign(current, v.teeth || {}); });
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
    edit.addEventListener("click", function () { openVisitForm(v); });
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

    // Teeth grouped by status (Sound teeth are not listed)
    const teeth = v.teeth || {};
    STATUSES.filter(function (st) { return st !== "Sound"; }).forEach(function (st) {
      const nums = Object.keys(teeth).filter(function (n) { return teeth[n].status === st; }).sort();
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
      nums.forEach(function (n) {
        if (teeth[n].note) item.appendChild(el("p", "muted", "Tooth " + n + ": " + teeth[n].note));
      });
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
  editingVisit = visit || null;
  const teeth = JSON.parse(JSON.stringify((visit && visit.teeth) || {}));
  const chosen = new Set((visit && visit.symptoms) || []);
  const extra = Array.from(chosen).filter(function (x) { return !DEFAULT_SYMPTOMS.includes(x); });

  // Start on Primary if the visit only has primary teeth, or for young students with no teeth recorded
  let dentition = "Permanent";
  if (hasAny(teeth, "Primary") && !hasAny(teeth, "Permanent")) dentition = "Primary";
  else if (!Object.keys(teeth).length && Number(currentStudent.age) > 0 && Number(currentStudent.age) < 6) dentition = "Primary";

  form = { symptoms: chosen, extraSymptoms: extra, teeth: teeth, dentition: dentition, selected: null, brush: null };

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

  // Status buttons ("brushes") with how many teeth have each status
  const chips = document.getElementById("statusChips");
  chips.innerHTML = "";
  STATUSES.forEach(function (st) {
    const c = el("button", "chip" + (form.brush === st ? " brush b-" + st : ""), st);
    c.type = "button";
    const n = Object.values(form.teeth).filter(function (t) { return t.status === st; }).length;
    if (n && st !== "Sound") c.appendChild(el("span", "cnt", "(" + n + ")"));
    c.addEventListener("click", function () {
      form.brush = form.brush === st ? null : st;
      renderExam();
    });
    chips.appendChild(c);
  });

  document.getElementById("brushHint").textContent = form.brush
    ? (form.brush === "Sound" ? "Tap teeth to clear them back to Sound." : "Tap every " + form.brush.toLowerCase() + " tooth.")
    : "Pick a status above to start marking teeth.";

  const mapBox = document.getElementById("examMap");
  mapBox.innerHTML = "";
  mapBox.appendChild(toothMap(form.teeth, {
    rows: TEETH[form.dentition],
    selectable: true,
    selected: form.selected,
    onSelect: tapTooth
  }));

  const panel = document.getElementById("toothPanel");
  if (!form.selected) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  document.getElementById("selTooth").textContent = form.selected;
  document.getElementById("toothNote").value = (form.teeth[form.selected] || {}).note || "";
}

// Tap a tooth: give it the chosen status, or undo if it already has it
function tapTooth(n) {
  saveToothNote();
  form.selected = n;
  if (form.brush) {
    const t = form.teeth[n];
    const note = t ? t.note : "";
    if (form.brush === "Sound" || (t && t.status === form.brush)) {
      if (note) form.teeth[n] = { status: "Sound", note: note };
      else delete form.teeth[n];
    } else {
      form.teeth[n] = { status: form.brush, note: note || "" };
    }
  }
  renderExam();
}

// Keep the note typed for the selected tooth
function saveToothNote() {
  if (!form || !form.selected) return;
  const note = document.getElementById("toothNote").value.trim();
  const t = form.teeth[form.selected];
  if (t) t.note = note;
  else if (note) form.teeth[form.selected] = { status: "Sound", note: note };
}

function saveVisit() {
  saveToothNote();
  const btn = document.getElementById("visitSave");
  const errBox = document.getElementById("visitError");
  errBox.textContent = "";

  const body = {
    student_id: currentStudent.id,
    visit_date: document.getElementById("visitDate").value,
    symptoms: Array.from(form.symptoms),
    chief_complaint: document.getElementById("complaint").value,
    teeth: form.teeth,
    exam_notes: document.getElementById("examNotes").value
  };
  const url = editingVisit ? VISITS_URL + "?id=" + editingVisit.id : VISITS_URL;

  btn.disabled = true; btn.textContent = "Saving...";
  api(url, {
    method: editingVisit ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function () {
      showToast(editingVisit ? "Visit updated" : "Check-up saved to " + currentStudent.name + "'s record");
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
document.getElementById("recordBack").addEventListener("click", function () { show("dashboard"); });
document.getElementById("addVisitBtn").addEventListener("click", function () { openVisitForm(null); });
document.getElementById("visitBack").addEventListener("click", function () { show("record"); });
document.getElementById("visitCancel").addEventListener("click", function () { show("record"); });
document.getElementById("visitSave").addEventListener("click", saveVisit);
document.getElementById("segPermanent").addEventListener("click", function () {
  saveToothNote(); form.dentition = "Permanent"; form.selected = null; renderExam();
});
document.getElementById("segPrimary").addEventListener("click", function () {
  saveToothNote(); form.dentition = "Primary"; form.selected = null; renderExam();
});
document.getElementById("toothNote").addEventListener("input", saveToothNote);
document.getElementById("addSymptomOk").addEventListener("click", addSymptom);
document.getElementById("newSymptom").addEventListener("keydown", function (e) {
  if (e.key === "Enter") addSymptom();
});
