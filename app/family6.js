/* Sohbatna 6.0 — HK_family: senior mode, kids daily limit, sleep "to end of episode" (web/LG/Windows).
 * Contract (docs/redesign-6.0/CONTRACT.md Wave 4, PLAN 6ج F16/F17/F18):
 *   senior(on?) -> boolean           toggles html.senior + localStorage hk.senior; coordinator wires
 *                                     it to the existing interface-size setting and the fx level.
 *   kidsLimit.get()/set(minutes)/tick(ms)/expired()   per local-calendar-day budget, localStorage
 *                                     hk.kidsLimit = {minutes, day, usedMs}, survives restarts.
 *   armEndOfEpisode(video, onEnd) -> disarm()   resolves at 'ended' or currentTime >= duration-0.5.
 */
(function (root) {
  'use strict';

  var SENIOR_KEY = 'hk.senior';
  var KIDS_KEY = 'hk.kidsLimit';

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---- senior mode -----------------------------------------------------------------------------
  function readSenior() {
    try { return root.localStorage.getItem(SENIOR_KEY) === '1'; } catch (e) { return false; }
  }
  function writeSenior(on) {
    try { root.localStorage.setItem(SENIOR_KEY, on ? '1' : '0'); } catch (e) {}
  }
  function applySeniorClass(on) {
    try {
      var cl = root.document.documentElement.classList;
      if (on) cl.add('senior'); else cl.remove('senior');
    } catch (e) {}
  }

  var seniorState = readSenior();
  applySeniorClass(seniorState);

  function senior(on) {
    if (arguments.length > 0) {
      seniorState = !!on;
      writeSenior(seniorState);
      applySeniorClass(seniorState);
    }
    return seniorState;
  }

  // ---- kids daily limit --------------------------------------------------------------------------
  function readKids() {
    var def = { minutes: 0, day: todayKey(), usedMs: 0 };
    try {
      var raw = root.localStorage.getItem(KIDS_KEY);
      if (!raw) return def;
      var v = JSON.parse(raw);
      if (!v || typeof v !== 'object') return def;
      var minutes = typeof v.minutes === 'number' ? v.minutes : 0;
      var day = typeof v.day === 'string' ? v.day : todayKey();
      var usedMs = typeof v.usedMs === 'number' ? v.usedMs : 0;
      if (day !== todayKey()) { day = todayKey(); usedMs = 0; } // new calendar day: budget resets
      return { minutes: minutes, day: day, usedMs: usedMs };
    } catch (e) { return def; }
  }
  function writeKids(v) {
    try { root.localStorage.setItem(KIDS_KEY, JSON.stringify(v)); } catch (e) {}
  }

  var kidsLimit = {
    get: function () { return readKids(); },
    set: function (minutes) {
      var v = readKids();
      v.minutes = Math.max(0, Number(minutes) || 0);
      writeKids(v);
      return v;
    },
    tick: function (ms) {
      var v = readKids();
      v.usedMs = Math.max(0, v.usedMs + (Number(ms) || 0));
      writeKids(v);
      return v;
    },
    expired: function () {
      var v = readKids();
      if (!v.minutes || v.minutes <= 0) return false; // no limit configured
      return v.usedMs >= v.minutes * 60000;
    }
  };

  // ---- sleep timer: "to end of episode" ----------------------------------------------------------
  function armEndOfEpisode(video, onEnd) {
    if (!video || typeof onEnd !== 'function') return function () {};
    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      disarm();
      try { onEnd(); } catch (e) {}
    }
    function onEnded() { fire(); }
    function onTimeUpdate() {
      try {
        if (video.duration && isFinite(video.duration) && video.currentTime >= video.duration - 0.5) fire();
      } catch (e) {}
    }
    function disarm() {
      try {
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('timeupdate', onTimeUpdate);
      } catch (e) {}
    }
    video.addEventListener('ended', onEnded);
    video.addEventListener('timeupdate', onTimeUpdate);
    return disarm;
  }

  // ---- senior mode baseline styling (coordinator wires the actual interface-size setting / fx) --
  try {
    var style = root.document.createElement('style');
    style.setAttribute('data-hk', 'family6-senior');
    style.textContent =
      ':root{--senior-mult:1.25;}' +
      'html.senior{font-size:calc(1em * var(--senior-mult));}' +
      'html.senior :focus,html.senior .focusable:focus,html.senior [tabindex]:focus{' +
      'outline:4px solid var(--accent, #46D8D1);outline-offset:2px;}';
    root.document.head.appendChild(style);
  } catch (e) {}

  root.HK_family = { senior: senior, kidsLimit: kidsLimit, armEndOfEpisode: armEndOfEpisode };
})(typeof window !== 'undefined' ? window : this);
