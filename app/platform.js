/* Sohbatna — platform layer.
 * Electron: preload.js already exposed window.sohbatna (file store + DPAPI + Node HTTP) → nothing to do here.
 * webOS / plain browser: provide the same API on top of localStorage + fetch.
 */
(function () {
  var isWebOS = typeof window.PalmSystem !== 'undefined' || /Web0S|webOS/i.test(navigator.userAgent);
  // Tizen (Samsung TV, wgt app or TizenBrew-hosted): window.tizen is injected by the Tizen webview;
  // the UA also carries "Tizen" on real sets. Dev stub (tizen/dev/) sets window.tizen the same way.
  var isTizen = typeof window.tizen !== 'undefined' || /Tizen/i.test(navigator.userAgent);
  var forceTV = /[?&]tv=1/.test(location.search);
  var platform = window.sohbatna ? 'electron' : isWebOS ? 'webos' : isTizen ? 'tizen' : 'web';
  document.documentElement.classList.add('platform-' + platform);
  var tv = isWebOS || isTizen || forceTV;
  if (tv) document.documentElement.classList.add('tv');

  // ---- Tizen remote + AVPlay flags (consumed by app.js; both are no-ops on webOS/Windows/web) ----
  // HK_TIZEN_AVPLAY: true only when running on a real/stubbed Tizen webview AND webapis.avplay exists.
  // src/avplay.js reads this flag itself too, but app.js checks it before ever touching window.webapis.
  window.HK_TIZEN_AVPLAY = isTizen && !!(window.webapis && window.webapis.avplay);
  if (isTizen) {
    // Samsung remote: non-navigation keys (media/colour/channel) are invisible to the webview until
    // registered — see https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api/tvinputdevice.html
    try {
      if (window.tizen && window.tizen.tvinputdevice && typeof window.tizen.tvinputdevice.registerKey === 'function') {
        ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaRewind', 'MediaFastForward',
          'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'ChannelUp', 'ChannelDown'].forEach(function (k) {
          try { window.tizen.tvinputdevice.registerKey(k); } catch (e) {}
        });
      }
    } catch (e) {}
    // app.js's KC table (webOS keyCodes) is reused as-is for every platform; Tizen sends DIFFERENT
    // codes for Back/Exit, play-pause and channel up/down (colours/other media keys already match).
    // Rather than fork KC, remap at the door: swallow the native Tizen keydown and redispatch an
    // equivalent event carrying the webOS keyCode app.js already understands.
    var TIZEN_REMAP = { 10009: 461, 10182: 461, 10252: 179, 427: 33, 428: 34 }; // Back/Exit, PlayPause, ChUp, ChDn
    document.addEventListener('keydown', function (e) {
      if (e.__hkRemapped) return;
      var mapped = TIZEN_REMAP[e.keyCode];
      if (mapped === undefined) return; // unmapped keys (OK, arrows, digits, colours, rewind/ff) pass through untouched
      e.preventDefault(); e.stopPropagation();
      var ev;
      try { ev = new KeyboardEvent('keydown', { keyCode: mapped, which: mapped, bubbles: true, cancelable: true }); }
      catch (e2) { ev = document.createEvent('Event'); ev.initEvent('keydown', true, true); }
      try { Object.defineProperty(ev, 'keyCode', { value: mapped }); Object.defineProperty(ev, 'which', { value: mapped }); } catch (e3) {}
      ev.__hkRemapped = true;
      (e.target || document).dispatchEvent(ev);
    }, true);
  }

  // ---- 5.13 interface scale: the same layout on every screen size ----
  // The layout is designed for a 1600×900 window (desktop) / 1366×768 (TV, seen from the sofa). Bigger screens scale
  // it up so it fills the screen the same way (1080p ×1.2, 1440p ×1.6, 4K ×2.4 on a PC; 1080p ×1.4 on a TV); smaller
  // windows keep 1:1 and reflow instead. The user can make it smaller/larger in Settings (prefs.uiScale).
  //  • Electron: real page zoom (webFrame) — CSS px, vh and media queries all follow, nothing to correct.
  //  • webOS (old Chromium, no page zoom API): body zoom; --zvh is 1vh corrected for it (plain vh overflowed modals).
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  window.HK_UI = { mult: 1 };
  window.HK_scaleFor = function (w, h, isTv) {
    var s = isTv ? Math.min(w / 1366, h / 768) : Math.min(w / 1600, h / 900);
    return clamp(s, isTv ? 0.9 : 1, 3);
  };
  // 7.0.5: media queries read the REAL viewport (1920×1080 on a TV) even though the body zoom lays the page out at
  // ≈1366×768. Height-dependent rules therefore never fired on TVs (hero title + buttons fell out of the hero).
  // These classes carry the effective layout height so CSS can key on it: eh820 = ≤820px tall, eh700 = ≤700px.
  var markEff = function (h) { var c = document.documentElement.classList; c.toggle('eh820', h <= 820); c.toggle('eh700', h <= 700); };
  window.HK_applyScale = function (mult) {
    if (typeof mult === 'number' && mult > 0) window.HK_UI.mult = mult;
    var m = window.HK_UI.mult, root = document.documentElement;
    if (window.sohbatna && window.sohbatna.zoom && !tv) {
      var cur = window.sohbatna.zoom.get() || 1;
      var w = window.innerWidth * cur, h = window.innerHeight * cur;   // window size in device-independent px
      var z = clamp(window.HK_scaleFor(w, h, false) * m, 0.75, 3.5);
      if (Math.abs(z - cur) > 0.01) window.sohbatna.zoom.set(z);
      window.HK_ZOOM = 1; window.HK_PAGEZOOM = z;
      root.style.setProperty('--zvh', '1vh');
      markEff(window.innerHeight * cur / z);
      return z;
    }
    var bz = tv ? clamp(window.HK_scaleFor(window.innerWidth, window.innerHeight, true) * m, 0.75, 3.5) : m;
    document.body.style.zoom = String(bz); window.HK_ZOOM = bz; window.HK_PAGEZOOM = 1;
    root.style.setProperty('--zvh', (window.innerHeight / bz / 100) + 'px');
    markEff(window.innerHeight / bz);
    return bz;
  };
  // a zoom change also fires "resize" (innerWidth changes): only a real window-size change re-fits
  var lastDev = '';
  var refit = function () {
    var z = window.sohbatna && window.sohbatna.zoom && !tv ? (window.sohbatna.zoom.get() || 1) : 1;
    var dev = Math.round(window.innerWidth * z) + 'x' + Math.round(window.innerHeight * z);
    if (dev === lastDev) return; lastDev = dev;
    clearTimeout(refit.t); refit.t = setTimeout(function () { window.HK_applyScale(); }, 60);
  };
  if (document.body) window.HK_applyScale(); else document.addEventListener('DOMContentLoaded', function () { window.HK_applyScale(); });
  window.addEventListener('resize', refit);

  // Flex `gap` only arrived in Chromium 84; older webOS needs margin fallbacks (see style.css .no-flexgap).
  var probe = document.createElement('div'); probe.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
  probe.appendChild(document.createElement('div')); probe.appendChild(document.createElement('div'));
  document.documentElement.appendChild(probe);
  if (probe.scrollHeight !== 1) document.documentElement.classList.add('no-flexgap');
  probe.remove();

  window.SOHBATNA_PLATFORM = platform;
  if (window.sohbatna) return; // Electron preload (contextBridge objects are frozen — don't touch)

  var NS = 'hooksha:';
  var read = function (k) { try { var v = localStorage.getItem(NS + k); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } };
  var write = function (k, v) { localStorage.setItem(NS + k, JSON.stringify(v)); };
  var profiles = function () { return read('profiles') || []; };
  // 6.0: `type` ('xtream' default | 'm3u' | 'stalker') — old saved profiles have no `type`, kept as 'xtream'.
  var pub = function (p) {
    var type = p.type || 'xtream';
    if (type === 'm3u') return { id: p.id, label: p.label, type: type, url: p.url || '', epgUrl: p.epgUrl || '' };
    if (type === 'stalker') return { id: p.id, label: p.label, type: type, portal: p.portal || '', mac: p.mac || '' };
    return { id: p.id, label: p.label, type: type, server: p.server, username: p.username };
  };

  window.sohbatna = {
    store: { get: function (k) { return Promise.resolve(read(k)); }, set: function (k, v) { write(k, v); return Promise.resolve(true); } },
    profiles: {
      list: function () { return Promise.resolve(profiles().map(pub)); },
      add: function (p) {
        var list = profiles(); var id = String(Date.now());
        var rec = { id: id, label: p.label || ('حساب ' + (list.length + 1)), type: p.type || 'xtream' };
        if (rec.type === 'm3u') { rec.url = p.url || ''; rec.epgUrl = p.epgUrl || ''; rec.m3uFileName = p.m3uFileName || ''; }
        else if (rec.type === 'stalker') { rec.portal = p.portal || ''; rec.mac = p.mac || ''; }
        else { rec.server = p.server; rec.username = p.username; rec.password = p.password; }
        list.push(rec); write('profiles', list); write('active', id); return Promise.resolve(id);
      },
      remove: function (id) {
        var list = profiles().filter(function (p) { return p.id !== id; }); write('profiles', list);
        if (read('active') === id) write('active', list[0] ? list[0].id : null); return Promise.resolve(true);
      },
      setActive: function (id) { write('active', id); return Promise.resolve(true); },
      setEpg: function (id, url) {   // 5.13 optional XMLTV guide link per account
        var u = String(url || '').trim().slice(0, 1000); if (u && !/^https?:\/\//i.test(u)) return Promise.resolve(false);
        var list = profiles(); list.forEach(function (p) { if (p.id === id) p.epgUrl = u; }); write('profiles', list); return Promise.resolve(true);
      },
      setM3uCache: function () { return Promise.resolve(true); },   // 6.0: browser/webOS cache lives in IndexedDB (app.js), not here
      active: function () {
        var list = profiles(), a = read('active'); var p = list.filter(function (p) { return p.id === a; })[0] || list[0] || null;
        if (!p) return Promise.resolve(null);
        var type = p.type || 'xtream';
        if (type === 'm3u') return Promise.resolve({ id: p.id, label: p.label, type: type, url: p.url || '', epgUrl: p.epgUrl || '', m3uFileName: p.m3uFileName || '' });
        if (type === 'stalker') return Promise.resolve({ id: p.id, label: p.label, type: type, portal: p.portal || '', mac: p.mac || '' });
        return Promise.resolve({ id: p.id, label: p.label, type: type, server: p.server, username: p.username, password: p.password, epgUrl: p.epgUrl || '' });
      }
    },
    json: function (url) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var t = ctl && setTimeout(function () { ctl.abort(); }, 20000);
      return fetch(url, { headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (txt) { clearTimeout(t); return JSON.parse(txt); }, function (e) { clearTimeout(t); throw e; });
    },
    // 5.13 XMLTV guide: plain or gzip (DecompressionStream where the TV has it)
    text: function (url) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var t = ctl && setTimeout(function () { ctl.abort(); }, 90000);
      return fetch(url, { signal: ctl ? ctl.signal : undefined }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (ab) {
        clearTimeout(t);
        var b = new Uint8Array(ab);
        if (b[0] === 0x1f && b[1] === 0x8b) {
          if (typeof DecompressionStream === 'undefined') throw new Error('gzip guide not supported on this TV');
          return new Response(new Blob([ab]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
        }
        return new TextDecoder('utf-8').decode(b);
      }, function (e) { clearTimeout(t); throw e; });
    },
    openExternal: function () { return Promise.resolve(false); },
    fullscreen: function () { return Promise.resolve(true); },
    isFullscreen: function () { return Promise.resolve(true); }
  };
})();
