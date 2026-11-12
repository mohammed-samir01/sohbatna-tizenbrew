/* Sohbatna 6.0 — HK_epg: persisted EPG for instant first paint (IndexedDB → localStorage fallback), TTL 12h.
 * Search is accent/diacritic-insensitive for Arabic (tashkeel stripped, alef/ya/ta-marbuta normalised) and
 * case-insensitive for English, capped at 50 hits, upcoming programmes first.
 * Contract: HK_epg.load(key) / HK_epg.save(key, data); HK_epg.search(query, programmes, channels). */
(function (root) {
  'use strict';
  var TTL = 12 * 3600 * 1000;
  var DB_NAME = 'hk-epg', STORE = 'guide';
  var LS_PREFIX = 'hk.epg.';
  var idbOk = null, idbP = null;

  function openIdb() {
    if (idbP) return idbP;
    idbP = new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
    return idbP;
  }
  function idbAvailable() {
    if (idbOk !== null) return Promise.resolve(idbOk);
    if (!root.indexedDB) { idbOk = false; return Promise.resolve(false); }
    return openIdb().then(function () { idbOk = true; return true; }).catch(function () { idbOk = false; return false; });
  }
  function idbGet(key) {
    return openIdb().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readonly');
          var r = tx.objectStore(STORE).get(key);
          r.onsuccess = function () { resolve(r.result || null); };
          r.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }
  function idbPut(key, rec) {
    return openIdb().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(rec, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  function lsLoad(key) {
    try {
      var rec = JSON.parse(localStorage.getItem(LS_PREFIX + key));
      if (rec && Date.now() - rec.ts < TTL) return rec.data;
    } catch (e) {}
    return null;
  }
  function lsSave(key, rec) {
    try {
      var str = JSON.stringify(rec);
      if (str.length > 4 * 1024 * 1024) return false; // size guard: skip rather than blow the quota
      localStorage.setItem(LS_PREFIX + key, str);
      return true;
    } catch (e) { return false; }
  }

  function load(key) {
    return idbAvailable().then(function (ok) {
      if (ok) return idbGet(key).then(function (rec) { return (rec && Date.now() - rec.ts < TTL) ? rec.data : null; });
      return lsLoad(key);
    }).catch(function () { return lsLoad(key); });
  }
  function save(key, data) {
    var rec = { data: data, ts: Date.now() };
    return idbAvailable().then(function (ok) {
      if (ok) return idbPut(key, rec);
      return lsSave(key, rec);
    }).catch(function () { return lsSave(key, rec); });
  }

  // Arabic-aware normalisation: strip tashkeel/tatweel, unify alef/ya/ta-marbuta variants; Latin case-fold.
  var AR_DIAC = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
  function normalize(s) {
    if (s == null) return '';
    s = String(s)
      .replace(AR_DIAC, '')
      .replace(/[\u0622\u0623\u0625\u0671\u0672\u0673]/g, '\u0627')  // أ إ آ ٱ -> ا
      .replace(/\u0649/g, '\u064A')                                  // ى -> ي
      .replace(/\u0629/g, '\u0647');                                 // ة -> ه
    return s.toLowerCase().trim();
  }

  function search(query, programmes, channels) {
    var q = normalize(query);
    if (!q) return [];
    programmes = programmes || [];
    channels = channels || [];
    var chMap = {};
    channels.forEach(function (c) {
      if (!c) return;
      var id = c.id != null ? c.id : (c.channel_id != null ? c.channel_id : c.channel);
      if (id != null) chMap[id] = c.name || c.title || c.channel || '';
    });
    var now = Date.now();
    var hits = [];
    for (var i = 0; i < programmes.length; i++) {
      var p = programmes[i];
      if (!p) continue;
      var title = p.title || p.name || '';
      var chId = p.channel_id != null ? p.channel_id : p.channel;
      var chName = (chId != null && chMap[chId] != null) ? chMap[chId] : (p.channel_name || '');
      if (normalize(title).indexOf(q) >= 0 || normalize(chName).indexOf(q) >= 0) {
        hits.push({ channel: chName || chId || '', title: title, start: p.start, end: p.end });
        if (hits.length >= 500) break; // keep the sort below cheap; final cut is 50
      }
    }
    hits.sort(function (a, b) {
      var aUp = a.start >= now, bUp = b.start >= now;
      if (aUp && bUp) return a.start - b.start;     // upcoming: soonest first
      if (!aUp && !bUp) return b.start - a.start;   // past: most recent first
      return aUp ? -1 : 1;                           // upcoming before past
    });
    return hits.slice(0, 50);
  }

  root.HK_epg = { load: load, save: save, search: search };
})(typeof window !== 'undefined' ? window : this);
