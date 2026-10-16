// Dental appointments for the dentist.
// LIST PAGE (this view): pick Grade -> Section -> Load. The class appears as a queue sorted by
// student code. Tap a student (or "Start examination") to open the separate EXAMINATION PAGE
// (Dental.js). Saving there returns here at the SAME scroll position, with the status updated.
//
// Every change is saved on this device first (StudentStorageInfo.js) and uploaded in batches,
// so the whole flow works without internet.
//
// Uses from Students.js: token, students, currentSchoolYear, readJson, showToast, studentCode,
//   compareGrades, compareSections, compareCodes, hasPlace, text
// Uses from Dental.js: show, api, el, todayIso, dateOnly, openRecord, openVisitForm,
//   currentStudent, visitReturnView, afterVisitSave, examAbsentHandler, handleAuthError

const APPT_URL = "/api/appointments";
const NEXT_COUNT = 4; // how many "next" students to show

const ap = {
  grade: "", section: "", date: "",
  list: [],           // appointments of the loaded class + date (from this device's storage)
  loaded: false,
  busy: false,
  last: null,         // last action (for "Undo absent")
  listScroll: 0,      // scroll position of the list when an examination was opened
  flashUid: null      // row to highlight when coming back
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
function byCode(a, b) {
  return compareCodes(a, b) || (a.extra ? 1 : 0) - (b.extra ? 1 : 0) || String(a.created_at || "").localeCompare(String(b.created_at || ""));
}
// Queue = students who arrived late (in order of arrival – they are here now),
// then the scheduled students in student-code order.
function waitingList() {
  const late = ap.list.filter(function (a) { return a.status === "Late Arrival"; })
    .sort(function (a, b) { return new Date(a.arrived_at) - new Date(b.arrived_at); });
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
// The student behind an appointment (roster copy, or built from the appointment itself)
function studentForAppt(a) {
  return studentById(a.student_id) || {
    id: a.student_id, name: a.name, grade: a.grade, section: a.section, code_gender: a.code_gender,
    code_number: a.code_number, identity_id: a.identity_id, school_year: a.school_year,
    allergies: a.allergies, conditions: a.conditions, other_conditions: a.other_conditions, medications: a.medications
  };
}
function apError(msg) { $("apError").textContent = msg || ""; }
function isNetworkError(err) { return !err.status; }

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
  const same = ap.loaded && $("apGrade").value === ap.grade &&
               $("apSection").value === ap.section && $("apDate").value === ap.date;
  $("apSession").style.display = same ? "block" : "none";
  $("apLoad").textContent = same ? "Reload section" : "Load section";
  $("apSub").textContent = same
    ? ap.grade + " – " + ap.section + " · " + longDate(ap.date)
    : "Step 1: choose a grade and section";
}

// ---------- load / refresh ----------
// The list is always drawn from this device's storage (server copy + changes made here).
function readClass() {
  if (!ap.loaded) return Promise.resolve();
  return StudentStorageInfo.getClassAppointments(ap.date, ap.grade, ap.section).then(function (list) {
    ap.list = list.sort(byCode);
  });
}

// Download the earlier dental history of the whole class, so previous records can be
// reviewed offline on the examination page
function prefetchHistory(grade, section) {
  if (!navigator.onLine) return Promise.resolve();
  return api("/api/history?grade=" + encodeURIComponent(grade) + "&section=" + encodeURIComponent(section))
    .then(function (d) {
      return Promise.all([StudentStorageInfo.cacheVisits(d.visits || []),
                          StudentStorageInfo.cacheAppointments(d.appointments || [])]);
    })
    .catch(function (e) { if (!handleAuthError(e)) console.warn("history download failed", e); });
}

function loadSession() {
  const grade = $("apGrade").value, section = $("apSection").value, date = $("apDate").value;
  // Rule: no appointments without a Grade AND a Section
  if (!grade || !section) { apError("Please select a grade and a section first."); return; }
  if (!date) { apError("Please choose the appointment date."); return; }
  apError("");
  ap.busy = true; updateLoadButton();
  const changed = grade !== ap.grade || section !== ap.section || date !== ap.date;

  const offlineSchedule = function () {
    const roster = placedStudents().filter(function (s) { return s.grade === grade && s.section === section; });
    return StudentStorageInfo.scheduleClass(roster, grade, section, date, currentSchoolYear).then(function () {
      apError(navigator.onLine ? "" : "Offline: the class was scheduled on this device and will upload when online.");
    });
  };
  const online = navigator.onLine
    ? api(APPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "schedule", grade: grade, section: section, date: date })
      }).then(function (data) {
        prefetchHistory(grade, section);
        return StudentStorageInfo.cacheAppointments(data.appointments || []);
      }).catch(function (err) {
        if (isNetworkError(err)) return offlineSchedule();     // no connection after all
        throw err;
      })
    : offlineSchedule();

  online.then(function () {
    ap.grade = grade; ap.section = section; ap.date = date;
    ap.loaded = true;
    if (changed) { ap.last = null; ap.flashUid = null; ab.filter = null; ab.picked = false; }
    return readClass();
  }).then(function () {
    if (!ap.list.length) apError("No students with a student code in " + grade + " – " + section + ".");
    renderSession();
    loadAbsent();
  }).catch(function (err) { if (!handleAuthError(err)) apError(err.message); })
    .finally(function () { ap.busy = false; updateLoadButton(); });
}

// Re-read the class (server when online, then always from this device)
function refreshSession() {
  if (!ap.loaded || ap.busy) return Promise.resolve();
  const q = "?grade=" + encodeURIComponent(ap.grade) + "&section=" + encodeURIComponent(ap.section) +
            "&date=" + encodeURIComponent(ap.date);
  const fetchIt = navigator.onLine
    ? api(APPT_URL + q).then(function (data) { return StudentStorageInfo.cacheAppointments(data.appointments || []); })
        .catch(function (err) { handleAuthError(err); })
    : Promise.resolve();
  return fetchIt.then(readClass).then(renderSession);
}

// ---------- render ----------
function renderSession() {
  updateLoadButton();
  const c = counts();
  const processed = c.Completed + c.Absent;
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
  renderUpNext();
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
  const a = ap.list.find(function (x) { return x.uid === ap.last.uid; });
  if (!a) { ap.last = null; return; }
  box.appendChild(el("span", "", ap.last.text));
  if (a.status === "Absent" && ap.last.canUndo) {
    const undo = el("button", "mini-btn", "Undo absent (mistake)"); undo.type = "button";
    undo.addEventListener("click", function () { undoAbsent(a); });
    box.appendChild(undo);
  }
}

// The next student to examine, with a big Start button
function renderUpNext() {
  const box = $("apCurrent");
  box.innerHTML = "";
  const cur = currentAppt();
  if (!cur) {
    const done = el("div", "ap-done");
    done.appendChild(el("b", "", ap.list.length ? "✓ All students processed" : "No students to see"));
    done.appendChild(el("p", "muted", ap.list.length
      ? "The daily summary below is final. Absent students are listed there."
      : "Register students with a student code in this section first."));
    box.appendChild(done);
    return;
  }
  box.appendChild(el("div", "ap-now", "🔵 Next student"));
  const who = el("div", "ap-who");
  who.appendChild(el("span", "code-badge " + (cur.code_gender || "none"), apCode(cur)));
  who.appendChild(el("h3", "", cur.name || "—"));
  box.appendChild(who);
  box.appendChild(el("p", "muted", cur.status === "Late Arrival"
    ? "🕒 Late arrival – arrived " + fmtTime(cur.arrived_at)
    : "⏳ Waiting" + (cur.extra ? " · extra appointment" : "")));
  const s = studentForAppt(cur);
  const medical = [].concat(s.conditions || [], s.other_conditions ? [s.other_conditions] : []);
  const alerts = [];
  if (s.allergies) alerts.push("Allergy: " + s.allergies);
  if (medical.length) alerts.push("Medical: " + medical.join(", "));
  if (s.medications) alerts.push("Medication: " + s.medications);
  if (alerts.length) box.appendChild(el("div", "ap-alert", "⚠ " + alerts.join(" · ")));
  const start = el("button", "start-btn", "Start examination ▶");
  start.type = "button";
  start.id = "apStart";
  start.addEventListener("click", function () { openExam(cur); });
  box.appendChild(start);
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
    const isCur = cur && cur.uid === a.uid;
    const inQueue = a.status === "Waiting" || a.status === "Late Arrival";
    const row = el("div", "ap-row s-" + a.status.replace(" ", "") + (isCur ? " current" : ""));
    row.dataset.uid = a.uid;
    row.appendChild(el("span", "code-badge " + (a.code_gender || "none"), apCode(a)));
    row.appendChild(el("span", "nm", (a.name || "—") + (a.extra ? " (extra)" : "")));
    const label = isCur ? "🔵 Next" :
                  a.status === "Completed" ? (a.was_absent ? "✓ Completed (late)" : "✓ Completed") :
                  a.status === "Absent" ? "✗ ABSENT" :
                  a.status === "Late Arrival" ? "🕒 Late arrival" : "⏳ Waiting";
    row.appendChild(el("span", "st", label));
    const badge = syncBadge(a);
    if (badge) { badge.textContent = a._sync === "pending" ? "⏳ on device" : badge.textContent; row.appendChild(badge); }
    if (a.status === "Absent") row.appendChild(arrivedButton(a, "mini-btn"));
    if (inQueue) {
      row.appendChild(el("span", "go", "›"));
      row.title = "Open the examination for " + (a.name || "this student");
      row.addEventListener("click", function () { openExam(a); });
    } else {
      row.title = "Open " + (a.name || "student") + "'s personal record";
      row.addEventListener("click", function () {
        ap.listScroll = window.scrollY;
        ap.flashUid = a.uid;
        openRecord(studentForAppt(a), "appointments");
      });
    }
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
  box.appendChild(el("p", "ap-score", "Attendance: " + c.Completed + "/" + c.total));
  if (c.queue) box.appendChild(el("p", "muted", "Not final yet – " + c.queue + " student(s) still waiting."));
  const absents = ap.list.filter(function (a) { return a.status === "Absent"; });
  if (absents.length) {
    const list = el("div", "absent-list");
    list.appendChild(el("b", "", "Absent students:"));
    absents.forEach(function (a) { list.appendChild(el("p", "", "⚠ " + (a.name || "—") + " (" + apCode(a) + ")")); });
    box.appendChild(list);
  }
}

// ---------- the examination page (separate page, Dental.js) ----------
function openExam(appt) {
  if (appt.status !== "Waiting" && appt.status !== "Late Arrival") return;
  ap.listScroll = window.scrollY;               // come back to exactly this spot
  ap.flashUid = appt.uid;
  currentStudent = studentForAppt(appt);
  visitReturnView = "appointments";
  afterVisitSave = function (visit, appointment) {
    const label = apCode(appt) + " " + (appt.name || "");
    ap.last = { uid: appt.uid, text: "✓ " + label + " completed – examination saved to their record" };
    returnToList();
  };
  examAbsentHandler = function (a, notes) { markAbsent(a, notes, true); };
  openVisitForm(null, { appointment: appt });
}

// Back to the list at the same scroll position, row highlighted, statuses updated
function returnToList() {
  show("appointments", true);
  return readClass().then(function () {
    renderSession();
    loadAbsent();
    requestAnimationFrame(function () {
      window.scrollTo(0, ap.listScroll || 0);
      const row = ap.flashUid ? document.querySelector('#apList .ap-row[data-uid="' + ap.flashUid + '"]') : null;
      if (row) { row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash"); }
    });
  });
}

// ---------- status changes (saved on this device, then uploaded) ----------
function markAbsent(appt, notes, fromExam) {
  if (ap.busy) return;
  ap.busy = true;
  StudentStorageInfo.changeAppointment(appt, { status: "Absent", notes: notes || null }, { label: "Marked absent" })
    .then(function () {
      const label = apCode(appt) + " " + (appt.name || "");
      ap.last = { uid: appt.uid, canUndo: true, text: "✗ " + label + " marked ABSENT – listed under Absent Students" };
      showToast(label + " marked absent");
    })
    .catch(function (err) { showToast(err.message); })
    .finally(function () {
      ap.busy = false;
      if (fromExam) returnToList(); else readClass().then(function () { renderSession(); loadAbsent(); });
    });
}

// "Mark as Arrived" button (needs a 2nd tap to confirm, so it can't be pressed by accident)
// The "tap again" state survives a redraw of the list (uploads finishing, auto refresh)
let arrivedConfirm = { uid: null, until: 0 };
function arrivedButton(a, cls) {
  const btn = el("button", cls, "Mark as Arrived"); btn.type = "button";
  btn.title = "The student came late – put them back in the queue for treatment";
  const reset = function () { btn.dataset.confirm = ""; btn.textContent = "Mark as Arrived"; };
  if (arrivedConfirm.uid === a.uid && Date.now() < arrivedConfirm.until) {
    btn.dataset.confirm = "1"; btn.textContent = "Tap again to confirm";
    setTimeout(reset, arrivedConfirm.until - Date.now());
  }
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (btn.dataset.confirm !== "1") {
      btn.dataset.confirm = "1"; btn.textContent = "Tap again to confirm";
      arrivedConfirm = { uid: a.uid, until: Date.now() + 4000 };
      setTimeout(reset, 4000);
      return;
    }
    arrivedConfirm = { uid: null, until: 0 };
    markArrived(a, btn);
  });
  return btn;
}

// Absent -> Late Arrival. Same appointment (no duplicate); the absence stays in the history.
function markArrived(appt, btn) {
  if (ap.busy) return;
  ap.busy = true;
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  StudentStorageInfo.changeAppointment(appt, { status: "Late Arrival" }, { label: "Arrived late" })
    .then(function () {
      const sameClass = ap.loaded && appt.grade === ap.grade && appt.section === ap.section && appt._date === ap.date;
      const label = apCode(appt) + " " + (appt.name || "");
      ap.last = sameClass
        ? { uid: appt.uid, text: "🕒 " + label + " arrived – moved to the front of the queue" }
        : { goto: { grade: appt.grade, section: appt.section },
            text: "🕒 " + label + " arrived (" + appt.grade + " – " + appt.section + ")" };
      showToast(label + " marked as arrived");
      $("abError").textContent = "";
    })
    .catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = "Mark as Arrived"; btn.dataset.confirm = ""; }
      $("abError").textContent = "Could not mark " + apCode(appt) + " as arrived – nothing was changed. " + err.message;
    })
    .finally(function () {
      ap.busy = false;
      readClass().then(function () { if (ap.loaded) renderSession(); return loadAbsent(); });
    });
}

// The dentist pressed Absent by mistake: back to what the student was before
function undoAbsent(appt) {
  if (ap.busy) return;
  ap.busy = true;
  StudentStorageInfo.changeAppointment(appt, { status: "Waiting", undo: true }, { label: "Undo absent" })
    .then(function (rec) {
      ap.last = null;
      showToast(apCode(appt) + " absence undone" + (rec.status === "Late Arrival" ? " (back to late arrival)" : ""));
    })
    .catch(function (err) { apError(err.message); })
    .finally(function () {
      ap.busy = false;
      readClass().then(function () { renderSession(); loadAbsent(); });
    });
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
  const fetchIt = navigator.onLine
    ? api(APPT_URL + "?absent=1&date=" + encodeURIComponent(date))
        .then(function (data) { return StudentStorageInfo.cacheAppointments(data.appointments || []); })
        .catch(function (err) { if (!handleAuthError(err)) console.warn("absent list download failed", err); })
    : Promise.resolve();
  return fetchIt
    .then(function () {
      return StudentStorageInfo.getAppointments(function (a) { return a._date === date && a.status === "Absent"; });
    })
    .then(function (list) {
      ab.list = list;
      ab.date = date;
      renderAbsent();
    })
    .finally(function () { ab.loading = false; });
}

function renderAbsent() {
  $("abDate").textContent = longDate(ab.date);
  $("abTotal").textContent = String(ab.list.length);
  $("abTotal").className = "ab-total" + (ab.list.length ? " has" : "");

  const groups = new Map();
  ab.list.forEach(function (a) {
    const k = classKey(a);
    if (!groups.has(k)) groups.set(k, { grade: a.grade, section: a.section, items: [] });
    groups.get(k).items.push(a);
  });
  const ordered = Array.from(groups.values()).sort(function (x, y) {
    return compareGrades(x.grade, y.grade) || compareSections(x.section, y.section);
  });
  ordered.forEach(function (g) { g.items.sort(byCode); }); // M-1, M-2 ... M-10, then F-1 ...

  if (ab.filter && ab.filter !== "all" && !groups.has(ab.filter)) { ab.filter = null; ab.picked = false; }
  if (!ab.picked) {
    const mine = ap.loaded ? ap.grade + "|" + ap.section : null;
    ab.filter = mine && groups.has(mine) ? mine : "all";
  }

  const chips = $("abFilters");
  chips.innerHTML = "";
  const addChip = function (key, label, n) {
    const c = el("button", "chip" + (ab.filter === key ? " on" : ""), label);
    c.type = "button";
    c.appendChild(el("span", "cnt", "(" + n + ")"));
    c.addEventListener("click", function () { ab.filter = key; ab.picked = true; renderAbsent(); });
    chips.appendChild(c);
  };
  addChip("all", "All sections", ab.list.length);
  ordered.forEach(function (g) { addChip(classKey(g), g.grade + " – " + g.section, g.items.length); });

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

// ---------- personal record: appointment & attendance history (all school years) ----------
function loadApptHistory() {
  const box = $("apptHistory");
  const count = $("apptHistoryCount");
  box.innerHTML = '<p class="muted">Loading...</p>';
  count.textContent = "";
  const s = currentStudent;
  const draw = function () {
    return StudentStorageInfo.getHistory(s.identity_id || null, [s.id]).then(function (h) {
      if (!currentStudent || currentStudent.id !== s.id) return;
      const list = h.appointments;
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
        line("Class", (a.school_year ? "SY " + a.school_year + " · " : "") + a.grade + " – " + a.section);
        line("Status", a.status === "Completed" ? (a.was_absent ? "Present (late arrival)" : "Present")
                     : a.status === "Absent" ? "ABSENT"
                     : a.status === "Late Arrival" ? "Late arrival – waiting for treatment"
                     : "Waiting (not seen yet)");
        if (a.was_absent) {
          line("Attendance", "Marked absent" + (a.absent_at ? " at " + fmtTime(a.absent_at) : "") +
               (a.arrived_at ? " · arrived at " + fmtTime(a.arrived_at) : " · did not arrive"));
        }
        if (a.result) line("Result", a.result);                    // older appointments only
        if (a.notes) line("Dentist notes", a.notes);
        if (a.visit_id || a._visit_uid) line("Exam", "Tooth-map examination recorded (see Visit History)");
        const events = (a.events || []).concat(a._local_events || []);
        if (events.length) {
          line("Status log", events.map(function (e) {
            return fmtTime(e.at) + " " + (e.from || "—") + " → " + e.to + (e.by ? " (" + e.by + ")" : "") + (e.local ? " (this device)" : "");
          }).join(" · "));
        }
        const badge = syncBadge(a);
        if (badge) item.appendChild(badge);
        box.appendChild(item);
      });
    });
  };
  return draw();   // Dental.js downloads the history; draw again when it arrives
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
  StudentStorageInfo.extraAppointment(currentStudent, todayIso(), currentStudent.school_year || currentSchoolYear)
    .then(function () { showToast("Extra appointment added for today"); loadApptHistory(); })
    .catch(function (err) { showToast(err.message); });
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

// After uploads finish (or the history arrives), redraw from this device's storage
function refreshFromStorage() {
  if ($("appointments").style.display === "block") {
    readClass().then(function () { if (ap.loaded) renderSession(); });
    if (!ab.loading) loadAbsent();
  }
  if ($("record").style.display === "block" && currentStudent) loadApptHistory();
}

// Keep the screen in sync with other devices (only while the list page is open)
setInterval(function () {
  if (token && !document.hidden && navigator.onLine && $("appointments").style.display === "block") {
    refreshSession();
    if (!ab.loading) loadAbsent();
  }
}, 20000);
