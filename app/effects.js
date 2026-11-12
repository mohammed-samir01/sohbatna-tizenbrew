/* Sohbatna 5.14 — effects level (premium motion without stutter on weak TVs).
 * html.fx-full : every effect (glow + lift on focus, light sweep, Ken Burns hero, glass player bar, page slide)
 * html.fx-lite : same look, cheaper: no blur, no animated shadows/sweep/Ken Burns, fades only — TVs and ≤2 GB devices
 * html.fx-off  : no motion at all — "reduce motion" in the system, or chosen in Settings
 * Settings → «الحركة والتأثيرات»: auto (default) / full / lite / off  (prefs.fx)
 */
(function () {
  var root = document.documentElement;
  function autoLevel() {
    try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off'; } catch (e) {}
    if (root.classList.contains('tv')) return 'lite';
    var mem = navigator.deviceMemory, cpu = navigator.hardwareConcurrency;
    if ((mem && mem <= 2) || (cpu && cpu <= 2)) return 'lite';
    return 'full';
  }
  window.HK_fx = function (pref) {
    var lvl = pref === 'full' || pref === 'lite' || pref === 'off' ? pref : autoLevel();
    root.classList.remove('fx-full', 'fx-lite', 'fx-off', 'fx-tv');
    root.classList.add('fx-' + lvl);
    // 7.0.6: TVs (lite) also get the PC's one-shot motions — page slide, dialog pop, hero camera move, poster flip,
    // hero button pulse, screensaver particles (theme7.css html.fx-tv). The per-focus effects (3D lift, sheen,
    // ambient glow, sliding ring) stay PC-only: measured on a 1 GB LG they drop card browsing from ~50 to ~35 fps.
    if (lvl === 'lite' && root.classList.contains('tv')) root.classList.add('fx-tv');
    window.HK_FX = lvl;
    return lvl;
  };
  window.HK_fx('auto');
})();
