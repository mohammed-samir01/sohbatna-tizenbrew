/* Sohbatna 6.0 — HK_fx3d: CSS-3D + canvas-particle touches (decision 0.22: zero 3D libs, zero video).
 * Honours html.fx-full / fx-lite / fx-off and prefers-reduced-motion; draws zero frames when off/hidden.
 * Contract: HK_fx3d.splash(el); HK_fx3d.particles(canvasEl) -> {start, stop}; HK_fx3d.flip(fromEl, toRect, done). */
(function (root) {
  'use strict';

  function level() {
    var c = document.documentElement.classList;
    if (c.contains('fx-off')) return 'off';
    if (c.contains('fx-tv')) return 'full';   // 7.0.6: TV gets the one-shot splash/particles/flip like the PC
    if (c.contains('fx-lite')) return 'lite';
    return 'full';
  }
  function reducedMotion() {
    try { return !!(root.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  injectStyle();
  function injectStyle() {
    if (document.getElementById('hk6-fx3d-style')) return;
    var s = document.createElement('style'); s.id = 'hk6-fx3d-style';
    s.textContent =
      '.hk6-splash-full{animation:hk6SplashSpin 1.5s cubic-bezier(.22,1,.36,1) both;transform-style:preserve-3d;backface-visibility:hidden}' +
      '@keyframes hk6SplashSpin{0%{transform:perspective(900px) rotateY(0deg) scale(.92);filter:brightness(1)}50%{transform:perspective(900px) rotateY(200deg) scale(1.02);filter:brightness(1.4)}100%{transform:perspective(900px) rotateY(360deg) scale(1);filter:brightness(1)}}' +
      '.hk6-splash-lite{animation:hk6Fade .5s ease both}' +
      '@keyframes hk6Fade{from{opacity:0}to{opacity:1}}' +
      '.hk6-flipcard{position:fixed;z-index:9999;pointer-events:none;will-change:transform;backface-visibility:hidden}';
    document.head.appendChild(s);
  }

  // ---- splash(el): logo spin + sheen once, 1.5 s (full); fade only (lite); instant (off) ----
  function splash(el) {
    if (!el) return;
    el.classList.remove('hk6-splash-full', 'hk6-splash-lite');
    if (reducedMotion()) return;
    var lvl = level();
    if (lvl === 'off') return;
    el.classList.add(lvl === 'lite' ? 'hk6-splash-lite' : 'hk6-splash-full');
    var handler = function () {
      el.classList.remove('hk6-splash-full', 'hk6-splash-lite');
      el.removeEventListener('animationend', handler);
    };
    el.addEventListener('animationend', handler);
  }

  // ---- particles(canvas): <=60 soft dots, rAF only while running + tab visible; DPR capped 1.5 ----
  function particles(canvas) {
    var api = { start: function () {}, stop: function () {} };
    if (!canvas) return api;
    var running = false, raf = null, ctx = null, pts = [];
    var dpr = Math.min(root.devicePixelRatio || 1, 1.5);

    function resize() {
      var w = canvas.clientWidth || canvas.width || 300, h = canvas.clientHeight || canvas.height || 150;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function initPts() {
      var w = canvas.clientWidth || 300, h = canvas.clientHeight || 150;
      var n = Math.min(60, Math.max(10, Math.round((w * h) / 18000)));
      pts = [];
      for (var i = 0; i < n; i++) {
        pts.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12, r: 1 + Math.random() * 2, a: 0.15 + Math.random() * 0.35 });
      }
    }
    function step() {
      if (!running) return;
      var w = canvas.clientWidth || 300, h = canvas.clientHeight || 150;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#46D8D1';
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; else if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; else if (p.y > h) p.y = 0;
        ctx.globalAlpha = p.a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = root.requestAnimationFrame(step);
    }
    function startLoop() { if (!raf) raf = root.requestAnimationFrame(step); }
    function stopLoop() { if (raf) { root.cancelAnimationFrame(raf); raf = null; } }
    function onVis() { if (document.hidden) stopLoop(); else if (running) startLoop(); }

    api.start = function () {
      var lvl = level();
      if (lvl !== 'full' || reducedMotion()) return; // lite/off: no particles at all (perf budget)
      if (running) return;
      try { ctx = canvas.getContext('2d'); } catch (e) { return; }
      if (!ctx) return;
      resize(); initPts();
      running = true;
      document.addEventListener('visibilitychange', onVis);
      if (!document.hidden) startLoop();
    };
    api.stop = function () {
      running = false;
      stopLoop();
      document.removeEventListener('visibilitychange', onVis);
    };
    return api;
  }

  // ---- flip(fromEl, toRect, done): 180° card flip via Web Animations API; instant fallback otherwise ----
  function flip(fromEl, toRect, done) {
    done = done || function () {};
    var lvl = level();
    if (lvl !== 'full' || reducedMotion() || !fromEl || !toRect || typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
      done();
      return;
    }
    try {
      var r = fromEl.getBoundingClientRect();
      var clone = fromEl.cloneNode(true);
      clone.className = 'hk6-flipcard';
      clone.style.left = r.left + 'px';
      clone.style.top = r.top + 'px';
      clone.style.width = r.width + 'px';
      clone.style.height = r.height + 'px';
      clone.style.margin = '0';
      document.body.appendChild(clone);
      var dx = (toRect.left - r.left) + (toRect.width - r.width) / 2;
      var dy = (toRect.top - r.top) + (toRect.height - r.height) / 2;
      var sx = r.width ? (toRect.width / r.width) : 1;
      var sy = r.height ? (toRect.height / r.height) : 1;
      var anim = clone.animate([
        { transform: 'translate(0px,0px) scale(1,1) rotateY(0deg)' },
        { transform: 'translate(' + (dx / 2) + 'px,' + (dy / 2) + 'px) scale(' + ((1 + sx) / 2) + ',' + ((1 + sy) / 2) + ') rotateY(90deg)' },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ') rotateY(180deg)' }
      ], { duration: 620, easing: 'cubic-bezier(0.65,0,0.35,1)' });
      var cleanup = function () { try { clone.remove(); } catch (e) {} done(); };
      anim.onfinish = cleanup;
      anim.oncancel = cleanup;
    } catch (e) { done(); }
  }

  root.HK_fx3d = { splash: splash, particles: particles, flip: flip };
})(typeof window !== 'undefined' ? window : this);
