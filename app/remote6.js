/* 6.0 wave 5 (F21 / decision 0.30): HK_remote — phone-as-remote, device side (TV/PC/phone running
 * the app). Pairs with the server's RemoteController (server/app/Http/Controllers/Api/RemoteController.php)
 * and the phone page at resources/views/site/remote.blade.php.
 *
 * API (CONTRACT.md): HK_remote.start() -> Promise<{code, qrUrl}>, HK_remote.stop(), HK_remote.onCommand(cb).
 * - start() calls POST /api/v1/remote/open, remembers {code, token}, renders nothing itself (the
 *   caller shows `code`/`qrUrl` as it likes, e.g. with qrcode.js already loaded by index.html) and
 *   begins polling GET /api/v1/remote/{token}/poll?after=<id> once a second.
 * - Every command the poll returns is delivered, in order, to every callback registered with
 *   onCommand(cb) as cb(cmd, arg) (arg is null for commands that carry none).
 * - Idle auto-stop: any activity (a command arriving) resets a 30-minute timer; if nothing arrives
 *   for 30 minutes the polling stops on its own (mirrors the server's sliding session TTL) so a
 *   forgotten remote session doesn't poll forever.
 * - stop() is also safe to call when never started, or twice; app.js/platform code must guard
 *   `window.HK_remote && window.HK_remote.start` since this is a 6.0-only, optional feature.
 *
 * Loaded before license.js (see index.html), so it does NOT reuse license.js's API_BASE; it keeps
 * its own, identical constant instead.
 */
(function () {
  'use strict';

  var API_BASE = 'https://sohbatna.com/api/v1/remote/';
  var POLL_MS = 1000;
  var IDLE_MS = 30 * 60 * 1000; // 30 min, mirrors the server's TTL_MIN

  var state = null; // { code, token, after, pollTimer, idleTimer }
  var listeners = [];

  function clearTimers() {
    if (!state) return;
    if (state.pollTimer) clearTimeout(state.pollTimer);
    if (state.idleTimer) clearTimeout(state.idleTimer);
  }

  function armIdle() {
    if (!state) return;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(function () { stop(); }, IDLE_MS);
  }

  function notify(cmd, arg) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](cmd, arg === undefined ? null : arg); } catch (e) {}
    }
  }

  function scheduleNextPoll() {
    if (!state) return;
    state.pollTimer = setTimeout(poll, POLL_MS);
  }

  function poll() {
    if (!state) return;
    var s = state;
    fetch(API_BASE + encodeURIComponent(s.token) + '/poll?after=' + s.after, { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!state || state !== s) return; // stopped (or restarted) while this request was in flight
        if (data && Array.isArray(data.cmds) && data.cmds.length) {
          for (var i = 0; i < data.cmds.length; i++) {
            var c = data.cmds[i];
            if (c && typeof c.id === 'number' && c.id > state.after) state.after = c.id;
            notify(c.cmd, c.arg);
          }
          armIdle();
        }
      })
      .catch(function () {})
      .finally(function () { scheduleNextPoll(); });
  }

  function start() {
    return fetch(API_BASE + 'open', { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('remote_open_failed'); return r.json(); })
      .then(function (data) {
        stop(); // in case start() is called twice
        state = { code: data.code, token: data.token, after: 0, pollTimer: null, idleTimer: null };
        armIdle();
        scheduleNextPoll();
        return { code: data.code, qrUrl: 'https://sohbatna.com/r/' + data.code };
      });
  }

  function stop() {
    clearTimers();
    state = null;
  }

  function onCommand(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  window.HK_remote = { start: start, stop: stop, onCommand: onCommand };
}());
