// Dental appointment queue for the dentist.
// Flow: pick Grade -> pick Section -> Load -> queue sorted by student code ->
//       Complete (with result) or Absent -> next student moves up automatically.
// Everything is saved to the database right away, so results and absences
// stay in each student's personal record.
//
// Uses from Students.js: token, students, readJson, showToast, studentCode,
//   compareGrades, compareSections, hasPlace, text
// Uses from Dental.js:   show, api, el, todayIso, openRecord, openVisitForm,
//   currentStudent, visitReturnView, afterVisitSave, handleAuthError

const APPT_URL = "/api/appointments";
const RESULT_OPTIONS = [
  "No major concerns",
  "Needs follow-up",
  "Treated today",
  "Referred to a dentist/clinic",
  "Other (see notes)"
];
const NEXT_COUNT = 4; // how many "next" students to show under the current one

const ap = {
  grade: "", section: "", date: "",
  list: [],            // appointments for the loaded class + date (sorted by code)
  loaded: false,
  busy: false,
  shownCurrentId: null, // which appointment the "current" card is showing
  exam: null,          // { apptId, visitId } tooth-map exam attached to the current student
  last: null           // last action, for Undo of an absence
};

const $ = function (id) { return document.getElementById(id); };

// ---------- helpers ----------
function apCode(a) {
  return a.code_gender && a.code_number ? a.code_gender + "-" + a.code_number : "—";
}
function longDate(v) {
  const iso = dateOnly(v);
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
function waitingList() { return ap.list.filter(function (a) { return a.status === "Waiting"; }); }
function currentAppt() { return waitingList()[0] || null; }
function counts() {
  const c = { total: ap.list.length, Completed: 0, Waiting: 0, Absent: 0 };
  ap.list.forEach(function (a) { c[a.status]++; });
  return c;
}
function studentById(id) {
  return students.find(function (s) { return s.id === id; }) || null;
}
function apError(msg) { $("apError").textContent = msg || ""; }

// ---------- Grade / Section pickers ----------
function placedStudents() { return students.filter(hasPlace); }

function fillApGrades() {
  const sel = $("apGrade");
  const keep = sel.value || ap.grade;
  const grades = Array.from(new Set(placedStudents().map(function (s) { return s.grade; }))).sort(compareGrades);
  sel.innerHTML = "";
  const first = el("option", "", grades.length ? "Choose grade" : "No students with a code yet");
  first.value = ""; first.disabled = true; first.selected = true; sel.appendChild(first);
  grades.forEach(function (g) {
    const o = el("option", "", g); o.value = g; if (g === keep) { o.selected = true; first.selected = false; }
    sel.appendChild(o);
  });
  fillApSections();
}

function fillApSections(reset) {
  const g = $("apGrade").value;
  const sel = $("apSection");
  const keep = reset ? "" : (sel.value || ap.section);
  sel.innerHTML = "";
  const first = el("option", "", g ? "Choose section" : "Choose a grade first");
  first.value = ""; first.disabled = true; first.selected = true; sel.appendChild(first);
  sel.disabled = !g;
  if (g) {
    const secs = Array.from(new Set(placedStudents()
      .filter(function (s) { return s.grade === g; })
      .map(function (s) { return s.section; }))).sort(compareSections);
    secs.forEach(function (sec) {
      const o = el("option", "", sec); o.value = sec; if (sec === keep) { o.selected = true; first.selected = false; }
      sel.appendChild(o);
    });
  }
  updateLoadButton();
}

function updateLoadButton() {
  const ready = $("apGrade").value && $("apSection").value && $("apDate").value;
  $("apLoad").disabled = !ready || ap.busy;
  // If the pickers no longer match the loaded session, hide it until reloaded
  const same = ap.loaded && $("apGrade").value === ap.grade &&
               $("apSection").value === ap.section && $("apDate").value === ap.date;
  $("apSession").style.display = same ? "block" : "none";
  $("apLoad").textContent = same ? "Reload section" : "Load section";
  $("apSub").textContent = same
    ? ap.grade + " – " + ap.section + " · " + longDate(ap.date)
    : "Step 1: choose a grade and section";
}

// ---------- load / refresh ----------
function loadSession() {
  const grade = $("apGrade").value, section = $("apSection").value, date = $("apDate").value;
  // Rule: no appointments without a Grade AND a Section
  if (!grade || !section) { apError("Please select a grade and a section first."); return; }
  if (!date) { apError("Please choose the appointment date."); return; }
  apError("");
  ap.busy = true; updateLoadButton();
  api(APPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "schedule", grade: grade, section: section, date: date })
  })
    .then(function (data) {
      const changed = grade !== ap.grade || section !== ap.section || date !== ap.date;
      ap.grade = grade; ap.section = section; ap.date = date;
      ap.list = data.appointments || [];
      ap.loaded = true;
      if (changed) { ap.shownCurrentId = null; ap.exam = null; ap.last = null; }
      if (!ap.list.length) apError("No students with a student code in " + grade + " – " + section + ".");
      renderSession();
    })
    .catch(function (err) { if (!handleAuthError(err)) apError(err.message); })
    .finally(function () { ap.busy = false; updateLoadButton(); });
}

// Quietly re-read the class list (keeps whatever the dentist is typing)
function refreshSession() {
  if (!ap.loaded || ap.busy) return Promise.resolve();
  const q = "?grade=" + encodeURIComponent(ap.grade) + "&section=" + encodeURIComponent(ap.section) +
            "&date=" + encodeURIComponent(ap.date);
  return api(APPT_URL + q)
    .then(function (data) { ap.list = data.appointments || []; renderSession(); })
    .catch(function (err) { handleAuthError(err); });
}

// ---------- render ----------
function renderSession() {
  updateLoadButton();
  const c = counts();
  const processed = c.Completed + c.Absent;

  // Stat tiles
  const stats = $("apStats");
  stats.innerHTML = "";
  [["Total students", c.total, "blue"], ["Completed", c.Completed, "green"],
   ["Waiting", c.Waiting, "yellow"], ["Absent", c.Absent, "red"],
   ["Attendance", c.Completed + "/" + c.total, "green"]].forEach(function (t) {
    const d = el("div", "ap-stat " + t[2]);
    d.appendChild(el("span", "", t[0]));
    d.appendChild(el("b", "", String(t[1])));
    stats.appendChild(d);
  });
  $("apBar").style.width = (c.total ? Math.round(processed / c.total * 100) : 0) + "%";
  $("apProgress").textContent = "Processed " + processed + " of " + c.total + " students" +
    (c.Waiting ? " · " + c.Waiting + " still waiting" : " · all done");

  renderLastAction();
  renderCurrent();
  renderNext();
  renderList();
  renderSummary();
}

function renderLastAction() {
  const box = $("apLast");
  box.innerHTML = "";
  if (!ap.last) return;
  const a = ap.list.find(function (x) { return x.id === ap.last.id; });
  if (!a) { ap.last = null; return; }
  box.appendChild(el("span", "", ap.last.text));
  if (a.status === "Absent") {
    const undo = el("button", "mini-btn", "Undo absent"); undo.type = "button";
    undo.addEventListener("click", function () { backToQueue(a); });
    box.appendChild(undo);
  }
}

// Only rebuild the current-student card when the current student changes,
// so the dentist's typed notes are never wiped by an automatic refresh.
function renderCurrent(force) {
  const cur = currentAppt();
  const id = cur ? cur.id : "done";
  if (!force && ap.shownCurrentId === id && $("apCurrent").childNodes.length) {
    updateExamIndicator();
    return;
  }
  ap.shownCurrentId = id;
  const box = $("apCurrent");
  box.innerHTML = "";

  if (!cur) {
    const done = el("div", "ap-done");
    done.appendChild(el("b", "", ap.list.length ? "✓ All students processed" : "No students to see"));
    done.appendChild(el("p", "muted", ap.list.length
      ? "The daily summary below is final. Absent students are listed there."
      : "Register students with a student code in this section first."));
    box.appendChild(done);
    return;
  }

  box.appendChild(el("div", "ap-now", "🔵 Current student"));
  const who = el("div", "ap-who");
  who.appendChild(el("span", "code-badge " + (cur.code_gender || "none"), apCode(cur)));
  who.appendChild(el("h3", "", cur.name || "—"));
  box.appendChild(who);

  const meta = el("div", "ap-meta");
  [["Grade", cur.grade], ["Section", cur.section], ["Date", longDate(cur.appointment_date)],
   ["Status", "⏳ Waiting – now being seen"]].forEach(function (p) {
    const d = el("div");
    d.appendChild(el("span", "muted", p[0] + ": "));
    d.appendChild(el("b", "", p[1]));
    meta.appendChild(d);
  });
  box.appendChild(meta);
  if (cur.extra) box.appendChild(el("p", "hint", "Extra appointment (2nd one today)"));

  // Health alert so the dentist sees it before treatment
  const medical = [].concat(cur.conditions || [], cur.other_conditions ? [cur.other_conditions] : []);
  const alerts = [];
  if (cur.allergies) alerts.push("Allergy: " + cur.allergies);
  if (medical.length) alerts.push("Medical: " + medical.join(", "));
  if (cur.medications) alerts.push("Medication: " + cur.medications);
  if (alerts.length) box.appendChild(el("div", "ap-alert", "⚠ " + alerts.join(" · ")));

  box.appendChild(el("span", "small-label", "Appointment result"));
  const sel = el("select", "box"); sel.id = "apResult";
  const o0 = el("option", "", "Choose result"); o0.value = ""; o0.disabled = true; o0.selected = true; sel.appendChild(o0);
  RESULT_OPTIONS.forEach(function (r) { const o = el("option", "", r); o.value = r; sel.appendChild(o); });
  box.appendChild(sel);

  box.appendChild(el("span", "small-label", "Dentist notes"));
  const notes = el("textarea", "box"); notes.id = "apNotes";
  notes.placeholder = "Findings, treatment given, advice for parents...";
  box.appendChild(notes);

  const exam = el("div", "ap-exam");
  const examBtn = el("button", "secondary", "🦷 Record tooth-map exam (optional)"); examBtn.type = "button";
  examBtn.addEventListener("click", function () { startExam(cur); });
  exam.appendChild(examBtn);
  exam.appendChild(el("span", "hint", "")).id = "apExamState";
  box.appendChild(exam);
  updateExamIndicator();

  const actions = el("div", "ap-actions");
  const done = el("button", "btn-complete", "✓ Complete appointment"); done.type = "button"; done.id = "apComplete";
  done.addEventListener("click", function () { finish(cur, "Completed"); });
  const absent = el("button", "btn-absent", "✗ Absent"); absent.type = "button"; absent.id = "apAbsent";
  absent.addEventListener("click", function () { finish(cur, "Absent"); });
  actions.appendChild(done); actions.appendChild(absent);
  box.appendChild(actions);
  box.appendChild(el("p", "error", "")).id = "apActionError";
}

function updateExamIndicator() {
  const span = $("apExamState");
  if (!span) return;
  const cur = currentAppt();
  span.textContent = cur && ap.exam && ap.exam.apptId === cur.id ? "✓ Exam recorded – it will be linked to this appointment" : "";
}

function renderNext() {
  const ol = $("apNext");
  ol.innerHTML = "";
  const next = waitingList().slice(1, 1 + NEXT_COUNT);
  if (!next.length) {
    const li = el("li", "muted", "No one else waiting."); li.style.listStyle = "none";
    ol.appendChild(li); return;
  }
  next.forEach(function (a) { ol.appendChild(el("li", "", apCode(a) + " – " + (a.name || "—"))); });
  const more = waitingList().length - 1 - next.length;
  if (more > 0) {
    const li = el("li", "muted", "+ " + more + " more waiting"); li.style.listStyle = "none";
    ol.appendChild(li);
  }
}

function renderList() {
  const box = $("apList");
  box.innerHTML = "";
  const cur = currentAppt();
  ap.list.forEach(function (a) {
    const isCur = cur && cur.id === a.id;
    const row = el("div", "ap-row s-" + a.status + (isCur ? " current" : ""));
    row.appendChild(el("span", "code-badge " + (a.code_gender || "none"), apCode(a)));
    row.appendChild(el("span", "nm", a.name || "—"));
    const label = isCur ? "🔵 Current" :
                  a.status === "Completed" ? "✓ Completed" :
                  a.status === "Absent" ? "✗ ABSENT" : "⏳ Waiting";
    row.appendChild(el("span", "st", label));
    if (a.status === "Absent") {
      const back = el("button", "mini-btn", "Arrived late"); back.type = "button";
      back.title = "Put this student back in the queue";
      back.addEventListener("click", function (e) { e.stopPropagation(); backToQueue(a); });
      row.appendChild(back);
    }
    row.title = "Open " + (a.name || "student") + "'s personal record";
    row.addEventListener("click", function () {
      const s = studentById(a.student_id);
      if (s) openRecord(s, "appointments");
    });
    box.appendChild(row);
  });
}

function renderSummary() {
  const box = $("apSummary");
  box.innerHTML = "";
  const c = counts();
  const isToday = ap.date === todayIso();
  const head = el("div", "card-head");
  head.appendChild(el("h3", "", (isToday ? "Today's" : longDate(ap.date) + " –") + " Dental Appointment Summary" +
                                 (c.Waiting ? "" : " (final)")));
  const print = el("button", "secondary", "Print summary"); print.type = "button";
  print.addEventListener("click", function () { window.print(); });
  head.appendChild(print);
  box.appendChild(head);

  box.appendChild(el("p", "", "Section: " + ap.grade + " – " + ap.section + " · " + longDate(ap.date)));
  const grid = el("div", "dmft");
  [["Students scheduled", c.total], ["Students present", c.Completed],
   ["Students absent", c.Absent], ["Still waiting", c.Waiting]].forEach(function (p) {
    const d = el("div");
    d.appendChild(el("span", "muted", p[0] + ": "));
    d.appendChild(el("b", "", String(p[1])));
    grid.appendChild(d);
  });
  box.appendChild(grid);
  const score = el("p", "ap-score", "Attendance: " + c.Completed + "/" + c.total);
  box.appendChild(score);
  if (c.Waiting) box.appendChild(el("p", "muted", "Not final yet – " + c.Waiting + " student(s) still waiting."));

  const absents = ap.list.filter(function (a) { return a.status === "Absent"; });
  if (absents.length) {
    const list = el("div", "absent-list");
    list.appendChild(el("b", "", "Absent students:"));
    absents.forEach(function (a) { list.appendChild(el("p", "", "⚠ " + (a.name || "—") + " (" + apCode(a) + ")")); });
    box.appendChild(list);
  }
}

// ---------- actions ----------
function setActionsDisabled(on) {
  ["apComplete", "apAbsent"].forEach(function (id) { if ($(id)) $(id).disabled = on; });
}

function finish(appt, status) {
  if (ap.busy) return;
  const errBox = $("apActionError");
  errBox.textContent = "";
  const result = $("apResult") ? $("apResult").value : "";
  const notes = $("apNotes") ? $("apNotes").value.trim() : "";
  if (status === "Completed" && !result) {
    errBox.textContent = "Choose the appointment result first (or press Absent).";
    $("apResult").focus();
    return;
  }
  const body = { status: status, result: status === "Completed" ? result : null, notes: notes || null };
  if (status === "Completed" && ap.exam && ap.exam.apptId === appt.id) body.visit_id = ap.exam.visitId;

  ap.busy = true; setActionsDisabled(true);
  api(APPT_URL + "?id=" + appt.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function (data) {
      // Update the row in place -> the queue advances automatically
      const i = ap.list.findIndex(function (a) { return a.id === appt.id; });
      if (i >= 0) ap.list[i] = Object.assign({}, ap.list[i], data.appointment);
      ap.exam = null;
      const label = apCode(appt) + " " + (appt.name || "");
      ap.last = { id: appt.id, text: status === "Absent" ? "✗ " + label + " marked ABSENT" : "✓ " + label + " completed – saved to their record" };
      showToast(status === "Absent" ? label + " marked absent" : label + " saved");
      ap.busy = false;
      renderSession();
      window.scrollTo({ top: 0, behavior: "smooth" });
    })
    .catch(function (err) {
      ap.busy = false;
      if (handleAuthError(err)) return;
      errBox.textContent = "Could not save: " + err.message;
      setActionsDisabled(false);
      if (err.status === 409) refreshSession(); // someone else already changed it
    });
}

// Absent student arrived late (or absence was a mistake): put them back in the queue
function backToQueue(appt) {
  if (ap.busy) return;
  ap.busy = true;
  api(APPT_URL + "?id=" + appt.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Waiting" })
  })
    .then(function (data) {
      const i = ap.list.findIndex(function (a) { return a.id === appt.id; });
      if (i >= 0) ap.list[i] = Object.assign({}, ap.list[i], data.appointment);
      ap.last = null;
      showToast(apCode(appt) + " is back in the queue");
      ap.busy = false;
      renderSession();
    })
    .catch(function (err) { ap.busy = false; if (!handleAuthError(err)) apError(err.message); });
}

// Optional full tooth-map exam for the current student, then come back here
function startExam(appt) {
  const s = studentById(appt.student_id);
  if (!s) { $("apActionError").textContent = "Student not found – press Reload section."; return; }
  currentStudent = s;
  visitReturnView = "appointments";
  afterVisitSave = function (visit) {
    ap.exam = { apptId: appt.id, visitId: visit && visit.id };
    visitReturnView = "record";
    show("appointments");
    updateExamIndicator();
  };
  openVisitForm(null);
}

// ---------- personal record: appointment & attendance history ----------
function loadApptHistory() {
  const box = $("apptHistory");
  const count = $("apptHistoryCount");
  box.innerHTML = '<p class="muted">Loading...</p>';
  count.textContent = "";
  const s = currentStudent;
  return api(APPT_URL + "?student_id=" + encodeURIComponent(s.id))
    .then(function (data) {
      if (!currentStudent || currentStudent.id !== s.id) return;
      const list = data.appointments || [];
      box.innerHTML = "";
      const absences = list.filter(function (a) { return a.status === "Absent"; }).length;
      count.textContent = list.length
        ? list.length + " appointment" + (list.length === 1 ? "" : "s") + " · " +
          absences + " absence" + (absences === 1 ? "" : "s")
        : "";
      if (!list.length) { box.appendChild(el("p", "muted", "No appointments yet.")); return; }
      list.forEach(function (a) {
        const item = el("div", "ap-hist" + (a.status === "Absent" ? " absent" : a.status === "Waiting" ? " waiting" : ""));
        const line = function (label, value) {
          const p = el("p"); p.appendChild(el("b", "", label + ": ")); p.appendChild(document.createTextNode(value)); item.appendChild(p);
        };
        line("Date", longDate(a.appointment_date) + (a.extra ? " (extra appointment)" : ""));
        line("Class", a.grade + " – " + a.section);
        line("Status", a.status === "Completed" ? "Present" : a.status === "Absent" ? "ABSENT" : "Waiting (not seen yet)");
        if (a.status === "Completed") line("Result", a.result || "Completed");
        if (a.notes) line("Dentist notes", a.notes);
        if (a.visit_id) line("Exam", "Tooth-map exam recorded (see Visit History)");
        box.appendChild(item);
      });
    })
    .catch(function (err) {
      if (handleAuthError(err)) return;
      box.innerHTML = "";
      box.appendChild(el("p", "error", err.message));
    });
}

// Intentionally add a 2nd appointment for the same student today (needs a double tap)
function addExtraAppointment() {
  const btn = $("extraApptBtn");
  if (btn.dataset.confirm !== "1") {
    btn.dataset.confirm = "1";
    btn.textContent = "Tap again to add a 2nd appointment today";
    setTimeout(function () { btn.dataset.confirm = ""; btn.textContent = "Add another appointment today"; }, 5000);
    return;
  }
  btn.dataset.confirm = ""; btn.textContent = "Add another appointment today";
  api(APPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "extra", student_id: currentStudent.id, date: todayIso() })
  })
    .then(function () {
      showToast("Extra appointment added for today");
      loadApptHistory();
    })
    .catch(function (err) { if (!handleAuthError(err)) showToast(err.message); });
}

// ---------- open / events ----------
function openAppointments() {
  if (!$("apDate").value) $("apDate").value = todayIso();
  fillApGrades();
  show("appointments");
  if (ap.loaded) refreshSession();
}

$("openApptBtn").addEventListener("click", openAppointments);
$("apBack").addEventListener("click", function () { show("dashboard"); });
$("apGrade").addEventListener("change", function () { fillApSections(true); });
$("apSection").addEventListener("change", updateLoadButton);
$("apDate").addEventListener("change", updateLoadButton);
$("apLoad").addEventListener("click", loadSession);
$("extraApptBtn").addEventListener("click", addExtraAppointment);

// Keep the screen in sync (e.g. a second device), without touching typed notes
setInterval(function () {
  if (token && !document.hidden && $("appointments").style.display === "block") refreshSession();
}, 20000);
