/* Sohbatna 6.0 — F23 accent theme picker (Wave 5, window.HK_accent).
   Pairs with themes6.css (html.accent-<name> classes). Loaded like the other HK_* globals;
   apply ASAP after html exists so there is no flash of the wrong accent (script tag placed
   right after tokens.css / before style.css is recommended, but calling set()/apply on
   DOMContentLoaded also works since the class only changes CSS variables, not layout).
   Storage key: hk.accent (localStorage), independent from any Electron/webOS store so it
   works identically on every platform this file loads on.
   7.0: default accent is now 'amber' (broadcast amber, the new brand colour). A value already
   saved in storage — including an explicit 'teal' — always keeps applying; only an unset/unknown
   value falls back to the new default. Mirrors the Android app's isUnset→amber rule. */
(function () {
  var KEY = 'hk.accent';
  var NAMES = ['amber', 'teal', 'gold', 'blue', 'wine', 'green'];
  var DEFAULT = 'amber';   // 7.0: broadcast amber is the new default; 'teal' (old 6.0 default) is now
                            // just another explicit choice — unset/unknown storage falls back to amber.

  function safeGet() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function safeSet(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }

  function normalize(name) {
    return NAMES.indexOf(name) >= 0 ? name : DEFAULT;
  }

  function get() {
    return normalize(safeGet());
  }

  function applyClass(name) {
    var html = document.documentElement;
    NAMES.forEach(function (n) { html.classList.remove('accent-' + n); });
    html.classList.add('accent-' + normalize(name));
  }

  function set(name) {
    var v = normalize(name);
    safeSet(v);
    applyClass(v);
    return v;
  }

  function list() {
    return NAMES.slice();
  }

  // apply immediately on load (script executes synchronously as soon as it is parsed)
  applyClass(get());

  window.HK_accent = { list: list, get: get, set: set };
})();
