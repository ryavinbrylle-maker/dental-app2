// DentalCore – tooth chart basics shared by the dentist pages (Students.html) and the
// students' own page (MyRecords.html): tooth numbers, conditions, colours, tooth map drawing, DMFT.
// Load this BEFORE Dental.js / DentalRecordPDF.js / MyRecords.js.

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
                  "Root Fragment", "Impacted", "Crowned", "Temporary Filled", "Unerupted",
                  "Composite filled", "Amalgam filled", "Indicated for extraction", "Carious tooth", "Erupting"];
// Older records may say "Crowded" – that condition was renamed "Crowned" (Oct 2026)
const RENAMED = { "Crowded": "Crowned" };
// Conditions that can be COMBINED on one tooth (e.g. Sealant + Decayed).
// "Sound" = checked and healthy, so it replaces the others.
const CONDITIONS = STATUSES.filter(function (c) { return c !== "Sound"; });
const COND_COLOR = { Decayed: "#e5483f", Missing: "#6b7280", Filled: "#4a8af4", Fractured: "#f07c12", Sealant: "#43b97f",
                     "Root Fragment": "#8b5a2b", Impacted: "#7c3aed", Crowned: "#c9a227", "Temporary Filled": "#a5c8ff",
                     Unerupted: "#cbd5e1", "Composite filled": "#0ea5e9", "Amalgam filled": "#334155",
                     "Indicated for extraction": "#9f1239", "Carious tooth": "#fb7185", Erupting: "#fde68a" };
const COND_ABBR = { Decayed: "D", Missing: "M", Filled: "F", Fractured: "Fx", Sealant: "S",
                    "Root Fragment": "RF", Impacted: "Im", Crowned: "Cr", "Temporary Filled": "TF", Unerupted: "U",
                    "Composite filled": "CF", "Amalgam filled": "AF", "Indicated for extraction": "X",
                    "Carious tooth": "C", Erupting: "E" };
function condClass(c) { return String(c).replace(/\s+/g, ""); }   // "Root Fragment" -> "RootFragment"

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

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
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


function hasAny(teeth, dentition) {
  return TEETH[dentition].some(function (row) {
    return row.some(function (n) { return teeth[String(n)]; });
  });
}

function dmftCounts(teeth) {
  const c = { d: 0, m: 0, f: 0 };
  Object.values(teeth).forEach(function (t) {
    const l = t.conditions;
    if (l.includes("Missing")) c.m++;
    else if (l.includes("Decayed") || l.includes("Carious tooth") || l.includes("Indicated for extraction") ||
             l.includes("Root Fragment") || l.includes("Temporary Filled")) c.d++;
    else if (l.includes("Filled") || l.includes("Composite filled") || l.includes("Amalgam filled")) c.f++;
  });
  return c;
}
