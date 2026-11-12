/* Sohbatna 6.0 — HK_stream: live stream-quality panel (hls.js / mpegts.js / native playback quality).
 * Samples once per second, only while the panel is visible. Plain-language Arabic diagnosis.
 * Contract: HK_stream.attach(videoEl, {hls, mpegts}) / detach(); HK_stream.panel() -> HTMLElement. */
(function (root) {
  'use strict';
  var T = root.T || function (s) { return s; };
  var st = { videoEl: null, hls: null, mpegts: null, timer: null, panelEl: null, visible: false, obs: null, stallCount: 0, zeroBufCount: 0, waitingHandler: null, visHandler: null };

  injectStyle();
  function injectStyle() {
    if (document.getElementById('hk6-stream-style')) return;
    var s = document.createElement('style'); s.id = 'hk6-stream-style';
    s.textContent =
      '.hk6-stream{font-family:inherit;color:var(--fg-soft,#E6EEF1);background:var(--panel,#111A21);' +
      'border:1px solid var(--border,#22303A);border-radius:var(--r-card,12px);padding:var(--s-3,12px);' +
      'min-width:220px;font-size:var(--fs-small,13px);line-height:1.6}' +
      '.hk6-stream b{color:var(--fg,#fff);font-weight:600}' +
      '.hk6-stream .hk6-diag{margin-top:6px;padding-top:6px;border-top:1px solid var(--border-soft,#1A262F);color:var(--accent,#46D8D1);font-weight:600}' +
      'html.fx-off .hk6-stream{transition:none}';
    document.head.appendChild(s);
  }

  function startTimerIfNeeded() {
    stopTimer();
    if (!st.videoEl || !st.visible) return;
    sample();
    st.timer = setInterval(sample, 1000);
  }
  function stopTimer() { if (st.timer) { clearInterval(st.timer); st.timer = null; } }

  function attach(videoEl, opts) {
    detach();
    st.videoEl = videoEl || null;
    st.hls = (opts && opts.hls) || null;
    st.mpegts = (opts && opts.mpegts) || null;
    st.stallCount = 0;
    st.zeroBufCount = 0;
    if (st.videoEl) {
      st.waitingHandler = function () { st.stallCount++; };
      st.videoEl.addEventListener('waiting', st.waitingHandler);
    }
    startTimerIfNeeded();
  }
  function detach() {
    if (st.videoEl && st.waitingHandler) st.videoEl.removeEventListener('waiting', st.waitingHandler);
    stopTimer();
    st.videoEl = null; st.hls = null; st.mpegts = null; st.waitingHandler = null;
  }

  function computeStats() {
    var v = st.videoEl;
    var width = v.videoWidth || 0, height = v.videoHeight || 0;
    var bandwidth = null, streamBitrate = null, bufferSec = 0, droppedPct = 0;
    try {
      if (st.hls && st.hls.levels) {
        var lvl = st.hls.levels[st.hls.currentLevel];
        if (lvl) { streamBitrate = lvl.bitrate || null; if (lvl.width) width = lvl.width; if (lvl.height) height = lvl.height; }
        bandwidth = st.hls.bandwidthEstimate || null;
      } else if (st.mpegts && typeof st.mpegts.statisticsInfo === 'function') {
        var info = st.mpegts.statisticsInfo();
        if (info && info.speed) bandwidth = info.speed * 8 * 1024; // KB/s -> bits/s
      }
    } catch (e) {}
    try {
      if (v.buffered && v.buffered.length) {
        var end = v.buffered.end(v.buffered.length - 1);
        bufferSec = Math.max(0, end - v.currentTime);
      }
    } catch (e) {}
    try {
      if (typeof v.getVideoPlaybackQuality === 'function') {
        var q = v.getVideoPlaybackQuality();
        if (q && q.totalVideoFrames) droppedPct = (q.droppedVideoFrames / q.totalVideoFrames) * 100;
      }
    } catch (e) {}
    if (bufferSec <= 0.05) st.zeroBufCount++; else st.zeroBufCount = 0;
    return { width: width, height: height, bandwidth: bandwidth, streamBitrate: streamBitrate, bufferSec: bufferSec, droppedPct: droppedPct };
  }

  function diagnose(d) {
    var slowNet = (d.bandwidth && d.streamBitrate && d.bandwidth < d.streamBitrate * 1.2) || st.stallCount >= 2;
    if (slowNet) return 'النت عندك أبطأ من البث';
    if (d.droppedPct > 5) return 'الجهاز بيتعب في فك الفيديو';
    var bandwidthFine = !d.streamBitrate || !d.bandwidth || d.bandwidth >= d.streamBitrate * 1.2;
    if (st.zeroBufCount >= 3 && bandwidthFine) return 'مصدر البث بطيء';
    return 'البث مستقر';
  }

  function fmtKbps(n) { return n ? Math.round(n / 1000) + ' kbps' : '—'; }

  function render(d) {
    if (!st.panelEl) return;
    var diag = diagnose(d);
    var res = d.width && d.height ? (d.width + '×' + d.height) : '—';
    st.panelEl.innerHTML =
      '<div><b>' + T('الدقة') + ':</b> ' + res + '</div>' +
      '<div><b>' + T('معدل البت') + ':</b> ' + fmtKbps(d.streamBitrate) + '</div>' +
      '<div><b>' + T('سرعة النت المقدرة') + ':</b> ' + fmtKbps(d.bandwidth) + '</div>' +
      '<div><b>' + T('المخزن المؤقت') + ':</b> ' + d.bufferSec.toFixed(1) + ' ' + T('ث') + '</div>' +
      '<div><b>' + T('إطارات ضائعة') + ':</b> ' + d.droppedPct.toFixed(1) + '%</div>' +
      '<div><b>' + T('انقطاعات') + ':</b> ' + st.stallCount + '</div>' +
      '<div class="hk6-diag">' + T(diag) + '</div>';
  }

  function sample() {
    if (!st.panelEl || !st.videoEl) return;
    render(computeStats());
  }

  function updateVisible() {
    var intersecting = st.obs ? st.lastIntersecting : true;
    st.visible = !!intersecting && document.visibilityState === 'visible';
    startTimerIfNeeded();
  }

  function panel() {
    if (st.panelEl) return st.panelEl;
    var el = document.createElement('div');
    el.className = 'hk6-stream';
    st.panelEl = el;
    st.lastIntersecting = true;
    if (root.IntersectionObserver) {
      st.obs = new IntersectionObserver(function (entries) {
        st.lastIntersecting = !!(entries[0] && entries[0].isIntersecting);
        updateVisible();
      }, { threshold: 0.01 });
      st.obs.observe(el);
    }
    st.visHandler = updateVisible;
    document.addEventListener('visibilitychange', st.visHandler);
    updateVisible();
    return el;
  }

  root.HK_stream = { attach: attach, detach: detach, panel: panel };
})(typeof window !== 'undefined' ? window : this);
