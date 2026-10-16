// Sends the form to the back end (api/register.js on Vercel),
// which saves it in the Neon database.
const API_URL = "/api/register";

const form = document.getElementById("regForm");
const message = document.getElementById("message");
const birthdateInput = document.getElementById("birthdate");
const ageInput = document.getElementById("age");

// Get the value of a field by its id
function val(id) {
  return document.getElementById(id).value.trim();
}

// Get all ticked checkbox values inside a group
function checked(groupId) {
  const boxes = document.querySelectorAll("#" + groupId + " input:checked");
  return Array.from(boxes).map(function (b) { return b.value; });
}

// Work out age from birthdate
function calculateAge(dateString) {
  if (!dateString) return "";
  const birth = new Date(dateString);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : "";
}

birthdateInput.addEventListener("change", function () {
  ageInput.value = calculateAge(birthdateInput.value);
});

// ---------- Student code (gender letter + number -> e.g. "M-1") ----------
const codeGenderInput = document.getElementById("codeGender");
const codeNumberInput = document.getElementById("codeNumber");
const codePreview = document.getElementById("codePreview");

// Returns { gender, number, code } or { error }
function readStudentCode() {
  const g = codeGenderInput.value;
  const raw = codeNumberInput.value.trim();
  if (g !== "M" && g !== "F") return { error: "Please choose M or F for the student code." };
  if (!/^[0-9]+$/.test(raw)) return { error: "The student code number must be a whole number like 1, 2, 3." };
  const n = parseInt(raw, 10);
  if (n < 1 || n > 999) return { error: "The student code number must be between 1 and 999." };
  return { gender: g, number: n, code: g + "-" + n };
}

function updateCodePreview() {
  const c = readStudentCode();
  const ready = !c.error;
  codePreview.textContent = "Your code: " + (ready ? c.code : "—");
  codePreview.classList.toggle("empty", !ready);
  codeNumberInput.setCustomValidity(
    codeNumberInput.value && !/^[0-9]+$/.test(codeNumberInput.value.trim()) ? "Whole numbers only" : ""
  );
}
codeGenderInput.addEventListener("change", updateCodePreview);
codeNumberInput.addEventListener("input", updateCodePreview);
updateCodePreview();

// ---------- Class list: Grade -> Section -> codes (codes only, no names) ----------
const CODES_URL = "/api/codes";
const classGroups = document.getElementById("classGroups");
const codeTaken = document.getElementById("codeTaken");
let usedCodes = [];      // [{ grade, section, code_gender, code_number }]
let justRegistered = null;

// Kinder first, then Grade 1, 2 ... 10 (by the number, not as text)
function gradeRank(g) {
  if (/^kinder/i.test(g)) return -1;
  const m = String(g).match(/\d+/);
  return m ? parseInt(m[0], 10) : 1000;
}
function compareGrades(a, b) {
  return gradeRank(a) - gradeRank(b) || String(a).localeCompare(String(b), undefined, { numeric: true });
}
function compareSections(a, b) { return compareSchoolSections(a, b); }   // school's order (SchoolClasses.js)

// ---------- Grade and Section choices (from SchoolClasses.js) ----------
function fillGradeChoices() {
  const sel = document.getElementById("grade");
  GRADE_LIST.forEach(function (g) {
    const o = document.createElement("option"); o.value = g; o.textContent = g; sel.appendChild(o);
  });
}
// Only the sections of the chosen grade can be picked
function fillSectionChoices() {
  const sel = document.getElementById("section");
  const g = val("grade");
  const keep = sel.value;
  sel.innerHTML = "";
  const first = document.createElement("option");
  first.value = ""; first.disabled = true; first.selected = true;
  first.textContent = g ? "Choose section" : "Choose a grade first";
  sel.appendChild(first);
  sectionsFor(g).forEach(function (sec) {
    const o = document.createElement("option"); o.value = sec; o.textContent = sec;
    if (sec === keep) { o.selected = true; first.selected = false; }
    sel.appendChild(o);
  });
  sel.disabled = !g;
}
fillGradeChoices();
fillSectionChoices();
document.getElementById("grade").addEventListener("change", fillSectionChoices);
// Sort by the code NUMBER: 1, 2, 9, 10, 11, 20 (never 1, 10, 11, 2)
function byNumber(a, b) { return Number(a.code_number) - Number(b.code_number); }

// Grade -> Section -> { M: [...], F: [...] }, each kept separate
function groupCodes(list) {
  const grades = new Map();
  list.forEach(function (c) {
    if (!grades.has(c.grade)) grades.set(c.grade, new Map());
    const sections = grades.get(c.grade);
    if (!sections.has(c.section)) sections.set(c.section, { M: [], F: [] });
    const box = sections.get(c.section);
    if (c.code_gender === "M" || c.code_gender === "F") box[c.code_gender].push(c);
  });
  return Array.from(grades.keys()).sort(compareGrades).map(function (g) {
    const secMap = grades.get(g);
    return {
      grade: g,
      sections: Array.from(secMap.keys()).sort(compareSections).map(function (sec) {
        const box = secMap.get(sec);
        return { section: sec, M: box.M.sort(byNumber), F: box.F.sort(byNumber) };
      })
    };
  });
}

function make(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}

function renderClassList() {
  classGroups.innerHTML = "";
  if (!usedCodes.length) {
    classGroups.appendChild(make("p", "note", "No students registered yet."));
    return;
  }
  const myGrade = val("grade"), mySection = val("section");

  groupCodes(usedCodes).forEach(function (g) {
    const block = make("div", "grade-block");
    block.appendChild(make("h3", "grade-title", g.grade));

    g.sections.forEach(function (sec) {
      const box = make("div", "section-box" + (g.grade === myGrade && sec.section === mySection ? " mine" : ""));
      const head = make("div", "section-head");
      head.appendChild(make("h3", "", g.grade + " – " + sec.section));
      head.appendChild(make("span", "", sec.M.length + " male · " + sec.F.length + " female"));
      box.appendChild(head);

      [["M", "Male"], ["F", "Female"]].forEach(function (pair) {
        const list = sec[pair[0]];
        if (!list.length) return;
        const grp = make("div", "gender-group");
        grp.appendChild(make("div", "gender-label", pair[1]));
        const codes = make("div", "codes");
        list.forEach(function (c) {
          const label = c.code_gender + "-" + c.code_number;
          const mine = justRegistered && justRegistered.grade === g.grade &&
                       justRegistered.section === sec.section && justRegistered.code === label;
          codes.appendChild(make("span", "code-badge " + c.code_gender + (mine ? " yours" : ""), label));
        });
        grp.appendChild(codes);
        box.appendChild(grp);
      });
      block.appendChild(box);
    });
    classGroups.appendChild(block);
  });
}

// Warn straight away if the chosen code is already used in the chosen Grade + Section
function checkCodeTaken() {
  const c = readStudentCode();
  const g = val("grade"), sec = val("section");
  const taken = !c.error && g && sec && usedCodes.some(function (u) {
    return u.grade === g && u.section === sec &&
           u.code_gender === c.gender && Number(u.code_number) === c.number;
  });
  codeTaken.textContent = taken ? c.code + " is already taken in " + g + " – " + sec + ". Please use another number." : "";
  return !taken;
}

function loadCodes() {
  if (window.location.protocol === "file:") {
    classGroups.innerHTML = "";
    classGroups.appendChild(make("p", "note", "The class list shows when this page is opened from your Vercel link."));
    return Promise.resolve();
  }
  return fetch(CODES_URL)
    .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error("server error " + res.status)); })
    .then(function (data) {
      usedCodes = data.codes || [];
      renderClassList();
      checkCodeTaken();
    })
    .catch(function () {
      classGroups.innerHTML = "";
      classGroups.appendChild(make("p", "note", "Could not load the class list right now."));
    });
}

["grade", "section", "codeGender"].forEach(function (id) {
  document.getElementById(id).addEventListener("change", function () { checkCodeTaken(); renderClassList(); });
});
codeNumberInput.addEventListener("input", checkCodeTaken);
loadCodes();
setInterval(function () { if (!document.hidden) loadCodes(); }, 30000); // keep it up to date

form.addEventListener("submit", function (e) {
  e.preventDefault();

  const code = readStudentCode();
  if (code.error) {
    message.textContent = code.error;
    codeNumberInput.focus();
    return;
  }
  if (!checkCodeTaken()) {
    message.textContent = codeTaken.textContent;
    codeNumberInput.focus();
    return;
  }

  const student = {
    name: val("studentName"),
    codeGender: code.gender,
    codeNumber: code.number,
    birthdate: val("birthdate"),
    age: ageInput.value,
    bloodType: val("bloodType"),
    grade: val("grade"),
    section: val("section"),
    height: val("height"),
    weight: val("weight"),
    address: val("address"),

    parentName: val("parentName"),
    relationship: val("relationship"),
    contact: val("contact"),
    emergencyContact: val("emergencyContact"),

    conditions: checked("conditions"),
    otherConditions: val("otherConditions"),
    allergies: val("allergies"),
    medications: val("medications"),

    lastVisit: val("lastVisit"),
    brushing: val("brushing"),
    dentalConcerns: checked("dentalConcerns"),
    dentalNotes: val("dentalNotes"),

    consent: document.getElementById("consent").checked,
    registeredOn: new Date().toISOString()
  };

  if (window.location.protocol === "file:") {
    message.textContent = "This form only saves online. Open it from your Vercel link.";
    return;
  }

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  message.textContent = "Saving...";

  fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(student)
  })
    .then(function (res) {
      return res.text().then(function (text) {
        let data = {};
        try { data = JSON.parse(text); } catch (e) {}
        if (res.status === 404) throw new Error("back end not found (api/register.js is missing on the server)");
        if (!res.ok) throw new Error(data.error || ("server error " + res.status));
        return data;
      });
    })
    .then(function () {
      message.textContent = student.name + " (" + student.grade + " – " + student.section +
                            ", " + code.code + ") has been registered.";
      justRegistered = { grade: student.grade, section: student.section, code: code.code };
      form.reset();
      fillSectionChoices();
      ageInput.value = "";
      updateCodePreview();
      loadCodes();
    })
    .catch(function (err) {
      console.error(err);
      message.textContent = "Could not save: " + err.message;
      loadCodes(); // someone may have just taken that code
    })
    .finally(function () {
      button.disabled = false;
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });
});
