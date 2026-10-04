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

form.addEventListener("submit", function (e) {
  e.preventDefault();

  const code = readStudentCode();
  if (code.error) {
    message.textContent = code.error;
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
      form.reset();
      ageInput.value = "";
      updateCodePreview();
    })
    .catch(function (err) {
      console.error(err);
      message.textContent = "Could not save: " + err.message;
    })
    .finally(function () {
      button.disabled = false;
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });
});
