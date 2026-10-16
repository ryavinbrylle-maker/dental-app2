// StudentStorageInfo — offline storage for the dentist's device.
// ---------------------------------------------------------------------------
// Everything the dentist saves goes HERE FIRST (IndexedDB, a database inside the
// browser that survives refreshes and restarts), and is confirmed immediately.
// A queue ("outbox") then uploads the changes in batches to /api/sync whenever
// there is internet. Each change has a unique op_id, so retries never create
// duplicates; a change is marked "synced" only after the server confirms it.
//
// Stores (IndexedDB database "StudentStorageInfo"):
//   meta          key/value (school year, last download times)
//   students      roster of the active school year (from the server)
//   appointments  appointments (server copies + ones made on this device)
//   visits        dental examinations (server copies + ones made on this device)
//   outbox        changes waiting to upload: pending | syncing | synced | failed | conflict
//   archives      SchoolYearDentalRecords copies kept for offline viewing
//
// Conflict policy (also enforced by the server):
//   • New examinations are always separate records – they can never conflict.
//   • Appointment changes carry the status this device saw. If another device changed
//     the appointment first, the server keeps its version and this change is shown as
//     a "conflict" for the dentist to resolve (discard it, or keep both for exams).
//   • Nothing is ever silently overwritten.
// ---------------------------------------------------------------------------
const StudentStorageInfo = (function () {
  const DB_NAME = "StudentStorageInfo";
  const DB_VERSION = 1;
  const STORES = { meta: "key", students: "id", appointments: "uid", visits: "uid", outbox: "op_id", archives: "key" };
  const BATCH = 20;
  const OPEN_STATES = ["pending", "syncing", "failed", "conflict"];

  let dbPromise = null;
  let memory = null;            // fallback when IndexedDB is not available (e.g. private mode)
  let cfg = { getToken: function () { return ""; }, onAuthError: null, onChange: null };
  let syncing = false;
  let lastError = "";
  const listeners = [];
  let seqCounter = 0;

  // ---------- low-level storage ----------
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!("indexedDB" in window)) { useMemory(); resolve(null); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { useMemory(); resolve(null); return; }
      req.onupgradeneeded = function () {
        const db = req.result;
        Object.keys(STORES).forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: STORES[name] });
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { useMemory(); resolve(null); };
    });
    return dbPromise;
  }
  function useMemory() {
    if (memory) return;
    memory = {};
    Object.keys(STORES).forEach(function (n) { memory[n] = new Map(); });
    lastError = "This browser can't keep records offline (private window?). Records still upload when online.";
  }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  // Run fn(api) inside ONE transaction over the given stores -> all-or-nothing
  function run(storeNames, mode, fn) {
    return open().then(function (db) {
      if (!db) {
        const mem = {
          get: function (s, k) { return Promise.resolve(clone(memory[s].get(k))); },
          all: function (s) { return Promise.resolve(Array.from(memory[s].values()).map(clone)); },
          put: function (s, v) { memory[s].set(v[STORES[s]], clone(v)); return Promise.resolve(); },
          del: function (s, k) { memory[s].delete(k); return Promise.resolve(); },
          clear: function (s) { memory[s].clear(); return Promise.resolve(); }
        };
        return Promise.resolve(fn(mem));
      }
      return new Promise(function (resolve, reject) {
        const t = db.transaction(storeNames, mode);
        let result;
        const wrap = function (r) {
          return new Promise(function (res, rej) {
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { rej(r.error); };
          });
        };
        const api = {
          get: function (s, k) { return wrap(t.objectStore(s).get(k)); },
          all: function (s) { return wrap(t.objectStore(s).getAll()); },
          put: function (s, v) { return wrap(t.objectStore(s).put(v)); },
          del: function (s, k) { return wrap(t.objectStore(s).delete(k)); },
          clear: function (s) { return wrap(t.objectStore(s).clear()); }
        };
        Promise.resolve(fn(api)).then(function (r) { result = r; }, function (e) {
          try { t.abort(); } catch (x) { /* already finished */ }
          reject(e);
        });
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error("Saving on this device failed")); };
      });
    });
  }

  // ---------- helpers ----------
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    let s = "";
    for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }
  function nextSeq() { seqCounter = (seqCounter + 1) % 1000; return Date.now() * 1000 + seqCounter; }
  function nowIso() { return new Date().toISOString(); }
  function dateOnly(v) {
    if (!v) return "";
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return isNaN(d) ? s.slice(0, 10) : d.toISOString().slice(0, 10);
  }
  function keyOf(row) { return row.client_uid || ("srv-" + row.id); }
  function prepAppt(row) { row.uid = row.uid || keyOf(row); row._date = dateOnly(row.appointment_date); return row; }
  function prepVisit(row) { row.uid = row.uid || keyOf(row); row._date = dateOnly(row.visit_date); return row; }
  function openOpsFor(ops, uid) {
    return ops.filter(function (o) { return OPEN_STATES.includes(o.status) && (o.record_keys || []).includes(uid); });
  }
  function syncStateFor(ops, uid) {
    const open = openOpsFor(ops, uid);
    if (open.some(function (o) { return o.status === "conflict"; })) return "conflict";
    if (open.some(function (o) { return o.status === "failed"; })) return "failed";
    if (open.length) return "pending";
    return "synced";
  }
  function emit() {
    status().then(function (s) {
      listeners.forEach(function (fn) { try { fn(s); } catch (e) { console.error(e); } });
    });
  }
  function codeOf(s) { return s && s.code_gender ? s.code_gender + "-" + s.code_number : ""; }

  // ---------- caching server data (never overwrites changes still waiting to upload) ----------
  function mergeServerRows(storeName, rows, prep, naturalMatch) {
    return run([storeName, "outbox"], "readwrite", function (db) {
      return Promise.all([db.all(storeName), db.all("outbox")]).then(function (res) {
        const local = res[0], ops = res[1];
        const byUid = new Map(local.map(function (r) { return [r.uid, r]; }));
        const jobs = [];
        rows.forEach(function (raw) {
          const row = prep(Object.assign({}, raw));
          const mine = byUid.get(row.uid) ||
            local.find(function (l) { return l.id && l.id === row.id; }) ||
            (naturalMatch ? local.find(function (l) { return !l.id && naturalMatch(l, row); }) : null);
          if (mine && openOpsFor(ops, mine.uid).length) {
            // a change made on this device is still waiting: keep it, only learn the server id
            mine.id = row.id;
            mine._server = row;
            mine._sync = syncStateFor(ops, mine.uid);
            jobs.push(db.put(storeName, mine));
          } else {
            // server copy wins, but fields it did not send (e.g. the student's name and code,
            // which some downloads leave out) are kept from this device's copy
            const merged = mine ? Object.assign({}, mine, row) : row;
            merged.uid = mine ? mine.uid : row.uid;      // keep the device's key for the same record
            delete merged._server;
            merged._sync = "synced";
            jobs.push(db.put(storeName, merged));
          }
        });
        return Promise.all(jobs);
      });
    });
  }
  const sameAppt = function (l, row) {
    return l.student_id === row.student_id && l._date === row._date && !l.extra && !row.extra;
  };

  function cacheStudents(list, schoolYear) {
    return run(["students", "meta"], "readwrite", function (db) {
      return db.clear("students").then(function () {
        return Promise.all(list.map(function (s) { return db.put("students", s); }).concat([
          db.put("meta", { key: "school_year", value: schoolYear }),
          db.put("meta", { key: "students_at", value: nowIso() })
        ]));
      });
    });
  }
  function getStudents() {
    return run(["students", "meta"], "readonly", function (db) {
      return Promise.all([db.all("students"), db.get("meta", "school_year"), db.get("meta", "students_at")]);
    }).then(function (r) {
      return { students: r[0], school_year: r[1] ? r[1].value : null, saved_at: r[2] ? r[2].value : null };
    });
  }
  function cacheAppointments(rows) { return mergeServerRows("appointments", rows, prepAppt, sameAppt); }
  function cacheVisits(rows) { return mergeServerRows("visits", rows, prepVisit, null); }

  function getAppointments(filter) {
    return run(["appointments"], "readonly", function (db) { return db.all("appointments"); })
      .then(function (list) { return list.filter(filter); });
  }
  function getClassAppointments(date, grade, section) {
    return getAppointments(function (a) { return a._date === date && a.grade === grade && a.section === section; });
  }
  function getVisits(filter) {
    return run(["visits"], "readonly", function (db) { return db.all("visits"); })
      .then(function (list) { return list.filter(filter); });
  }
  // All examinations + appointments of one student identity (all school years), newest first
  function getHistory(identityId, studentIds) {
    const ids = new Set((studentIds || []).map(Number));
    const match = function (r) { return (identityId && r.identity_id === identityId) || ids.has(Number(r.student_id)); };
    const newestFirst = function (a, b) {
      return String(b._date).localeCompare(String(a._date)) || String(b.created_at || "").localeCompare(String(a.created_at || ""));
    };
    return Promise.all([getVisits(match), getAppointments(match)]).then(function (r) {
      return { visits: r[0].sort(newestFirst), appointments: r[1].sort(newestFirst) };
    });
  }

  // ---------- local changes (record + queued upload in ONE transaction) ----------
  function saveLocal(storeName, records, op) {
    op.op_id = op.op_id || newId();
    op.seq = nextSeq();
    op.status = "pending";
    op.attempts = 0;
    op.created_at = op.updated_at = nowIso();
    op.record_keys = records.map(function (r) { return r.uid; });
    return run([storeName, "outbox"], "readwrite", function (db) {
      return Promise.all(records.map(function (r) {
        r._sync = "pending";
        r._saved_at = nowIso();
        return db.put(storeName, r);
      }).concat([db.put("outbox", op)]));
    }).then(function () {
      emit();
      setTimeout(syncNow, 0);   // try to upload straight away (fine if offline)
      return { op: op, records: records };
    });
  }

  // Schedule a class on this device (works offline): one Waiting appointment per student
  function scheduleClass(roster, grade, section, date, schoolYear) {
    return getClassAppointments(date, grade, section).then(function (existing) {
      const have = new Set(existing.filter(function (a) { return !a.extra; }).map(function (a) { return a.student_id; }));
      const recs = roster.filter(function (s) { return !have.has(s.id); }).map(function (s) {
        const uid = newId();
        return prepAppt({
          uid: uid, client_uid: uid, id: null, student_id: s.id, appointment_date: date, grade: grade, section: section,
          school_year: schoolYear, status: "Waiting", extra: false, was_absent: false, notes: null,
          name: s.name, code_gender: s.code_gender, code_number: s.code_number, identity_id: s.identity_id,
          allergies: s.allergies, conditions: s.conditions, other_conditions: s.other_conditions,
          medications: s.medications, created_at: nowIso()
        });
      });
      if (!recs.length) return { records: [] };
      return saveLocal("appointments", recs, {
        type: "appt.schedule",
        payload: { grade: grade, section: section, date: date,
                   items: recs.map(function (r) { return { student_id: r.student_id, client_uid: r.client_uid }; }) },
        summary: { school_year: schoolYear, grade: grade, section: section,
                   label: "Scheduled " + recs.length + " student(s)" }
      });
    });
  }

  // Same transition rules as the server (api/_appt.js), applied on the device first
  function changeAppointment(rec, change, info) {
    const before = rec.status;
    const status = change.status;
    const inQueue = before === "Waiting" || before === "Late Arrival";
    let target = status;
    if (change.undo) target = rec._before_absent === "Late Arrival" ? "Late Arrival" : "Waiting";
    const ok = (inQueue && (status === "Completed" || status === "Absent")) ||
               (before === "Absent" && status === "Late Arrival") ||
               (before === "Absent" && status === "Waiting" && change.undo) ||
               (before === "Completed" && status === "Completed");
    if (!ok) return Promise.reject(new Error("This appointment is already marked " + before + "."));
    const r = clone(rec);
    const now = nowIso();
    if (status === "Absent") { r._before_absent = before; r.was_absent = true; r.absent_at = r.absent_at || now; r.finished_at = now; }
    if (status === "Late Arrival") { r.arrived_at = now; r.finished_at = null; }
    if (change.undo && target === "Waiting") { r.was_absent = false; r.absent_at = null; r.finished_at = null; }
    if (change.undo && target === "Late Arrival") { r.finished_at = null; }
    if (status === "Completed") {
      r.finished_at = before === "Completed" ? r.finished_at : now;
      if (change.visit_uid) r._visit_uid = change.visit_uid;
    }
    if (status === "Completed" || status === "Absent") {
      const notes = change.notes || null;
      r.notes = inQueue && rec.notes ? [rec.notes, notes].filter(Boolean).join("\n") : notes;
    }
    r.status = target;
    r._local_events = (r._local_events || []).concat([{ from: before, to: target, at: now, local: true }]);
    return saveLocal("appointments", [r], {
      type: "appt.update",
      payload: {
        ref: { id: rec.id || null, client_uid: rec.client_uid || null, student_id: rec.student_id,
               date: rec._date, extra: !!rec.extra },
        base_status: before, status: status, undo: !!change.undo, notes: change.notes || null,
        visit_ref: change.visit_uid ? { client_uid: change.visit_uid, id: change.visit_id || null } : null
      },
      summary: Object.assign({ school_year: rec.school_year, grade: rec.grade, section: rec.section,
                               student_name: rec.name, code: codeOf(rec), label: before + " → " + target }, info || {})
    }).then(function (res) { return res.records[0]; });
  }

  function extraAppointment(student, date, schoolYear) {
    const uid = newId();
    const rec = prepAppt({
      uid: uid, client_uid: uid, id: null, student_id: student.id, appointment_date: date, grade: student.grade,
      section: student.section, school_year: schoolYear || student.school_year, status: "Waiting", extra: true,
      name: student.name, code_gender: student.code_gender, code_number: student.code_number,
      identity_id: student.identity_id, created_at: nowIso()
    });
    return saveLocal("appointments", [rec], {
      type: "appt.extra", payload: { client_uid: uid, student_id: student.id, date: date },
      summary: { school_year: rec.school_year, grade: rec.grade, section: rec.section, student_name: student.name,
                 code: codeOf(student), label: "Extra appointment" }
    }).then(function (res) { return res.records[0]; });
  }

  // New examination: ALWAYS a new record (previous examinations are never overwritten)
  function createVisit(student, data) {
    const uid = newId();
    const rec = prepVisit({
      uid: uid, client_uid: uid, id: null, student_id: student.id, identity_id: student.identity_id,
      school_year: student.school_year, grade: student.grade, section: student.section,
      visit_date: data.visit_date, teeth: data.teeth, exam_notes: data.exam_notes || null,
      created_at: nowIso(), updated_at: null, created_by: "this device"
    });
    return saveLocal("visits", [rec], {
      type: "visit.create",
      payload: { client_uid: uid, student_id: student.id, visit_date: data.visit_date, teeth: data.teeth,
                 exam_notes: data.exam_notes || null },
      summary: { school_year: student.school_year, grade: student.grade, section: student.section,
                 student_name: student.name, code: codeOf(student), label: "New examination" }
    }).then(function (res) { return res.records[0]; });
  }

  function updateVisit(rec, data, student) {
    const r = clone(rec);
    r.teeth = data.teeth;
    r.exam_notes = data.exam_notes || null;
    return saveLocal("visits", [r], {
      type: "visit.update",
      payload: { ref: { id: rec.id || null, client_uid: rec.client_uid || null },
                 base_updated_at: rec.updated_at || null, teeth: data.teeth, exam_notes: data.exam_notes || null },
      summary: { school_year: rec.school_year, grade: rec.grade, section: rec.section,
                 student_name: student ? student.name : "", code: codeOf(student), label: "Edited examination" }
    }).then(function (res) { return res.records[0]; });
  }

  // ---------- upload (sync) ----------
  function allOps() { return run(["outbox"], "readonly", function (db) { return db.all("outbox"); }); }

  function applyResults(sent, results) {
    return run(["appointments", "visits", "outbox"], "readwrite", function (db) {
      return Promise.all([db.all("outbox"), db.all("appointments"), db.all("visits")]).then(function (res) {
        const ops = res[0], appts = res[1], visits = res[2];
        const byId = new Map(ops.map(function (o) { return [o.op_id, o]; }));
        const touched = new Set();
        const jobs = [];
        let stop = false;
        sent.forEach(function (o) {
          const r = results.find(function (x) { return x.op_id === o.op_id; });
          const op = byId.get(o.op_id);
          if (!op) return;
          op.updated_at = nowIso();
          (op.record_keys || []).forEach(function (k) { touched.add(k); });
          if (!r || r.retry) {
            op.status = "pending"; op.attempts++; op.error = r ? r.error : "No answer from the server"; stop = true;
          } else if (r.ok) {
            op.status = "synced"; op.synced_at = nowIso(); op.error = null;
            if (r.visit) {
              const local = visits.find(function (v) { return (op.record_keys || []).includes(v.uid); });
              const merged = prepVisit(Object.assign({}, r.visit, {
                uid: local ? local.uid : keyOf(r.visit),
                identity_id: (local && local.identity_id) || r.visit.identity_id
              }));
              jobs.push(db.put("visits", merged));
              const ix = visits.findIndex(function (v) { return v.uid === merged.uid; });
              if (ix >= 0) visits[ix] = merged; else visits.push(merged);
            }
            if (r.appointment) {
              const local = appts.find(function (a) { return (op.record_keys || []).includes(a.uid); });
              if (local) {
                const later = openOpsFor(ops, local.uid).filter(function (x) { return x.op_id !== op.op_id; });
                if (later.length) local.id = r.appointment.id;            // newer local change still waiting
                else Object.assign(local, r.appointment, { uid: local.uid, _local_events: [] });
                prepAppt(local);
                jobs.push(db.put("appointments", local));
              }
            }
            if (r.appointments) {
              // a scheduled class: learn the server ids of this device's appointments
              r.appointments.forEach(function (sa) {
                const row = prepAppt(Object.assign({}, sa));
                const local = appts.find(function (a) { return a.uid === row.uid; }) ||
                              appts.find(function (a) { return a.id && a.id === row.id; }) ||
                              appts.find(function (a) { return !a.id && sameAppt(a, row); });
                if (local) {
                  local.id = row.id;
                  if (!openOpsFor(ops, local.uid).some(function (x) { return x.op_id !== op.op_id; })) {
                    Object.assign(local, row, { uid: local.uid });
                  }
                  jobs.push(db.put("appointments", local));
                } else {
                  row._sync = "synced";
                  jobs.push(db.put("appointments", row));
                  appts.push(row);
                }
              });
            }
          } else if (r.conflict) {
            op.status = "conflict"; op.error = r.error; op.server = r.appointment || r.visit || null;
          } else {
            op.status = "failed"; op.error = r.error || "Upload refused"; op.attempts++;
          }
          jobs.push(db.put("outbox", op));
        });
        // recompute each record's badge
        touched.forEach(function (k) {
          const st = syncStateFor(ops, k);
          const a = appts.find(function (x) { return x.uid === k; });
          if (a) { a._sync = st; jobs.push(db.put("appointments", a)); }
          const v = visits.find(function (x) { return x.uid === k; });
          if (v) { v._sync = st; jobs.push(db.put("visits", v)); }
        });
        return Promise.all(jobs).then(function () { return stop; });
      });
    });
  }

  function syncNow() {
    if (syncing) return Promise.resolve(false);
    if (!navigator.onLine) { emit(); return Promise.resolve(false); }
    const token = cfg.getToken();
    if (!token) return Promise.resolve(false);
    syncing = true;
    emit();
    let changed = false;
    const loop = function () {
      return allOps().then(function (ops) {
        const batch = ops.filter(function (o) { return o.status === "pending"; })
          .sort(function (a, b) { return a.seq - b.seq; }).slice(0, BATCH);
        if (!batch.length) return null;
        return run(["outbox"], "readwrite", function (db) {
          return Promise.all(batch.map(function (o) { o.status = "syncing"; return db.put("outbox", o); }));
        }).then(function () {
          emit();
          return fetch("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({ ops: batch.map(function (o) { return { op_id: o.op_id, type: o.type, payload: o.payload }; }) })
          }).then(function (res) {
            return res.text().then(function (t) {
              let data = {};
              try { data = JSON.parse(t); } catch (e) { /* not JSON */ }
              if (res.status === 401) { const e = new Error(data.error || "Login expired"); e.auth = true; throw e; }
              if (!res.ok || !Array.isArray(data.results)) throw new Error(data.error || ("Server error " + res.status));
              return data.results;
            });
          }).then(function (results) {
            changed = true;
            lastError = "";
            return applyResults(batch, results).then(function (stop) { return stop ? null : loop(); });
          });
        }).catch(function (err) {
          // network down / server busy / login expired: put the batch back, nothing is lost
          lastError = err.auth ? "Log in again to upload."
                    : (/fetch|network/i.test(err.message) ? "No connection to the server." : err.message);
          return run(["outbox"], "readwrite", function (db) {
            return Promise.all(batch.map(function (o) {
              o.status = "pending"; o.error = lastError; o.attempts++;
              return db.put("outbox", o);
            }));
          }).then(function () { if (err.auth && cfg.onAuthError) cfg.onAuthError(); return null; });
        });
      });
    };
    return loop().then(function () {
      syncing = false;
      emit();
      if (changed && cfg.onChange) cfg.onChange();
      return pruneSynced().then(function () { return changed; });
    }, function (e) { syncing = false; console.error(e); emit(); return false; });
  }

  // Synced changes are kept 14 days as a receipt, then removed (the records themselves stay)
  function pruneSynced() {
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    return run(["outbox"], "readwrite", function (db) {
      return db.all("outbox").then(function (ops) {
        return Promise.all(ops.filter(function (o) {
          return (o.status === "synced" || o.status === "discarded") && new Date(o.updated_at).getTime() < cutoff;
        }).map(function (o) { return db.del("outbox", o.op_id); }));
      });
    });
  }

  // After a restart, uploads that were cut off are simply tried again (the server ignores repeats)
  function recoverInterrupted() {
    return run(["outbox"], "readwrite", function (db) {
      return db.all("outbox").then(function (ops) {
        return Promise.all(ops.filter(function (o) { return o.status === "syncing"; })
          .map(function (o) { o.status = "pending"; return db.put("outbox", o); }));
      });
    });
  }

  function retry(opId) {
    return run(["outbox"], "readwrite", function (db) {
      return db.get("outbox", opId).then(function (o) {
        if (o) { o.status = "pending"; o.error = null; return db.put("outbox", o); }
      });
    }).then(function () { emit(); return syncNow(); });
  }

  // Drop a change that could not be applied. For a new examination this deletes the
  // unsent copy on this device, so the screen asks for confirmation first.
  function discard(opId) {
    return run(["outbox", "visits", "appointments"], "readwrite", function (db) {
      return Promise.all([db.get("outbox", opId), db.all("outbox"), db.all("visits"), db.all("appointments")]).then(function (r) {
        const op = r[0], ops = r[1];
        if (!op) return null;
        op.status = "discarded";
        op.updated_at = nowIso();
        const after = ops.map(function (o) { return o.op_id === opId ? op : o; });
        const jobs = [db.put("outbox", op)];
        (op.record_keys || []).forEach(function (k) {
          const v = r[2].find(function (x) { return x.uid === k; });
          const a = r[3].find(function (x) { return x.uid === k; });
          if (op.type === "visit.create" && v && !v.id) { jobs.push(db.del("visits", k)); return; }
          if ((op.type === "appt.schedule" || op.type === "appt.extra") && a && !a.id) { jobs.push(db.del("appointments", k)); return; }
          const st = syncStateFor(after, k);
          if (a) {
            const server = op.server || a._server;              // show the server's version again
            const restored = server ? prepAppt(Object.assign({}, a, server, { uid: a.uid })) : a;
            restored._sync = st;
            jobs.push(db.put("appointments", restored));
          }
          if (v) {
            const restored = op.server ? prepVisit(Object.assign({}, v, op.server, { uid: v.uid })) : v;
            restored._sync = st;
            jobs.push(db.put("visits", restored));
          }
        });
        return Promise.all(jobs);
      });
    }).then(function () { emit(); if (cfg.onChange) cfg.onChange(); });
  }

  // Conflict on an edited examination: keep both – save this device's version as a NEW exam
  function keepBothVisit(opId) {
    return run(["outbox", "visits"], "readonly", function (db) {
      return Promise.all([db.get("outbox", opId), db.all("visits")]);
    }).then(function (r) {
      const op = r[0];
      if (!op || op.type !== "visit.update") return null;
      const v = r[1].find(function (x) { return (op.record_keys || []).includes(x.uid); });
      const student = { id: v.student_id, identity_id: v.identity_id, school_year: v.school_year,
                        grade: v.grade, section: v.section, name: op.summary.student_name };
      return discard(opId).then(function () {
        return createVisit(student, { visit_date: v._date, teeth: op.payload.teeth, exam_notes: op.payload.exam_notes });
      });
    });
  }

  function status() {
    return allOps().then(function (ops) {
      const c = { pending: 0, syncing: 0, failed: 0, conflict: 0, synced: 0 };
      ops.forEach(function (o) { if (c[o.status] !== undefined) c[o.status]++; });
      return { counts: c, ops: ops, online: navigator.onLine, syncing: syncing, error: lastError, memoryOnly: !!memory };
    });
  }

  // Privacy: on log out, wipe this device's copies – but NEVER changes still waiting to upload
  function clearCache() {
    return allOps().then(function (ops) {
      const waiting = ops.some(function (o) { return OPEN_STATES.includes(o.status); });
      if (waiting) return false;
      return run(Object.keys(STORES), "readwrite", function (db) {
        return Promise.all(Object.keys(STORES).map(function (s) { return db.clear(s); }));
      }).then(function () { emit(); return true; });
    });
  }

  // Remove a server-deleted record from this device (only when nothing is waiting to upload for it)
  function removeLocal(storeName, uid) {
    return run([storeName, "outbox"], "readwrite", function (db) {
      return db.all("outbox").then(function (ops) {
        if (openOpsFor(ops, uid).length) return null;
        return db.del(storeName, uid);
      });
    });
  }

  function getMeta(key) {
    return run(["meta"], "readonly", function (db) { return db.get("meta", key); }).then(function (r) { return r ? r.value : null; });
  }
  function setMeta(key, value) { return run(["meta"], "readwrite", function (db) { return db.put("meta", { key: key, value: value }); }); }
  function putArchive(key, value) {
    return run(["archives"], "readwrite", function (db) { return db.put("archives", { key: key, value: value, saved_at: nowIso() }); });
  }
  function getArchive(key) { return run(["archives"], "readonly", function (db) { return db.get("archives", key); }); }

  let started = false;
  function start(options) {
    cfg = Object.assign(cfg, options || {});
    if (!started) {
      started = true;
      window.addEventListener("online", function () { emit(); syncNow(); });
      window.addEventListener("offline", emit);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) syncNow(); });
      setInterval(function () { syncNow(); }, 30000);
    }
    return open().then(recoverInterrupted).then(function () { emit(); syncNow(); });
  }

  return {
    start: start, onStatus: function (fn) { listeners.push(fn); }, status: status, syncNow: syncNow,
    retry: retry, discard: discard, keepBothVisit: keepBothVisit, clearCache: clearCache,
    cacheStudents: cacheStudents, getStudents: getStudents,
    cacheAppointments: cacheAppointments, getAppointments: getAppointments, getClassAppointments: getClassAppointments,
    cacheVisits: cacheVisits, getVisits: getVisits, getHistory: getHistory,
    scheduleClass: scheduleClass, changeAppointment: changeAppointment, extraAppointment: extraAppointment,
    createVisit: createVisit, updateVisit: updateVisit,
    getMeta: getMeta, setMeta: setMeta, putArchive: putArchive, getArchive: getArchive,
    removeLocal: removeLocal, newId: newId, dateOnly: dateOnly
  };
})();
