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

form.addEventListener("submit", function (e) {
  e.preventDefault();

  const student = {
    lrn: val("lrn"),
    name: val("studentName"),
    birthdate: val("birthdate"),
    age: ageInput.value,
    sex: val("sex"),
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
      message.textContent = student.name + " has been registered.";
      form.reset();
      ageInput.value = "";
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
