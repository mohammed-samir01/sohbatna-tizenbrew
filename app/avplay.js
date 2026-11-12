/* Sohbatna — Tizen AVPlay adapter.
 * Samsung's Tizen webview is widely reported (unverified by us on a real set — see docs/tv/SAMSUNG-BROWSER.md
 * and the AscendedStarr field guide this was based on) to block MSE `blob:` media sources, which is what
 * hls.js/mpegts.js both rely on. window.webapis.avplay is Samsung's native player API and is the Tizen-safe path.
 *
 * This file is loaded on every platform (see index.html) but is a no-op everywhere except a Tizen webview
 * that actually exposes window.webapis.avplay — app.js's attach() only calls HK_avplay.attach(...) when
 * window.HK_TIZEN_AVPLAY is true (set by platform.js). hls.js/mpegts.js remain the only path on
 * Windows/webOS/web, and remain the FALLBACK on Tizen too if AVPlay itself throws (see isSupported()).
 *
 * AVPlay renders video compositing *underneath* the HTML layer via setDisplayRect — there is no <video>
 * frame to draw into. To keep every existing call site in app.js (video.play()/.pause()/.currentTime/
 * .duration/.paused, 'timeupdate'/'ended' events, the seek bar, the 10s watchdog, etc.) working unmodified,
 * this adapter installs a thin SHIM on the real <video> element: it overrides play/pause/currentTime/
 * duration/paused to proxy to AVPlay, makes the element visually transparent (AVPlay draws behind it) and
 * synthesises the DOM events app.js already listens for. destroy() restores the original <video> behaviour.
 *
 * Required Tizen privilege (tizen/config.xml): http://developer.samsung.com/privilege/avplay
 * API reference: https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api/avplay-api.html
 */
(function () {
  'use strict';

  function avplayApi() { return window.webapis && window.webapis.avplay; }
  function isSupported() { return !!avplayApi(); }
  // tizen.tvaudiocontrol controls the TV's real audio output (privilege http://tizen.org/privilege/tv.audio,
  // declared in tizen/config.xml). AVPlay renders its own decoded audio outside the HTML <video> element, so
  // without this, setting video.muted/video.volume (app.js's setVolume/toggleMute, and the Adhan auto-mute at
  // live prayer times) would silently do nothing on a real Tizen set — see tizen/README.md bug log.
  function audioApi() { return window.tizen && window.tizen.tvaudiocontrol; }

  function AVPlayEngine(video, url, opts) {
    this.video = video;
    this.url = url;
    this.opts = opts || {};
    this._destroyed = false;
    this._state = 'IDLE'; // IDLE -> READY -> PLAYING -> PAUSED -> ENDED
    this._durationMs = 0;
    this._rectTimer = null;
    this._tickTimer = null;
    this._muted = false;
    this._volume = 1;
    this._installShim();
    this._open();
  }

  AVPlayEngine.prototype._rect = function () {
    var r = this.video.getBoundingClientRect();
    var w = Math.round(r.width) || window.innerWidth || 1920;
    var h = Math.round(r.height) || window.innerHeight || 1080;
    return [Math.round(r.left) || 0, Math.round(r.top) || 0, w, h];
  };

  // ---- shim: makes the real <video> element behave like it's playing, for every existing caller ----
  AVPlayEngine.prototype._installShim = function () {
    var video = this.video, self = this;
    if (!video.__hkAvplaySaved) {
      video.__hkAvplaySaved = {
        play: video.play, pause: video.pause,
        currentTime: Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'currentTime'),
        duration: Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'duration'),
        paused: Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'paused'),
        muted: Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'muted'),
        volume: Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'volume'),
        opacity: video.style.opacity
      };
    }
    video.play = function () { self.play(); return Promise.resolve(); };
    video.pause = function () { self.pause(); };
    try {
      Object.defineProperty(video, 'currentTime', { configurable: true, get: function () { return self.getCurrentTime() / 1000; }, set: function (v) { self.seek(v * 1000); } });
      Object.defineProperty(video, 'duration', { configurable: true, get: function () { return self._durationMs / 1000; } });
      Object.defineProperty(video, 'paused', { configurable: true, get: function () { return self._state !== 'PLAYING'; } });
      // Bug fix: app.js's setVolume()/toggleMute() (and the live Adhan auto-mute) set video.muted/video.volume
      // expecting it to actually silence/adjust playback. AVPlay has no decoded audio in this <video> element —
      // real audio control on Tizen goes through tizen.tvaudiocontrol (TV-wide mute/volume). Proxy both here so
      // every existing caller keeps working unmodified, same shim pattern as currentTime/duration/paused above.
      Object.defineProperty(video, 'muted', { configurable: true, get: function () { return self._muted; }, set: function (v) { self.setMuted(!!v); } });
      Object.defineProperty(video, 'volume', { configurable: true, get: function () { return self._volume; }, set: function (v) { self.setVolume(v); } });
    } catch (e) { /* older engines may not allow redefining these — AVPlay still plays, just UI sync degrades */ }
    video.style.opacity = '0'; // AVPlay draws under the web layer at setDisplayRect's coordinates
    this._rectTimer = setInterval(function () { if (!self._destroyed) self.setDisplayRect(); }, 1000);
  };

  AVPlayEngine.prototype._restoreShim = function () {
    var video = this.video, saved = video.__hkAvplaySaved;
    clearInterval(this._rectTimer);
    if (!saved) return;
    try {
      video.play = saved.play; video.pause = saved.pause;
      Object.defineProperty(video, 'currentTime', saved.currentTime);
      Object.defineProperty(video, 'duration', saved.duration);
      Object.defineProperty(video, 'paused', saved.paused);
      Object.defineProperty(video, 'muted', saved.muted);
      Object.defineProperty(video, 'volume', saved.volume);
      video.style.opacity = saved.opacity || '';
      // Leave the TV's real mute/volume as the user left it (restoring them to "unmuted/100%" on every
      // detach — e.g. every channel zap, see app.js's detach() — would undo the user's own TV remote changes).
    } catch (e) {}
    delete video.__hkAvplaySaved;
  };

  AVPlayEngine.prototype._dispatch = function (name) {
    try { this.video.dispatchEvent(new Event(name)); } catch (e) {}
  };

  AVPlayEngine.prototype._open = function () {
    var self = this, AV = avplayApi();
    try {
      AV.open(this.url);
      var rect = this._rect();
      AV.setDisplayRect(rect[0], rect[1], rect[2], rect[3]);
      // seed the shim's muted/volume from the TV's real current state so the UI (mute icon, volume
      // slider) doesn't silently reset to "unmuted/100%" on every attach (every channel zap on live TV).
      try { var AC = audioApi(); if (AC) { this._muted = !!AC.isMute(); this._volume = AC.getVolume() / 100; } } catch (e) {}
      AV.setListener({
        onbufferingstart: function () { self._dispatch('waiting'); },
        onbufferingcomplete: function () { self._dispatch('canplay'); },
        onstreamcompleted: function () { self._state = 'ENDED'; self._dispatch('ended'); },
        oncurrentplaytime: function () { self._dispatch('timeupdate'); },
        onerror: function (eventType) { self._onError(eventType); },
        onsubtitlechange: function () {},
        onevent: function () {}
      });
      AV.prepareAsync(function () {
        if (self._destroyed) return;
        try { self._durationMs = AV.getDuration() || 0; } catch (e) {}
        self._state = 'READY';
        self.play();
      }, function (err) { self._onError(err); });
    } catch (e) { self._onError(e); }
  };

  AVPlayEngine.prototype._onError = function (err) {
    if (this._destroyed) return;
    if (typeof this.opts.onError === 'function') { try { this.opts.onError(err); } catch (e) {} }
    this._dispatch('error');
  };

  AVPlayEngine.prototype.play = function () {
    if (this._destroyed) return;
    try {
      avplayApi().play(); this._state = 'PLAYING'; this._dispatch('play'); this._dispatch('playing');
      clearInterval(this._tickTimer); var self = this;
      this._tickTimer = setInterval(function () { if (!self._destroyed) self._dispatch('timeupdate'); }, 500);
    } catch (e) { this._onError(e); }
  };
  AVPlayEngine.prototype.pause = function () {
    if (this._destroyed) return;
    try { avplayApi().pause(); this._state = 'PAUSED'; this._dispatch('pause'); } catch (e) {}
  };
  AVPlayEngine.prototype.seek = function (ms) {
    if (this._destroyed) return;
    try { avplayApi().seekTo(Math.max(0, Math.round(ms))); } catch (e) {}
  };
  AVPlayEngine.prototype.getDuration = function () { return this._durationMs; };
  AVPlayEngine.prototype.getCurrentTime = function () {
    try { return avplayApi().getCurrentTime() || 0; } catch (e) { return 0; }
  };
  AVPlayEngine.prototype.setDisplayRect = function () {
    try { var r = this._rect(); avplayApi().setDisplayRect(r[0], r[1], r[2], r[3]); } catch (e) {}
  };
  // real TV audio — tizen.tvaudiocontrol (requires tizen:privilege http://tizen.org/privilege/tv.audio in
  // config.xml). Falls back to tracking state locally (UI stays in sync) if the API/privilege is missing,
  // same best-effort pattern as every other try/catch in this file.
  AVPlayEngine.prototype.setMuted = function (muted) {
    this._muted = !!muted;
    try { var AC = audioApi(); if (AC) AC.setMute(this._muted); } catch (e) {}
  };
  AVPlayEngine.prototype.setVolume = function (v) {
    v = Math.max(0, Math.min(1, +v || 0));
    this._volume = v;
    try { var AC = audioApi(); if (AC) AC.setVolume(Math.round(v * 100)); } catch (e) {}
  };
  // called by app.js's detach() — same contract as the hls.js/mpegts.js engine objects it already destroys
  AVPlayEngine.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    clearInterval(this._tickTimer); clearInterval(this._rectTimer);
    try { avplayApi().stop(); } catch (e) {}
    try { avplayApi().close(); } catch (e) {}
    this._restoreShim();
  };

  window.HK_avplay = {
    isSupported: isSupported,
    // attach(video, url, opts) -> engine object with .destroy() (opts.live, opts.onError(err))
    attach: function (video, url, opts) { return new AVPlayEngine(video, url, opts || {}); }
  };
})();
