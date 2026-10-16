// Service worker: keeps the dentist app's own files on this device so Students.html
// opens without internet. Student data is NOT stored here (that is StudentStorageInfo,
// in IndexedDB). /api/... requests are never cached.
const CACHE = "dental-app-shell-v2";
const SHELL = [
  "Students.html", "SchoolClasses.js", "StudentStorageInfo.js", "Students.js", "Dental.js", "Appointments.js",
  "SchoolYearDentalRecords.js", "StudentReg.html", "StudentReg.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // one missing file must not stop the others from being saved
    return Promise.all(SHELL.map(function (f) { return c.add(f).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Always the newest files from the internet (so a new version never mixes with an old
  // one); the saved copy is used only when there is no connection.
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (r) {
      return r || (req.mode === "navigate" ? caches.match("Students.html") : Response.error());
    });
  }));
});
