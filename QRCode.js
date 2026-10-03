// Builds a QR code that opens the Student Registration form

const qrBox = document.getElementById("qrcode");
const urlInput = document.getElementById("formUrl");
const warning = document.getElementById("warning");

// Live registration form on Vercel
const FORM_URL = "https://dental-app-self.vercel.app/StudentReg.html";

function defaultFormUrl() {
  return FORM_URL;
}

// Draw the QR code for the given link
function makeQR(link) {
  qrBox.innerHTML = "";
  new QRCode(qrBox, {
    text: link,
    width: 260,
    height: 260,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });

  // Phones can't open a file stored on this computer
  warning.style.display = link.startsWith("file:") ? "block" : "none";
}

document.getElementById("updateBtn").addEventListener("click", function () {
  const link = urlInput.value.trim();
  if (!link) {
    alert("Please enter the registration form link.");
    return;
  }
  makeQR(link);
});

document.getElementById("printBtn").addEventListener("click", function () {
  window.print();
});

document.getElementById("downloadBtn").addEventListener("click", function () {
  const canvas = qrBox.querySelector("canvas");
  if (!canvas) return;
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "StudentReg-QR.png";
  a.click();
});

// Start with the default link
urlInput.value = defaultFormUrl();
makeQR(urlInput.value);
