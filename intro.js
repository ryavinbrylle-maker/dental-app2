// Animated school intro (CVIF) – plays once per visit, tap anywhere or "Skip" to close.
// Uses cvif-logo.webp. Respects "reduce motion". Never blocks the app: the page loads underneath.
(function () {
  var LOGO = window.INTRO_LOGO || "cvif-logo.webp";
  var force = window.INTRO_FORCE === true;
  if (!force && navigator.webdriver) return;            // automated tests: no intro
  try { if (!force && sessionStorage.getItem("introShown")) return; } catch (e) {}

  var css = "" +
  "#schoolIntro{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;overflow:hidden;cursor:pointer;" +
  "background:radial-gradient(120% 90% at 50% 40%,#0f8aa8 0%,#0e7490 45%,#0b4f63 100%);color:#fff;" +
  "font-family:'Atkinson Hyperlegible','DM Sans',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;" +
  "animation:siOut .6s cubic-bezier(.4,0,.2,1) 3.1s forwards}" +
  "#schoolIntro .si-glow{position:absolute;width:120vmax;height:120vmax;border-radius:50%;" +
  "background:radial-gradient(circle,rgba(255,255,255,.16) 0%,rgba(255,255,255,0) 55%);animation:siGlow 3.6s ease-out both}" +
  "#schoolIntro .si-wrap{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding:24px}" +
  "#schoolIntro .si-badge{position:relative;width:min(46vmin,240px);height:min(46vmin,240px)}" +
  "#schoolIntro .si-ring{position:absolute;inset:-14px;width:calc(100% + 28px);height:calc(100% + 28px);transform:rotate(-90deg)}" +
  "#schoolIntro .si-ring circle{fill:none;stroke:rgba(255,255,255,.9);stroke-width:3;stroke-linecap:butt;" +
  "stroke-dasharray:830;stroke-dashoffset:830;animation:siDraw 1.1s cubic-bezier(.65,0,.35,1) .15s forwards}" +
  "#schoolIntro .si-disc{position:absolute;inset:0;border-radius:50%;background:#fff;" +
  "box-shadow:0 18px 50px rgba(0,0,0,.28);transform:scale(.4);opacity:0;animation:siPop .7s cubic-bezier(.2,1.3,.4,1) .25s forwards}" +
  "#schoolIntro .si-logo{position:absolute;inset:4%;width:92%;height:92%;object-fit:contain;" +
  "opacity:0;transform:scale(.7) rotate(-12deg);animation:siLogo .9s cubic-bezier(.2,1.1,.3,1) .5s forwards}" +
  "#schoolIntro .si-shine{position:absolute;inset:0;border-radius:50%;overflow:hidden;pointer-events:none}" +
  "#schoolIntro .si-shine:after{content:'';position:absolute;top:-20%;left:-60%;width:40%;height:140%;" +
  "background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.65),rgba(255,255,255,0));" +
  "transform:skewX(-18deg);animation:siShine 1s ease-in-out 1.45s forwards}" +
  "#schoolIntro h1{margin:34px 0 6px;font-size:clamp(20px,4.6vw,34px);line-height:1.2;letter-spacing:.01em;font-weight:700;" +
  "opacity:0;transform:translateY(14px);animation:siUp .6s cubic-bezier(.2,.8,.2,1) 1.15s forwards}" +
  "#schoolIntro .si-sub{display:flex;align-items:center;gap:10px;font-size:clamp(14px,2.8vw,18px);opacity:0;" +
  "transform:translateY(12px);animation:siUp .6s cubic-bezier(.2,.8,.2,1) 1.45s forwards;color:rgba(255,255,255,.88)}" +
  "#schoolIntro .si-sub b{color:#fff}" +
  "#schoolIntro .si-line{width:0;height:3px;border-radius:3px;background:#fff;margin:18px auto 0;opacity:.85;animation:siLine .7s ease-out 1.7s forwards}" +
  "#schoolIntro .si-skip{position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));min-height:44px;padding:0 18px;" +
  "border-radius:999px;border:1.5px solid rgba(255,255,255,.6);background:rgba(255,255,255,.08);color:#fff;font:inherit;font-weight:700;cursor:pointer}" +
  "#schoolIntro .si-skip:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(255,255,255,.6)}" +
  "@keyframes siDraw{to{stroke-dashoffset:0}}" +
  "@keyframes siPop{to{transform:scale(1);opacity:1}}" +
  "@keyframes siLogo{to{opacity:1;transform:scale(1) rotate(0)}}" +
  "@keyframes siShine{to{left:130%}}" +
  "@keyframes siUp{to{opacity:1;transform:none}}" +
  "@keyframes siLine{to{width:72px}}" +
  "@keyframes siGlow{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}" +
  "@keyframes siOut{to{opacity:0;transform:scale(1.06);visibility:hidden}}" +
  "@media (prefers-reduced-motion:reduce){#schoolIntro *{animation:none!important}" +
  "#schoolIntro .si-disc,#schoolIntro .si-logo,#schoolIntro h1,#schoolIntro .si-sub,#schoolIntro .si-glow{opacity:1!important;transform:none!important}" +
  "#schoolIntro .si-ring circle{stroke-dashoffset:0!important}#schoolIntro .si-line{width:72px!important}" +
  "#schoolIntro{animation:siOut .4s ease 1.6s forwards!important}}";

  var style = document.createElement("style");
  style.id = "schoolIntroStyle"; style.textContent = css;
  var box = document.createElement("div");
  box.id = "schoolIntro"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Welcome");
  box.innerHTML =
    '<div class="si-glow" aria-hidden="true"></div>' +
    '<div class="si-wrap">' +
      '<div class="si-badge">' +
        '<svg class="si-ring" viewBox="0 0 268 268" aria-hidden="true"><circle cx="134" cy="134" r="130"/></svg>' +
        '<div class="si-disc"></div>' +
        '<img class="si-logo" alt="Central Visayan Institute Foundation seal" src="' + LOGO + '">' +
        '<div class="si-shine" aria-hidden="true"></div>' +
      '</div>' +
      '<h1>Central Visayan Institute Foundation</h1>' +
      '<div class="si-sub"><b>School Dental Clinic</b><span aria-hidden="true">·</span><span>Jagna, Bohol</span></div>' +
      '<div class="si-line" aria-hidden="true"></div>' +
    '</div>' +
    '<button type="button" class="si-skip">Skip</button>';

  function close() {
    if (!box.parentNode) return;
    box.style.animation = "siOut .35s ease forwards";
    setTimeout(remove, 360);
  }
  function remove() { if (box.parentNode) box.parentNode.removeChild(box); if (style.parentNode) style.parentNode.removeChild(style); }
  box.addEventListener("click", close);
  box.addEventListener("animationend", function (e) { if (e.target === box && e.animationName === "siOut") remove(); });
  document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); } });

  (document.head || document.documentElement).appendChild(style);
  function mount() { document.body.appendChild(box); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  // safety net: never leave the intro on screen (e.g. if animations are switched off)
  setTimeout(close, 4500);
  try { sessionStorage.setItem("introShown", "1"); } catch (e) {}
  window.replaySchoolIntro = function () { remove(); try { sessionStorage.removeItem("introShown"); } catch (e) {} };
})();
