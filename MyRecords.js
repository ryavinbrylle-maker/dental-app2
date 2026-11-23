// My Dental Record – the student's own page (sign in, then see every check-up online).
// Uses DentalCore.js (tooth map, conditions, DMFT) and DentalRecordPDF.js (download).
// The session is kept in sessionStorage, so it ends when the browser tab is closed.

const PORTAL_URL = "/api/portal";
let studentToken = null;
let data = null;            // { student, verified, hidden_school_years, exams, appointments }

const $ = function (id) { return document.getElementById(id); };
const ICON = {
  check: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  info: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  tooth: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 3C5 3 3.5 5 3.5 7.6c0 2 .8 3.4 1.4 5 .7 2 .8 4.7 1.4 6.6.3 1 .8 1.8 1.6 1.8 1.4 0 1.5-2.3 2-4 .3-1 .6-1.8 1.6-1.8s1.3.8 1.6 1.8c.5 1.7.6 4 2 4 .8 0 1.3-.8 1.6-1.8.6-1.9.7-4.6 1.4-6.6.6-1.6 1.4-3 1.4-5C20.5 5 19 3 16.5 3c-1.8 0-2.8 1-4.5 1S9.3 3 7.5 3Z"/></svg>',
  cal: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  chev: '<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
};

// ---------- small helpers (also used by DentalRecordPDF.js) ----------
function dateOnly(v) {   // same rule as the dentist pages (StudentStorageInfo.dateOnly)
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? s.slice(0, 10) : d.toISOString().slice(0, 10);
}
function longDateText(v) {
  const iso = dateOnly(v);
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
function todayIso() {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function studentCode(s) {
  return s && s.code_gender && s.code_number ? s.code_gender + "-" + s.code_number : "";
}
function readJson(res) {
  return res.text().then(function (body) {
    let d = {};
    try { d = JSON.parse(body); } catch (e) {}
    if (!res.ok) { const err = new Error(d.error || ("Server error " + res.status)); err.status = res.status; throw err; }
    return d;
  });
}
function post(body, withToken) {
  const headers = { "Content-Type": "application/json" };
  if (withToken) headers.Authorization = "Bearer " + studentToken;
  return fetch(PORTAL_URL, { method: "POST", headers: headers, body: JSON.stringify(body) }).then(readJson);
}
function saveToken(t) {
  studentToken = t;
  try { if (t) sessionStorage.setItem("studentToken", t); else sessionStorage.removeItem("studentToken"); } catch (e) {}
}
function setMsg(el, text, kind) { el.textContent = text || ""; el.className = "msg" + (kind ? " " + kind : ""); }
function busy(btn, on, label) {
  btn.disabled = on;
  if (on) { btn.dataset.label = btn.innerHTML; btn.textContent = label || "Please wait…"; }
  else if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
}

// ---------- views ----------
function showView(name) {
  $("authView").hidden = name !== "auth";
  $("homeView").hidden = name !== "home";
  $("loading").hidden = name !== "loading";
  $("signOutBtn").hidden = name !== "home";
  window.scrollTo(0, 0);
}
function showTab(which) {
  const signIn = which === "signin";
  $("signInForm").hidden = !signIn;
  $("setupForm").hidden = signIn;
  $("tabSignIn").classList.toggle("on", signIn); $("tabSignIn").setAttribute("aria-selected", signIn);
  $("tabSetup").classList.toggle("on", !signIn); $("tabSetup").setAttribute("aria-selected", !signIn);
  setMsg($("authMsg"), "");
}
$("tabSignIn").addEventListener("click", function () { showTab("signin"); });
$("tabSetup").addEventListener("click", function () { showTab("setup"); });
document.querySelectorAll(".showPw").forEach(function (box) {
  box.addEventListener("change", function () {
    box.dataset.for.split(",").forEach(function (id) { $(id).type = box.checked ? "text" : "password"; });
  });
});

// ---------- sign in / set-up code ----------
$("signInForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const name = $("siName").value.trim(), birthdate = $("siBirth").value, password = $("siPassword").value;
  if (!name || !birthdate || !password) { setMsg($("authMsg"), "Please fill in your name, birthdate and password.", "bad"); return; }
  const btn = $("signInBtn");
  busy(btn, true, "Signing in…");
  post({ action: "login", name: name, birthdate: birthdate, password: password })
    .then(function (r) { saveToken(r.token); $("siPassword").value = ""; return loadHome(); })
    .catch(function (err) { setMsg($("authMsg"), err.message, "bad"); })
    .finally(function () { busy(btn, false); });
});
$("setupCode").addEventListener("input", function () {
  let v = this.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (v.length > 4) v = v.slice(0, 4) + "-" + v.slice(4);
  this.value = v;
});
$("setupForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const code = $("setupCode").value, birthdate = $("suBirth").value;
  const p1 = $("suPassword").value, p2 = $("suPassword2").value;
  if (code.replace("-", "").length !== 8) { setMsg($("authMsg"), "The set-up code has 8 letters and numbers, e.g. ABCD-EFGH.", "bad"); return; }
  if (!birthdate) { setMsg($("authMsg"), "Please enter your birthdate.", "bad"); return; }
  if (p1.length < 6) { setMsg($("authMsg"), "Make a password with at least 6 characters.", "bad"); return; }
  if (p1 !== p2) { setMsg($("authMsg"), "The two passwords are not the same.", "bad"); return; }
  const btn = $("setupBtn");
  busy(btn, true, "Saving…");
  post({ action: "setup", setup_code: code, birthdate: birthdate, password: p1 })
    .then(function (r) { saveToken(r.token); $("suPassword").value = $("suPassword2").value = ""; return loadHome({ setup: true }); })
    .catch(function (err) { setMsg($("authMsg"), err.message, "bad"); })
    .finally(function () { busy(btn, false); });
});
$("signOutBtn").addEventListener("click", function () {
  post({ action: "logout" }).catch(function () {});   // removes the HttpOnly session cookie
  saveToken(null); data = null;
  showTab("signin");
  showView("auth");
  setMsg($("authMsg"), "You are signed out.", "ok");
});

// ---------- home ----------
function loadHome(flags) {
  showView("loading");
  return fetch(PORTAL_URL, { headers: { Authorization: "Bearer " + studentToken }, cache: "no-store" })
    .then(readJson)
    .then(function (d) { data = d; renderHome(flags || {}); showView("home"); })
    .catch(function (err) {
      if (err.status === 401) { saveToken(null); showView("auth"); setMsg($("authMsg"), "Please sign in again.", "info"); return; }
      showView("auth");
      setMsg($("authMsg"), "Could not load your record: " + err.message, "bad");
    });
}

function banner(kind, title, text) {
  const b = el("div", "banner " + kind);
  b.innerHTML = kind === "ok" ? ICON.check : ICON.info;
  const t = el("div");
  t.appendChild(el("b", "", title));
  if (text) t.appendChild(document.createTextNode(text));
  b.appendChild(t);
  return b;
}

function renderHome(flags) {
  const s = data.student, exams = data.exams || [];
  const params = new URLSearchParams(location.search);
  // banners
  const bx = $("homeBanners"); bx.innerHTML = "";
  if (params.get("welcome")) {
    bx.appendChild(banner("ok", "You're registered! This is your dental record.",
      "After your check-up at the school dental clinic, your results will show here."));
  } else if (flags.setup) {
    bx.appendChild(banner("ok", "Your password is saved.", "Next time, sign in with your name, birthdate and password."));
  }
  if (!data.verified && data.hidden_school_years > 0) {
    bx.appendChild(banner("warn", "Your check-ups from earlier school years are hidden for now.",
      "To keep records private, the school dentist must first confirm it's you. Ask at the dental clinic for a set-up code."));
  }
  if (params.get("welcome") || params.get("returning")) history.replaceState(null, "", location.pathname);

  // profile
  const initials = (s.name || "?").split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();
  $("avatar").textContent = initials;
  $("pName").textContent = s.name || "—";
  const pills = $("pPills"); pills.innerHTML = "";
  [["Code", studentCode(s)], ["Class", [s.grade, s.section].filter(Boolean).join(" – ")], ["School year", s.school_year],
   ["Age", s.age !== null && s.age !== undefined ? String(s.age) : ""]].forEach(function (p) {
    if (!p[1]) return;
    const x = el("span", "pill"); x.appendChild(document.createTextNode(p[0] + ": ")); x.appendChild(el("b", "", p[1])); pills.appendChild(x);
  });

  // stats
  const latest = exams[0];
  const today = todayIso();
  const upcoming = (data.appointments || []).filter(function (a) {
    return a.status === "Waiting" && dateOnly(a.appointment_date) >= today;
  }).sort(function (a, b) { return String(a.appointment_date).localeCompare(String(b.appointment_date)); })[0];
  const lt = latest ? normalizeTeeth(latest.teeth) : null;
  const c = lt ? dmftCounts(lt) : null;
  const st = $("stats"); st.innerHTML = "";
  [["Check-ups", String(exams.length), exams.length === 1 ? "examination" : "examinations"],
   ["Last check-up", latest ? longDateText(latest.visit_date) : "None yet", latest ? (latest.school_year ? "SY " + latest.school_year : "") : "Results appear after your check-up"],
   ["Teeth to treat", lt ? String(problemCountToTreat(lt)) : "—", lt ? "at your last check-up" : ""],
   ["Next appointment", upcoming ? longDateText(upcoming.appointment_date) : "None", upcoming ? "Please come to the clinic" : "Nothing scheduled"]
  ].forEach(function (x) {
    const d = el("div", "stat"); d.appendChild(el("span", "", x[0])); d.appendChild(el("b", "", x[1])); if (x[2]) d.appendChild(el("small", "", x[2])); st.appendChild(d);
  });

  // latest check-up
  const lc = $("latestCard"); lc.innerHTML = "";
  const h = el("h2"); h.innerHTML = ICON.tooth; h.appendChild(document.createTextNode("Latest check-up")); lc.appendChild(h);
  if (!latest) {
    const e = el("div", "empty"); e.innerHTML = ICON.tooth;
    e.appendChild(el("p", "", "No dental check-ups yet. When the school dentist examines you, your tooth chart and results will appear here."));
    lc.appendChild(e);
  } else {
    lc.appendChild(examBody(latest, true));
  }

  // all check-ups by school year
  const hx = $("history"); hx.innerHTML = "";
  if (!exams.length) {
    hx.appendChild(el("p", "muted", "No check-ups yet."));
  } else {
    let year = null;
    exams.forEach(function (v, i) {
      if (v.school_year !== year) {
        year = v.school_year;
        hx.appendChild(el("div", "year-head", "School year " + (year || "?") + (v.grade ? "  ·  " + [v.grade, v.section].filter(Boolean).join(" – ") : "")));
      }
      const d = el("details", "exam");
      const sum = el("summary");
      const left = el("div");
      left.appendChild(el("b", "", longDateText(v.visit_date)));
      const t = normalizeTeeth(v.teeth), n = problemCountToTreat(t);
      left.appendChild(el("div", "muted small", n ? n + (n === 1 ? " tooth" : " teeth") + " to treat" : "No problems found"));
      sum.appendChild(left);
      const right = el("span"); right.innerHTML = ICON.chev; sum.appendChild(right);
      d.appendChild(sum);
      const body = el("div", "body"); body.appendChild(examBody(v, false)); d.appendChild(body);
      if (i === 0 && exams.length === 1) d.open = false;
      hx.appendChild(d);
    });
  }

  // appointments
  const ax = $("appts"); ax.innerHTML = "";
  const list = data.appointments || [];
  if (!list.length) {
    const e = el("div", "empty"); e.innerHTML = ICON.cal; e.appendChild(el("p", "", "No appointments yet.")); ax.appendChild(e);
  } else {
    list.forEach(function (a) {
      const row = el("div", "appt");
      const left = el("div");
      left.appendChild(el("div", "when", longDateText(a.appointment_date)));
      left.appendChild(el("div", "muted small", [a.grade, a.section].filter(Boolean).join(" – ") + (a.school_year ? " · SY " + a.school_year : "")));
      row.appendChild(left);
      const s2 = apptStatus(a, today);
      row.appendChild(el("span", "tag " + s2[1], s2[0]));
      ax.appendChild(row);
    });
  }
}

// teeth with something the dentist needs to treat (decay, extraction, fracture, root fragment…)
const TO_TREAT = ["Decayed", "Carious tooth", "Indicated for extraction", "Root Fragment", "Fractured", "Temporary Filled", "Impacted"];
function problemCountToTreat(teeth) {
  return Object.keys(teeth).filter(function (k) {
    return teeth[k].conditions.some(function (c) { return TO_TREAT.includes(c); });
  }).length;
}
function apptStatus(a, today) {
  if (a.status === "Completed") return [a.was_absent ? "Checked (arrived late)" : "Checked", "ok"];
  if (a.status === "Absent") return ["Absent", "bad"];
  if (a.status === "Late Arrival") return ["Arrived late", "warn"];
  return dateOnly(a.appointment_date) >= today ? ["Scheduled", "wait"] : ["Not done", "warn"];
}

// One examination: tooth chart(s), findings, DMFT, dentist notes
function examBody(v, withHead) {
  const box = el("div");
  const teeth = normalizeTeeth(v.teeth);
  if (withHead) {
    const head = el("div", "exam-head");
    head.appendChild(el("b", "", longDateText(v.visit_date)));
    head.appendChild(el("span", "muted", [v.school_year ? "SY " + v.school_year : "", [v.grade, v.section].filter(Boolean).join(" – ")].filter(Boolean).join("  ·  ")));
    box.appendChild(head);
  }
  const dents = ["Permanent", "Primary"].filter(function (d) { return hasAny(teeth, d); });
  if (!dents.length) box.appendChild(el("p", "muted", "No teeth were recorded in this check-up."));
  dents.forEach(function (d) {
    if (dents.length > 1) box.appendChild(el("div", "dent-label", d + " teeth"));
    const sc = el("div", "teeth-scroll");
    sc.appendChild(toothMap(teeth, { dentition: d }));
    box.appendChild(sc);
  });
  // findings
  const dl = el("dl", "findings");
  let any = false;
  CONDITIONS.forEach(function (cnd) {
    const nums = Object.keys(teeth).filter(function (n) { return teeth[n].conditions.includes(cnd); }).sort();
    if (!nums.length) return;
    any = true;
    const dt = el("dt"); const dot = el("span", "dot"); dot.style.background = COND_COLOR[cnd];
    dt.appendChild(dot); dt.appendChild(document.createTextNode(cnd + " (" + nums.length + ")"));
    dl.appendChild(dt); dl.appendChild(el("dd", "", (nums.length === 1 ? "Tooth " : "Teeth ") + nums.join(", ")));
  });
  const sound = Object.keys(teeth).filter(function (n) { return teeth[n].conditions[0] === "Sound"; }).length;
  if (sound) {
    const dt = el("dt"); dt.appendChild(el("span", "dot sound")); dt.appendChild(document.createTextNode("Healthy (Sound)"));
    dl.appendChild(dt); dl.appendChild(el("dd", "", sound + (sound === 1 ? " tooth" : " teeth")));
  }
  const c = dmftCounts(teeth);
  if (dents.length) {
    dl.appendChild(el("dt", "", "DMFT score"));
    dl.appendChild(el("dd", "", (c.d + c.m + c.f) + "  (Decayed " + c.d + " · Missing " + c.m + " · Filled " + c.f + ")"));
  }
  if (any || sound || dents.length) box.appendChild(dl);
  Object.keys(teeth).sort().forEach(function (n) {
    if (teeth[n].note) box.appendChild(el("p", "muted small", "Note for tooth " + n + ": " + teeth[n].note));
  });
  if (v.exam_notes) {
    const nb = el("div", "notes"); nb.appendChild(el("b", "", "Dentist's notes")); nb.appendChild(document.createTextNode(v.exam_notes));
    box.appendChild(nb);
  }
  return box;
}

// ---------- PDF ----------
$("pdfBtn").addEventListener("click", function () {
  if (!data) return;
  const btn = this;
  try {
    const bytes = DentalRecordPDF.build({ student: data.student, exams: data.exams || [], schoolYear: data.student.school_year });
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = DentalRecordPDF.fileName(data.student);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  } catch (err) {
    console.error(err);
    btn.textContent = "Could not make the PDF";
  }
});

// ---------- change password ----------
$("pwBtn").addEventListener("click", function () {
  $("pwForm").reset(); setMsg($("pwMsg"), "");
  $("pwDialog").hidden = false; $("pwCurrent").focus();
});
$("pwCancel").addEventListener("click", function () { $("pwDialog").hidden = true; });
$("pwDialog").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("pwDialog").hidden = true; });
$("pwForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const cur = $("pwCurrent").value, p1 = $("pwNew").value, p2 = $("pwNew2").value;
  if (p1.length < 6) { setMsg($("pwMsg"), "Make a password with at least 6 characters.", "bad"); return; }
  if (p1 !== p2) { setMsg($("pwMsg"), "The two new passwords are not the same.", "bad"); return; }
  const btn = $("pwSave");
  busy(btn, true, "Saving…");
  post({ action: "password", current: cur, password: p1 }, true)
    .then(function (r) {
      saveToken(r.token);
      setMsg($("pwMsg"), "Password changed.", "ok");
      setTimeout(function () { $("pwDialog").hidden = true; }, 900);
    })
    .catch(function (err) { setMsg($("pwMsg"), err.message, "bad"); })
    .finally(function () { busy(btn, false); });
});

// ---------- start ----------
(function start() {
  try { studentToken = sessionStorage.getItem("studentToken"); } catch (e) {}
  const params = new URLSearchParams(location.search);
  if (studentToken) { loadHome(); return; }
  showTab("signin");
  showView("auth");
  if (params.get("returning")) {
    setMsg($("authMsg"), "You're registered! You already have an online account from before – sign in with the password you made then. Forgot it? Ask the school dentist for a set-up code.", "info");
    history.replaceState(null, "", location.pathname);
  }
})();
