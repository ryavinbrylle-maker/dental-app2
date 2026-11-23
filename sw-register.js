// Keep the app's files on this device so it opens without internet (sw.js).
// A separate file (not inline) so the Content-Security-Policy can forbid inline scripts.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(function (e) { console.warn("Offline app files not available", e); });
}
