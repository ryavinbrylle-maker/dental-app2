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

// ---------- Codes already used (to warn about a taken student code) ----------
const CODES_URL = "/api/codes";
const codeTaken = document.getElementById("codeTaken");
let usedCodes = [];      // [{ grade, section, code_gender, code_number }]

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
  if (window.location.protocol === "file:") return Promise.resolve();
  return fetch(CODES_URL)
    .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error("server error " + res.status)); })
    .then(function (data) {
      usedCodes = data.codes || [];
      checkCodeTaken();
    })
    .catch(function () { /* the server still refuses a taken code when saving */ });
}

["grade", "section", "codeGender"].forEach(function (id) {
  document.getElementById(id).addEventListener("change", checkCodeTaken);
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
    grade: val("grade"),
    section: val("section"),

    conditions: checked("conditions"),
    otherConditions: val("otherConditions"),
    allergies: val("allergies"),
    medications: val("medications"),

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
