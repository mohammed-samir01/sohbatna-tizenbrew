/* Sohbatna 7.0 — appearance (light/dark/system) picker, window.HK_theme.
   Pairs with tokens7.css (html[data-theme=light|dark] + the prefers-color-scheme fallback for
   'system'). Same pattern as accent.js: localStorage key 'hk.theme', applied as soon as this
   script runs (placed right after tokens7.css/accent.js, before style.css) so there is no
   flash of the wrong theme. Values: 'dark' (default), 'light', 'system'.
   The video player and its overlays always render dark regardless of this setting — player.css
   rules never read html[data-theme], they use fixed dark colours on purpose. */
(function () {
  var KEY = 'hk.theme';
  var MODES = ['dark', 'light', 'system'];
  var DEFAULT = 'dark';

  function safeGet() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function safeSet(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }

  function normalize(mode) {
    return MODES.indexOf(mode) >= 0 ? mode : DEFAULT;
  }

  function get() {
    return normalize(safeGet());
  }

  function apply(mode) {
    var html = document.documentElement;
    var m = normalize(mode);
    if (m === 'system') html.removeAttribute('data-theme');   // tokens7.css prefers-color-scheme fallback decides
    else html.dataset.theme = m;
  }

  function set(mode) {
    var v = normalize(mode);
    safeSet(v);
    apply(v);
    return v;
  }

  apply(get());

  window.HK_theme = { list: function () { return MODES.slice(); }, get: get, set: set };
})();
