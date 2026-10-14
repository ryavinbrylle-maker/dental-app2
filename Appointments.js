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
// Queue = students who arrived late (in order of arrival – they are here now),
// then the scheduled students in student-code order (the server sends them sorted).
function waitingList() {
  const late = ap.list.filter(function (a) { return a.status === "Late Arrival"; })
    .sort(function (a, b) { return new Date(a.arrived_at) - new Date(b.arrived_at) || a.id - b.id; });
  const waiting = ap.list.filter(function (a) { return a.status === "Waiting"; });
  return late.concat(waiting);
}
function currentAppt() { return waitingList()[0] || null; }
function counts() {
  const c = { total: ap.list.length, Completed: 0, Waiting: 0, Absent: 0, "Late Arrival": 0, queue: 0, lateTotal: 0 };
  ap.list.forEach(function (a) {
    c[a.status]++;
    if (a.was_absent && a.status !== "Absent") c.lateTotal++;
  });
  c.queue = c.Waiting + c["Late Arrival"];
  return c;
}
function fmtTime(v) {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
      if (changed) { ap.shownCurrentId = null; ap.exam = null; ap.last = null; ab.filter = null; ab.picked = false; }
      if (!ap.list.length) apError("No students with a student code in " + grade + " – " + section + ".");
      renderSession();
      loadAbsent();
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
   ["Waiting", c.queue, "yellow"], ["Absent", c.Absent, "red"],
   ["Attendance", c.Completed + "/" + c.total, "green"]].forEach(function (t) {
    const d = el("div", "ap-stat " + t[2]);
    d.appendChild(el("span", "", t[0]));
    d.appendChild(el("b", "", String(t[1])));
    stats.appendChild(d);
  });
  $("apBar").style.width = (c.total ? Math.round(processed / c.total * 100) : 0) + "%";
  $("apProgress").textContent = "Processed " + processed + " of " + c.total + " students" +
    (c.queue ? " · " + c.queue + " still waiting" : " · all done") +
    (c["Late Arrival"] ? " · " + c["Late Arrival"] + " late arrival(s) in the queue" : "");

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
  if (ap.last.goto) {   // a late student from another section was restored
    box.appendChild(el("span", "", ap.last.text));
    const go = el("button", "mini-btn", "Open " + ap.last.goto.grade + " – " + ap.last.goto.section);
    go.type = "button";
    go.addEventListener("click", function () { openClass(ap.last.goto.grade, ap.last.goto.section); });
    box.appendChild(go);
    return;
  }
  const a = ap.list.find(function (x) { return x.id === ap.last.id; });
  if (!a) { ap.last = null; return; }
  box.appendChild(el("span", "", ap.last.text));
  if (a.status === "Absent" && ap.last.canUndo) {
    const undo = el("button", "mini-btn", "Undo absent (mistake)"); undo.type = "button";
    undo.addEventListener("click", function () { undoAbsent(a); });
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
   ["Status", cur.status === "Late Arrival"
      ? "🕒 Late arrival – arrived " + fmtTime(cur.arrived_at) + " (marked absent " + fmtTime(cur.absent_at) + ")"
      : "⏳ Waiting – now being seen"]].forEach(function (p) {
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
    const row = el("div", "ap-row s-" + a.status.replace(" ", "") + (isCur ? " current" : ""));
    row.appendChild(el("span", "code-badge " + (a.code_gender || "none"), apCode(a)));
    row.appendChild(el("span", "nm", a.name || "—"));
    const label = isCur ? "🔵 Current" :
                  a.status === "Completed" ? (a.was_absent ? "✓ Completed (late)" : "✓ Completed") :
                  a.status === "Absent" ? "✗ ABSENT" :
                  a.status === "Late Arrival" ? "🕒 Late arrival" : "⏳ Waiting";
    row.appendChild(el("span", "st", label));
    if (a.status === "Absent") {
      const back = arrivedButton(a, "mini-btn");
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
                                 (c.queue ? "" : " (final)")));
  const print = el("button", "secondary", "Print summary"); print.type = "button";
  print.addEventListener("click", function () { window.print(); });
  head.appendChild(print);
  box.appendChild(head);

  box.appendChild(el("p", "", "Section: " + ap.grade + " – " + ap.section + " · " + longDate(ap.date)));
  const grid = el("div", "dmft");
  [["Students scheduled", c.total], ["Students present", c.Completed],
   ["Students absent", c.Absent], ["Still waiting", c.queue],
   ["Late arrivals (came after being marked absent)", c.lateTotal]].forEach(function (p) {
    const d = el("div");
    d.appendChild(el("span", "muted", p[0] + ": "));
    d.appendChild(el("b", "", String(p[1])));
    grid.appendChild(d);
  });
  box.appendChild(grid);
  const score = el("p", "ap-score", "Attendance: " + c.Completed + "/" + c.total);
  box.appendChild(score);
  if (c.queue) box.appendChild(el("p", "muted", "Not final yet – " + c.queue + " student(s) still waiting."));

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
      ap.last = { id: appt.id, canUndo: status === "Absent",
                  text: status === "Absent" ? "✗ " + label + " marked ABSENT – listed under Absent Students"
                                            : "✓ " + label + " completed – saved to their record" };
      showToast(status === "Absent" ? label + " marked absent" : label + " saved");
      ap.busy = false;
      renderSession();
      loadAbsent();
      window.scrollTo({ top: 0, behavior: "smooth" });
    })
    .catch(function (err) {
      ap.busy = false;
      if (handleAuthError(err)) return;
      errBox.textContent = "Could not save: " + err.message;
      setActionsDisabled(false);
      if (err.status === 409) { refreshSession(); loadAbsent(); } // someone else already changed it
    });
}

// "Mark as Arrived" button (needs a 2nd tap to confirm, so it can't be pressed by accident)
function arrivedButton(a, cls) {
  const btn = el("button", cls, "Mark as Arrived"); btn.type = "button";
  btn.title = "The student came late – put them back in the queue for treatment";
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (btn.dataset.confirm !== "1") {
      btn.dataset.confirm = "1"; btn.textContent = "Tap again to confirm";
      setTimeout(function () { btn.dataset.confirm = ""; btn.textContent = "Mark as Arrived"; }, 4000);
      return;
    }
    markArrived(a, btn);
  });
  return btn;
}

// Absent -> Late Arrival. Same appointment (no duplicate); the absence stays in the history.
function markArrived(appt, btn) {
  if (ap.busy) return;
  ap.busy = true;
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  api(APPT_URL + "?id=" + appt.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Late Arrival" })
  })
    .then(function (data) {
      ap.busy = false;
      const sameClass = ap.loaded && appt.grade === ap.grade && appt.section === ap.section &&
                        dateOnly(appt.appointment_date) === ap.date;
      const label = apCode(appt) + " " + (appt.name || "");
      if (sameClass) {
        const i = ap.list.findIndex(function (a) { return a.id === appt.id; });
        if (i >= 0) ap.list[i] = Object.assign({}, ap.list[i], data.appointment);
        ap.last = { id: appt.id, text: "🕒 " + label + " arrived – moved to the front of the queue" };
        renderSession();
      } else {
        ap.last = { goto: { grade: appt.grade, section: appt.section },
                    text: "🕒 " + label + " arrived (" + appt.grade + " – " + appt.section + ")" };
        if (ap.loaded) renderSession();
      }
      showToast(label + " marked as arrived");
      return loadAbsent();
    })
    .catch(function (err) {
      ap.busy = false;
      if (handleAuthError(err)) return;
      if (btn) { btn.disabled = false; btn.textContent = "Mark as Arrived"; btn.dataset.confirm = ""; }
      // Nothing was saved: keep the student listed and say why
      const msg = "Could not mark " + apCode(appt) + " as arrived – nothing was changed. " +
                  (err.status ? err.message : "Check the internet connection and try again.");
      if (err.status) { loadAbsent().then(function () { $("abError").textContent = msg; }); refreshSession(); }
      else $("abError").textContent = msg;
    });
}

// The dentist pressed Absent by mistake: back to Waiting, absence removed
function undoAbsent(appt) {
  if (ap.busy) return;
  ap.busy = true;
  api(APPT_URL + "?id=" + appt.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Waiting", undo: true })
  })
    .then(function (data) {
      const i = ap.list.findIndex(function (a) { return a.id === appt.id; });
      if (i >= 0) ap.list[i] = Object.assign({}, ap.list[i], data.appointment);
      ap.last = null;
      showToast(apCode(appt) + " absence undone" + (data.appointment.status === "Late Arrival" ? " (back to late arrival)" : ""));
      ap.busy = false;
      renderSession();
      loadAbsent();
    })
    .catch(function (err) { ap.busy = false; if (!handleAuthError(err)) apError(err.message); });
}

// Switch the pickers to another class and load it
function openClass(grade, section) {
  $("apGrade").value = grade;
  fillApSections(true);
  $("apSection").value = section;
  updateLoadButton();
  loadSession();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Absent Students container (by Grade and Section) ----------
const ab = { list: [], filter: null, picked: false, date: "", loading: false };

function classKey(a) { return a.grade + "|" + a.section; }

function loadAbsent() {
  const date = $("apDate").value;
  if (!date || !token) return Promise.resolve();
  ab.loading = true;
  return api(APPT_URL + "?absent=1&date=" + encodeURIComponent(date))
    .then(function (data) {
      ab.list = data.appointments || [];
      ab.date = date;
      $("abError").textContent = "";
      renderAbsent();
    })
    .catch(function (err) {
      if (handleAuthError(err)) return;
      $("abError").textContent = "Could not load absent students: " + err.message;
    })
    .finally(function () { ab.loading = false; });
}

function renderAbsent() {
  $("abDate").textContent = longDate(ab.date);
  $("abTotal").textContent = String(ab.list.length);
  $("abTotal").className = "ab-total" + (ab.list.length ? " has" : "");

  // Grade + Section groups, sorted like everywhere else (Kinder, Grade 1, 2 ... / Section A, B ...)
  const groups = new Map();
  ab.list.forEach(function (a) {
    const k = classKey(a);
    if (!groups.has(k)) groups.set(k, { grade: a.grade, section: a.section, items: [] });
    groups.get(k).items.push(a);
  });
  const ordered = Array.from(groups.values()).sort(function (x, y) {
    return compareGrades(x.grade, y.grade) || compareSections(x.section, y.section);
  });
  ordered.forEach(function (g) { g.items.sort(compareCodes); }); // M-1, M-2 ... M-10, then F-1 ...

  // Default filter: follow the class being worked on (if it has absences), otherwise All –
  // until the dentist picks a filter themselves
  if (ab.filter && ab.filter !== "all" && !groups.has(ab.filter)) { ab.filter = null; ab.picked = false; }
  if (!ab.picked) {
    const mine = ap.loaded ? ap.grade + "|" + ap.section : null;
    ab.filter = mine && groups.has(mine) ? mine : "all";
  }

  // Filter chips with a count per Grade + Section
  const chips = $("abFilters");
  chips.innerHTML = "";
  const addChip = function (key, text, n) {
    const c = el("button", "chip" + (ab.filter === key ? " on" : ""), text);
    c.type = "button";
    c.appendChild(el("span", "cnt", "(" + n + ")"));
    c.addEventListener("click", function () { ab.filter = key; ab.picked = true; renderAbsent(); });
    chips.appendChild(c);
  };
  addChip("all", "All sections", ab.list.length);
  ordered.forEach(function (g) { addChip(classKey(g), g.grade + " – " + g.section, g.items.length); });

  // Search by student code (e.g. "M-15", "m15", "15") or name
  const q = $("abSearch").value.trim().toLowerCase();
  const qCode = q.replace(/[\s-]/g, "");
  const match = function (a) {
    if (!q) return true;
    const code = apCode(a).toLowerCase().replace("-", "");
    return code === qCode || (/^\d+$/.test(qCode) && String(a.code_number) === String(parseInt(qCode, 10))) ||
           String(a.name || "").toLowerCase().includes(q);
  };

  const box = $("abList");
  box.innerHTML = "";
  let shown = 0;
  ordered.forEach(function (g) {
    if (ab.filter !== "all" && ab.filter !== classKey(g)) return;
    const items = g.items.filter(match);
    if (!items.length) return;
    shown += items.length;
    const sec = el("div", "ab-group");
    const head = el("div", "ab-group-head");
    head.appendChild(el("b", "", g.grade + " – " + g.section));
    head.appendChild(el("span", "muted", items.length + " absent"));
    sec.appendChild(head);
    items.forEach(function (a) {
      const row = el("div", "ab-row");
      row.appendChild(el("span", "code-badge " + (a.code_gender || "none"), apCode(a)));
      const info = el("div", "ab-info");
      info.appendChild(el("b", "", a.name || "—"));
      info.appendChild(el("span", "muted", g.grade + " – " + g.section + " · Appointment " +
        longDate(a.appointment_date) + (a.absent_at ? " · marked absent " + fmtTime(a.absent_at) : "")));
      row.appendChild(info);
      row.appendChild(el("span", "ab-status", "✗ ABSENT"));
      row.appendChild(arrivedButton(a, "ab-arrive"));
      sec.appendChild(row);
    });
    box.appendChild(sec);
  });
  if (!shown) {
    box.appendChild(el("p", "muted", ab.list.length
      ? "No absent student matches your search."
      : "No students are marked absent on this date. 🎉"));
  }
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
      const absences = list.filter(function (a) { return a.was_absent || a.status === "Absent"; }).length;
      count.textContent = list.length
        ? list.length + " appointment" + (list.length === 1 ? "" : "s") + " · " +
          absences + " absence" + (absences === 1 ? "" : "s")
        : "";
      if (!list.length) { box.appendChild(el("p", "muted", "No appointments yet.")); return; }
      list.forEach(function (a) {
        const item = el("div", "ap-hist" + (a.status === "Absent" ? " absent" :
                         (a.status === "Waiting" || a.status === "Late Arrival") ? " waiting" : ""));
        const line = function (label, value) {
          const p = el("p"); p.appendChild(el("b", "", label + ": ")); p.appendChild(document.createTextNode(value)); item.appendChild(p);
        };
        line("Date", longDate(a.appointment_date) + (a.extra ? " (extra appointment)" : ""));
        line("Class", a.grade + " – " + a.section);
        line("Status", a.status === "Completed" ? (a.was_absent ? "Present (late arrival)" : "Present")
                     : a.status === "Absent" ? "ABSENT"
                     : a.status === "Late Arrival" ? "Late arrival – waiting for treatment"
                     : "Waiting (not seen yet)");
        if (a.was_absent) {
          line("Attendance", "Marked absent" + (a.absent_at ? " at " + fmtTime(a.absent_at) : "") +
               (a.arrived_at ? " · arrived at " + fmtTime(a.arrived_at) : " · did not arrive"));
        }
        if (a.status === "Completed") line("Result", a.result || "Completed");
        if (a.notes) line("Dentist notes", a.notes);
        if (a.visit_id) line("Exam", "Tooth-map exam recorded (see Visit History)");
        if (a.events && a.events.length) {
          line("Status log", a.events.map(function (e) {
            return fmtTime(e.at) + " " + (e.from || "—") + " → " + e.to + (e.by ? " (" + e.by + ")" : "");
          }).join(" · "));
        }
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
  loadAbsent();
}

$("openApptBtn").addEventListener("click", openAppointments);
$("apBack").addEventListener("click", function () { show("dashboard"); });
$("apGrade").addEventListener("change", function () { fillApSections(true); });
$("apSection").addEventListener("change", updateLoadButton);
$("apDate").addEventListener("change", function () { updateLoadButton(); ab.filter = null; ab.picked = false; loadAbsent(); });
$("abSearch").addEventListener("input", renderAbsent);
$("apLoad").addEventListener("click", loadSession);
$("extraApptBtn").addEventListener("click", addExtraAppointment);

// Keep the screen in sync (e.g. a second device), without touching typed notes
setInterval(function () {
  if (token && !document.hidden && $("appointments").style.display === "block") {
    refreshSession();
    if (!ab.loading) loadAbsent();
  }
}, 20000);
