// SchoolClasses — the school's grades and sections (one place to change them).
// Used by the registration form (StudentReg.html) and the dentist pages (Students.html).
// Sections are listed in the school's own order; the app shows them in this order.
// To add or rename a section, change it here only.
const SCHOOL_CLASSES = [
  { grade: "Grade 7", sections: [
    "St. Dominic Savio", "St. John Bosco", "St. Anthony of Padua", "St. Pius V",
    "St. Thomas Aquinas", "St. Sebastian"] },
  { grade: "Grade 8", sections: [
    "St. Ignatius of Loyola", "St. John de la Salle", "St. Francis of Assisi", "St. Benedict",
    "St. Arnold Janssen", "St. Agustine"] },
  { grade: "Grade 9", sections: [
    "St. Joan of Arc", "St. Cecilia of Rome", "St. Rose of Lima", "St. Teresa of Avila",
    "St. Agatha of Sicily", "St. Magdalene of Canossa"] },
  { grade: "Grade 10", sections: [
    "St. Lorenzo Ruiz", "St. Pedro Calungsod", "St. John Paul II", "St. Patrick of Ireland",
    "St. Andrew Kim Taegon"] },
  { grade: "Grade 11", sections: [
    "ABM", "BE - Tourism A", "BE - Tourism B", "ASSH - Education & Law",
    "ASSH - Uniformed Service Professions", "STEM Engineering & Architecture",
    "STEM Aviation Related Careers", "STEM Maritime", "STEM Health and Sciences - A",
    "STEM Health and Sciences - B", "TECHPRO A", "TECHPRO B"] },
  { grade: "Grade 12", sections: [
    "STEM A", "STEM B", "STEM C", "STEM D", "ABM A", "ABM B",
    "HUMSS A", "HUMSS B", "HUMSS C", "ICT"] }
];

const GRADE_LIST = SCHOOL_CLASSES.map(function (c) { return c.grade; });

function sectionsFor(grade) {
  const c = SCHOOL_CLASSES.find(function (x) { return x.grade === grade; });
  return c ? c.sections.slice() : [];
}

// Position of a section in the school's list (unknown/older sections go last, A–Z)
const SECTION_ORDER = (function () {
  const m = new Map();
  SCHOOL_CLASSES.forEach(function (c) {
    c.sections.forEach(function (s, i) { if (!m.has(s.toLowerCase())) m.set(s.toLowerCase(), i); });
  });
  return m;
})();
function compareSchoolSections(a, b) {
  const ra = SECTION_ORDER.has(String(a).toLowerCase()) ? SECTION_ORDER.get(String(a).toLowerCase()) : 1000;
  const rb = SECTION_ORDER.has(String(b).toLowerCase()) ? SECTION_ORDER.get(String(b).toLowerCase()) : 1000;
  return ra - rb || String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}
