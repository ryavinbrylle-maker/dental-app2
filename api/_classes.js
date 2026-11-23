// Server-side check that a grade + section really exists in the school's list.
// The list lives in ONE place, SchoolClasses.js (also used by the pages); this file reads it.
// vercel.json ("functions" -> "includeFiles") ships SchoolClasses.js with the functions.
import fs from "fs";
import vm from "vm";

let cache;
function load() {
  if (cache !== undefined) return cache;
  try {
    const code = fs.readFileSync(new URL("../SchoolClasses.js", import.meta.url), "utf8");
    const list = vm.runInNewContext(code + "\n;SCHOOL_CLASSES", {}, { timeout: 200 });
    cache = new Map(list.map(function (c) { return [c.grade, new Set(c.sections)]; }));
  } catch (e) {
    console.error("SchoolClasses.js not readable – class check skipped:", e.message);
    cache = null;
  }
  return cache;
}

// true when the grade/section pair is one of the school's classes
export function classExists(grade, section) {
  const m = load();
  if (!m) return true;            // never block registration because the list could not be read
  return m.has(grade) && m.get(grade).has(section);
}
