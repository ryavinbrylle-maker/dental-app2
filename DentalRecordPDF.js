// DentalRecordPDF — builds a printable A4 PDF of ONE student's dental record, on the device.
// No internet or extra library needed (works offline). Uses the standard PDF fonts
// Helvetica / Helvetica-Bold, so the file is small and opens in any PDF viewer.
//
// Contents: school name + school year, student details, the latest examination (tooth chart
// with every condition, findings, DMFT, dentist's notes) and every earlier examination in
// date order, a colour key, and "Page X of Y" on every page.
// Uses from Dental.js: TEETH, CONDITIONS, COND_COLOR, COND_ABBR, normalizeTeeth, dmftCounts,
//   problemsOf, hasAny, longDateText, studentCode. From SchoolClasses.js: SCHOOL_NAME.
const DentalRecordPDF = (function () {
  // ---- Helvetica glyph widths (1/1000 em) for WinAnsi codes 32..255 ----
  const W_R = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,750,556,556,222,556,333,1000,556,556,333,1000,667,333,1000,556,611,556,556,222,222,333,333,350,556,1000,333,1000,500,333,944,556,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,0,737,552,400,549,333,333,333,576,537,333,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,549,611,556,556,556,556,500,556,500];
  const W_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,750,556,556,278,556,500,1000,556,556,333,1000,667,333,1000,556,611,556,556,278,278,500,500,350,556,1000,333,1000,556,333,944,556,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,0,737,552,400,549,333,333,333,576,556,333,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,549,611,611,611,611,611,556,611,556];
  // Unicode -> WinAnsi byte for the 128..159 range (curly quotes, dashes, euro...)
  const WIN = { 0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02C6: 136,
    0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017D: 142, 0x2018: 145, 0x2019: 146, 0x201C: 147,
    0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02DC: 152, 0x2122: 153, 0x0161: 154, 0x203A: 155,
    0x0153: 156, 0x017E: 158, 0x0178: 159 };
  function toWin(str) {
    let out = "";
    for (const ch of String(str)) {
      const c = ch.codePointAt(0);
      if (c >= 32 && c < 127) out += ch;
      else if (WIN[c]) out += String.fromCharCode(WIN[c]);
      else if (c >= 160 && c <= 255) out += String.fromCharCode(c);
      else if (c === 0x2192) out += "->";             // arrow
      else if (c === 0x2713) out += "";               // check mark
      else if (c === 10 || c === 9) out += " ";
      else out += "?";
    }
    return out;
  }
  function esc(s) { return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
  function hexToRgb(h) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || "#000000");
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }
  function rgb(h) { return hexToRgb(h).map(function (v) { return v.toFixed(3); }).join(" "); }
  function isDark(h) { const c = hexToRgb(h); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 0.6; }

  // ---------- a tiny PDF writer (A4, points, origin top-left) ----------
  function Doc() {
    this.W = 595.28; this.H = 841.89; this.M = 42;
    this.pages = []; this.newPage();
  }
  Doc.prototype.newPage = function () { this.cur = []; this.pages.push(this.cur); this.y = this.M; };
  Doc.prototype.width = function (str, size, bold) {
    const w = bold ? W_B : W_R; let t = 0;
    const s = toWin(str);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); t += (c >= 32 && c <= 255) ? w[c - 32] : 556; }
    return t * size / 1000;
  };
  Doc.prototype.text = function (x, y, str, o) {
    o = o || {};
    const size = o.size || 10, s = toWin(str);
    if (o.align === "right") x -= this.width(str, size, o.bold);
    if (o.align === "center") x -= this.width(str, size, o.bold) / 2;
    this.cur.push("BT /" + (o.bold ? "F2" : "F1") + " " + size + " Tf " + rgb(o.color || "#1b2a2f") + " rg " +
                  x.toFixed(2) + " " + (this.H - y - size * 0.8).toFixed(2) + " Td (" + esc(s) + ") Tj ET");
  };
  Doc.prototype.rect = function (x, y, w, h, o) {
    o = o || {};
    const parts = [];
    if (o.lw) parts.push(o.lw + " w");
    if (o.dash) parts.push("[2 2] 0 d"); else parts.push("[] 0 d");
    if (o.fill) parts.push(rgb(o.fill) + " rg");
    if (o.stroke) parts.push(rgb(o.stroke) + " RG");
    parts.push(x.toFixed(2) + " " + (this.H - y - h).toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re");
    parts.push(o.fill && o.stroke ? "B" : o.fill ? "f" : "S");
    this.cur.push(parts.join(" "));
  };
  Doc.prototype.line = function (x1, y1, x2, y2, o) {
    o = o || {};
    this.cur.push((o.lw || 0.6) + " w [] 0 d " + rgb(o.color || "#d5e0e2") + " RG " + x1.toFixed(2) + " " +
                  (this.H - y1).toFixed(2) + " m " + x2.toFixed(2) + " " + (this.H - y2).toFixed(2) + " l S");
  };
  // split text into lines that fit the width (long words are cut)
  Doc.prototype.wrap = function (str, maxW, size, bold) {
    const out = [];
    String(str || "").split(/\n/).forEach(function (para) {
      let line = "";
      para.split(/\s+/).filter(Boolean).forEach(function (word) {
        const tryLine = line ? line + " " + word : word;
        if (this.width(tryLine, size, bold) <= maxW) { line = tryLine; return; }
        if (line) out.push(line);
        while (this.width(word, size, bold) > maxW) {           // a single very long word
          let k = word.length; while (k > 1 && this.width(word.slice(0, k), size, bold) > maxW) k--;
          out.push(word.slice(0, k)); word = word.slice(k);
        }
        line = word;
      }, this);
      out.push(line);
    }, this);
    return out;
  };
  Doc.prototype.ensure = function (h, onNewPage) {        // start a new page if h points don't fit
    if (this.y + h > this.H - this.M - 18) { this.newPage(); if (onNewPage) onNewPage(); return true; }
    return false;
  };
  Doc.prototype.output = function () {
    const objs = [];
    const add = function (s) { objs.push(s); return objs.length; };
    const font1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const font2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pagesId = add(null);                              // filled in below
    const kids = [];
    this.pages.forEach(function (ops) {
      const stream = ops.join("\n");
      const content = add("<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream");
      kids.push(add("<< /Type /Page /Parent " + pagesId + " 0 R /MediaBox [0 0 " + this.W + " " + this.H + "] " +
                    "/Resources << /Font << /F1 " + font1 + " 0 R /F2 " + font2 + " 0 R >> >> /Contents " + content + " 0 R >>"));
    }, this);
    objs[pagesId - 1] = "<< /Type /Pages /Kids [" + kids.map(function (k) { return k + " 0 R"; }).join(" ") + "] /Count " + kids.length + " >>";
    const info = add("<< /Producer (School Dental App) /Title (" + esc(toWin(this.title || "Dental record")) + ") >>");
    const catalog = add("<< /Type /Catalog /Pages " + pagesId + " 0 R >>");
    let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [];
    objs.forEach(function (o, i) { offsets.push(pdf.length); pdf += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
    const xref = pdf.length;
    pdf += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
    offsets.forEach(function (o) { pdf += String(o).padStart(10, "0") + " 00000 n \n"; });
    pdf += "trailer\n<< /Size " + (objs.length + 1) + " /Root " + catalog + " 0 R /Info " + info + " 0 R >>\nstartxref\n" + xref + "\n%%EOF";
    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 255;
    return bytes;
  };

  // ---------- the dental record ----------
  const SOUND_FILL = "#eaf7ee", SOUND_LINE = "#43b97f", EMPTY_LINE = "#b9c9cc";

  function toothChart(doc, teeth, dentition) {
    const rows = TEETH[dentition];                 // [upper row, lower row] in chart order
    const per = rows[0].length;                    // 16 permanent / 10 primary
    const gap = 8, x0 = doc.M;
    const box = Math.min(30, (doc.W - 2 * doc.M - gap - (per - 1) * 1.5) / per);
    doc.text(x0, doc.y, dentition + " teeth", { size: 9, bold: true, color: "#566a70" });
    doc.y += 13;
    rows.forEach(function (row, ri) {
      let x = x0;
      row.forEach(function (num, i) {
        if (i === per / 2) x += gap;               // midline
        const n = String(num), info = teeth[n];
        const probs = problemsOf(info);
        let fill = "#ffffff", stroke = EMPTY_LINE, label = "", txt = "#1b2a2f", dash = false;
        if (probs.length) {
          fill = COND_COLOR[probs[0]] || "#999999"; stroke = fill;
          label = probs.map(function (c) { return COND_ABBR[c] || c.charAt(0); }).join("+");
          txt = isDark(fill) ? "#ffffff" : "#1b2a2f";
          dash = probs[0] === "Unerupted";
          if (dash) { stroke = "#64748b"; fill = "#e2e8f0"; txt = "#1b2a2f"; }
        } else if (info) { fill = SOUND_FILL; stroke = SOUND_LINE; label = "Sd"; txt = "#1d6b4f"; }
        doc.rect(x, doc.y, box, box, { fill: fill, stroke: stroke, lw: probs.length > 1 ? 1.6 : 0.8, dash: dash });
        doc.text(x + box / 2, doc.y + 3, n, { size: 8.5, bold: true, color: txt, align: "center" });
        if (label) doc.text(x + box / 2, doc.y + box - 11, label.length > 7 ? label.slice(0, 7) : label,
                            { size: label.length > 4 ? 5.5 : 7, color: txt, align: "center" });
        x += box + 1.5;
      });
      doc.y += box + (ri === 0 ? 4 : 0);
    });
    doc.y += 8;
  }

  function findings(doc, teeth) {
    const lines = [];
    CONDITIONS.forEach(function (c) {
      const nums = Object.keys(teeth).filter(function (n) { return teeth[n].conditions.includes(c); }).sort();
      if (nums.length) lines.push([c + " (" + nums.length + ")", nums.join(", ")]);
    });
    const sound = Object.keys(teeth).filter(function (n) { return teeth[n].conditions[0] === "Sound"; }).length;
    if (sound) lines.push(["Sound", sound + " teeth"]);
    if (!lines.length) lines.push(["Findings", "No teeth recorded."]);
    Object.keys(teeth).sort().forEach(function (n) { if (teeth[n].note) lines.push(["Note, tooth " + n, teeth[n].note]); });
    const labelW = 120, textW = doc.W - 2 * doc.M - labelW;
    lines.forEach(function (l) {
      const wrapped = doc.wrap(l[1], textW, 9.5);
      doc.ensure(wrapped.length * 12 + 2);
      doc.text(doc.M, doc.y, l[0], { size: 9.5, bold: true });
      wrapped.forEach(function (w, i) { doc.text(doc.M + labelW, doc.y + i * 12, w, { size: 9.5 }); });
      doc.y += wrapped.length * 12 + 2;
    });
  }

  function examBlock(doc, v, title) {
    const teeth = normalizeTeeth(v.teeth);
    const dents = ["Permanent", "Primary"].filter(function (d) { return hasAny(teeth, d); });
    const chartH = dents.length * 92 || 20;
    doc.ensure(60 + chartH);                          // keep header + chart together
    doc.rect(doc.M, doc.y, doc.W - 2 * doc.M, 22, { fill: "#e7f3f4" });
    doc.text(doc.M + 8, doc.y + 6, title + " – " + longDateText(v.visit_date), { size: 11, bold: true, color: "#0a5862" });
    const cls = ["SY " + (v.school_year || "?"), [v.grade, v.section].filter(Boolean).join(" – ")].filter(Boolean).join("  ·  ");
    doc.text(doc.W - doc.M - 8, doc.y + 7, cls, { size: 9, color: "#566a70", align: "right" });
    doc.y += 30;
    if (!dents.length) { doc.text(doc.M, doc.y, "No teeth recorded in this examination.", { size: 9.5, color: "#566a70" }); doc.y += 16; }
    dents.forEach(function (d) { doc.ensure(92); toothChart(doc, teeth, d); });
    findings(doc, teeth);
    const c = dmftCounts(teeth);
    doc.ensure(16);
    doc.text(doc.M, doc.y + 2, "DMFT", { size: 9.5, bold: true });
    doc.text(doc.M + 120, doc.y + 2, "D " + c.d + "   M " + c.m + "   F " + c.f + "   Total " + (c.d + c.m + c.f), { size: 9.5 });
    doc.y += 16;
    const notes = doc.wrap(v.exam_notes || "—", doc.W - 2 * doc.M - 120, 9.5);
    doc.ensure(Math.min(notes.length, 3) * 12 + 4);
    doc.text(doc.M, doc.y, "Dentist's notes", { size: 9.5, bold: true });
    notes.forEach(function (w, i) {
      if (i) doc.ensure(12);                          // long notes continue on the next page
      doc.text(doc.M + 120, doc.y, w, { size: 9.5 });
      doc.y += 12;
    });
    if (v.created_by) { doc.text(doc.M + 120, doc.y, "Recorded by: " + v.created_by, { size: 8.5, color: "#566a70" }); doc.y += 12; }
    doc.y += 12;
  }

  function legend(doc) {
    doc.ensure(60);
    doc.text(doc.M, doc.y, "Colour key", { size: 9.5, bold: true });
    doc.y += 14;
    let x = doc.M;
    const items = [["Sound", SOUND_FILL, "Sd"]].concat(CONDITIONS.map(function (c) { return [c, COND_COLOR[c], COND_ABBR[c]]; }));
    items.forEach(function (it) {
      const label = it[0] + " (" + it[2] + ")";
      const w = 14 + doc.width(label, 8.5) + 14;
      if (x + w > doc.W - doc.M) { x = doc.M; doc.y += 14; }
      doc.rect(x, doc.y, 10, 10, { fill: it[1], stroke: it[0] === "Sound" ? SOUND_LINE : it[1], lw: 0.8, dash: it[0] === "Unerupted" });
      doc.text(x + 14, doc.y + 1, label, { size: 8.5 });
      x += w;
    });
    doc.y += 22;
  }

  function sortExams(list) {
    return list.slice().sort(function (a, b) {
      return String(a.visit_date).localeCompare(String(b.visit_date)) || (a.id || 0) - (b.id || 0);
    });
  }

  function ageOf(s) {
    if (s.age != null && s.age !== "") return String(s.age);
    if (!s.birthdate) return "—";
    const b = new Date(String(s.birthdate).slice(0, 10) + "T00:00:00Z"), now = new Date();
    if (isNaN(b)) return "—";
    let a = now.getUTCFullYear() - b.getUTCFullYear();
    if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) a--;
    return a >= 0 ? String(a) : "—";
  }

  // data: { student, exams, schoolYear }
  function build(data) {
    const s = data.student || {}, doc = new Doc();
    doc.title = "Dental record - " + (s.name || "");
    const exams = sortExams((data.exams || []).filter(function (v) { return v && v.teeth; }));
    const generated = new Date();
    const pageHeader = function () {
      doc.text(doc.M, doc.y, (typeof SCHOOL_NAME !== "undefined" ? SCHOOL_NAME : "School Dental Clinic") + " · Student Dental Record",
               { size: 8.5, color: "#566a70" });
      doc.text(doc.W - doc.M, doc.y, (s.name || "") + (studentCode(s) ? " (" + studentCode(s) + ")" : ""), { size: 8.5, color: "#566a70", align: "right" });
      doc.line(doc.M, doc.y + 13, doc.W - doc.M, doc.y + 13);
      doc.y += 22;
    };

    // ---- title block ----
    doc.rect(doc.M, doc.y, 30, 30, { fill: "#0e6f7a" });
    doc.text(doc.M + 15, doc.y + 7, "+", { size: 18, bold: true, color: "#ffffff", align: "center" });
    doc.text(doc.M + 40, doc.y, (typeof SCHOOL_NAME !== "undefined" ? SCHOOL_NAME : "School Dental Clinic"), { size: 15, bold: true });
    doc.text(doc.M + 40, doc.y + 18, "Student Dental Record", { size: 10.5, color: "#566a70" });
    doc.text(doc.W - doc.M, doc.y, "School year " + (data.schoolYear || s.school_year || ""), { size: 10.5, bold: true, align: "right" });
    doc.text(doc.W - doc.M, doc.y + 15, "Printed " + generated.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
             { size: 8.5, color: "#566a70", align: "right" });
    doc.y += 40;
    doc.line(doc.M, doc.y, doc.W - doc.M, doc.y, { lw: 1.2, color: "#0e6f7a" });
    doc.y += 12;

    // ---- student details (two columns) ----
    const medical = [].concat(s.conditions || [], s.other_conditions ? [s.other_conditions] : []);
    const left = [["Name", s.name || "—"], ["Student code", studentCode(s) || "—"],
                  ["Grade / Section", [s.grade, s.section].filter(Boolean).join(" – ") || "—"],
                  ["School year", s.school_year || data.schoolYear || "—"]];
    const right = [["Birthdate", s.birthdate ? longDateText(s.birthdate) : "—"], ["Age", ageOf(s)],
                   ["Sex", s.sex || (s.code_gender === "M" ? "Male" : s.code_gender === "F" ? "Female" : "—")],
                   ["Allergies", s.allergies || "None recorded"]];
    const colW = (doc.W - 2 * doc.M) / 2;
    left.forEach(function (p, i) {
      doc.text(doc.M, doc.y + i * 15, p[0], { size: 9.5, color: "#566a70" });
      doc.text(doc.M + 95, doc.y + i * 15, p[1], { size: 9.5, bold: i === 0 });
      const r = right[i];
      doc.text(doc.M + colW, doc.y + i * 15, r[0], { size: 9.5, color: "#566a70" });
      const rv = doc.wrap(r[1], colW - 80, 9.5)[0];
      doc.text(doc.M + colW + 70, doc.y + i * 15, rv, { size: 9.5 });
    });
    doc.y += 4 * 15 + 2;
    const med = doc.wrap("Medical conditions: " + (medical.length ? medical.join(", ") : "None recorded") +
                         "   ·   Medications: " + (s.medications || "None recorded"), doc.W - 2 * doc.M, 9.5);
    med.forEach(function (w) { doc.text(doc.M, doc.y, w, { size: 9.5 }); doc.y += 12; });
    doc.y += 10;

    // ---- examinations ----
    if (!exams.length) {
      doc.text(doc.M, doc.y, "No dental examinations have been recorded for this student yet.", { size: 10.5 });
      doc.y += 20;
    } else {
      const latest = exams[exams.length - 1];
      doc.text(doc.M, doc.y, "Latest examination", { size: 12.5, bold: true }); doc.y += 20;
      examBlock(doc, latest, "Examination");
      const earlier = exams.slice(0, -1);
      if (earlier.length) {
        doc.ensure(80);
        doc.text(doc.M, doc.y, "Earlier examinations (" + earlier.length + ", in date order)", { size: 12.5, bold: true }); doc.y += 20;
        earlier.forEach(function (v) { examBlock(doc, v, "Examination"); });
      }
    }
    legend(doc);

    // ---- page header (from page 2) and "Page X of Y" footer on every page ----
    const total = doc.pages.length;
    doc.pages.forEach(function (ops, i) {
      doc.cur = ops;
      if (i > 0) { const keepY = doc.y; doc.y = 18; pageHeader(); doc.y = keepY; }
      doc.line(doc.M, doc.H - doc.M + 4, doc.W - doc.M, doc.H - doc.M + 4);
      doc.text(doc.M, doc.H - doc.M + 10, "Confidential student health record – " + (s.name || ""), { size: 8, color: "#566a70" });
      doc.text(doc.W - doc.M, doc.H - doc.M + 10, "Page " + (i + 1) + " of " + total, { size: 8, color: "#566a70", align: "right" });
    });
    return doc.output();
  }

  function fileName(s) {
    const safe = String(s.name || "student").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return "Dental-Record-" + safe + (studentCode(s) ? "-" + studentCode(s) : "") + ".pdf";
  }

  return { build: build, fileName: fileName };
})();
