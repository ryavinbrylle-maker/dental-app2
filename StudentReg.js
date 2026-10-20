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

// ---------- inline validation (message under each field) ----------
function setFieldError(id, msg) {
  const input = document.getElementById(id);
  const field = input.closest(".field");
  let p = document.getElementById("err-" + id);
  if (!p) {
    p = document.createElement("p");
    p.className = "field-error"; p.id = "err-" + id;
    field.appendChild(p);
  }
  p.textContent = msg || "";
  field.classList.toggle("invalid", Boolean(msg));
  if (msg) { input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", p.id); }
  else { input.removeAttribute("aria-invalid"); }
}
function todayLocal() {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
birthdateInput.max = todayLocal();
function validateForm() {
  const errors = [];
  const check = function (id, msg) { setFieldError(id, msg); if (msg) errors.push(id); };
  const name = val("studentName");
  check("studentName", !name ? "Please enter the student's name." :
                       name.length < 2 ? "Please enter the full name." : "");
  check("grade", val("grade") ? "" : "Please choose a grade.");
  check("section", val("section") ? "" : (val("grade") ? "Please choose a section / strand." : "Choose a grade first."));
  check("codeGender", codeGenderInput.value ? "" : "Choose M (male) or F (female).");
  const code = readStudentCode();
  check("codeNumber", !codeNumberInput.value.trim() ? "Enter the student's number, e.g. 1." :
                      (code.error && codeGenderInput.value ? code.error : (checkCodeTaken() ? "" : "This code is already taken in this class.")));
  const bd = val("birthdate");
  check("birthdate", bd && bd > todayLocal() ? "The birthdate cannot be in the future." : "");
  return errors;
}
// clear a field's message as soon as it is fixed
["studentName", "grade", "section", "codeGender", "codeNumber", "birthdate"].forEach(function (id) {
  const elx = document.getElementById(id);
  ["input", "change"].forEach(function (ev) {
    elx.addEventListener(ev, function () {
      if (elx.closest(".field").classList.contains("invalid")) validateForm();
    });
  });
});
function showMessage(text, kind) { message.textContent = text; message.className = kind || ""; }

form.addEventListener("submit", function (e) {
  e.preventDefault();

  const errors = validateForm();
  if (errors.length) {
    showMessage("Please fix the " + (errors.length === 1 ? "field" : errors.length + " fields") + " marked in red.", "bad");
    document.getElementById(errors[0]).focus();
    return;
  }
  const code = readStudentCode();

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
    showMessage("This form only saves online. Open it from your Vercel link.", "bad");
    return;
  }

  const button = form.querySelector("button[type=submit]");
  if (button.disabled) return;            // already sending: no double registration
  button.disabled = true;
  button.textContent = "Saving...";
  showMessage("Saving...", "busy");

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
      showMessage("✓ " + student.name + " (" + student.grade + " – " + student.section +
                  ", " + code.code + ") has been registered.", "ok");
      form.reset();
      fillSectionChoices();
      ageInput.value = "";
      updateCodePreview();
      loadCodes();
    })
    .catch(function (err) {
      console.error(err);
      showMessage("Could not save: " + err.message, "bad");
      loadCodes(); // someone may have just taken that code
    })
    .finally(function () {
      button.disabled = false;
      button.textContent = "Confirm";
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });
});
