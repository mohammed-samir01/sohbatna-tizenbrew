/* Sohbatna 6.0 — HK_chandb: channel identification from iptv-org/database metadata only (Unlicense).
 * Contract (docs/redesign-6.0/CONTRACT.md Wave 4, PLAN 6ج F15):
 *   ensure() -> Promise           fetch server/public/data/chandb-v1.json once, cache (IndexedDB),
 *                                  re-fetch at most every 30 days.
 *   match(name, tvgId) -> {id, country, categories, nsfw, blocked} | null   — never throws.
 * HARD LEGAL RULE: this file is metadata (names/countries/categories) only — no channel URLs, no
 * iptv-org/epg. The JSON it loads is built by tools/build_chandb.py and only ever comes from our
 * own server (sohbatna.com); it is never used to suggest or provide channels.
 */
(function (root) {
  'use strict';

  var DB_URL = 'https://sohbatna.com/data/chandb-v1.json';
  var REFRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  var IDB_NAME = 'hk_chandb', IDB_STORE = 'kv', IDB_KEY = 'main';

  var mem = { fetchedAt: 0, rows: null, byId: null, byName: null };

  // ---- Arabic-aware name normalisation --------------------------------------------------------
  var TASHKEEL_RE = /[\u064B-\u0652\u0670\u0640]/g; // fatha..shadda/sukun, superscript alef, tatweel
  var QUALITY_RE = /\b(hd|fhd|uhd|shd|sd|hq|4k|8k)\b|\+ ?\d+\b/gi;
  var BRACKETS_RE = /\[[^\]]*\]|\([^)]*\)/g;
  var COUNTRY_PREFIX_RE = /^[a-z]{2,3}\s*[:\-|]\s*/i;
  var PUNCT_RE = /[|_:,\-]+/g;

  function normalize(raw) {
    if (!raw) return '';
    var s = String(raw);
    s = s.replace(BRACKETS_RE, ' ');
    s = s.replace(COUNTRY_PREFIX_RE, '');
    s = s.replace(QUALITY_RE, ' ');
    s = s.toLowerCase();
    // Arabic normalisation: alef forms, ya/alef-maqsura, ta marbuta, tashkeel, tatweel
    s = s.replace(TASHKEEL_RE, '');
    s = s.replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627'); // آ أ إ ٱ -> ا
    s = s.replace(/[\u0649]/g, '\u064A'); // ى -> ي
    s = s.replace(/\u0629/g, '\u0647'); // ة -> ه
    s = s.replace(PUNCT_RE, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  // ---- IndexedDB (best-effort; falls back to memory-only on any failure) ----------------------
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('no indexedDB')); return; }
      var req = root.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        try { req.result.createObjectStore(IDB_STORE); } catch (e) {}
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('indexedDB open failed')); };
    });
  }

  function idbGet() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(IDB_STORE, 'readonly');
          var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { reject(req.error || new Error('get failed')); };
        } catch (e) { reject(e); }
      });
    });
  }

  function idbSet(record) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(record, IDB_KEY);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  // ---- index building --------------------------------------------------------------------------
  function buildIndex(payload) {
    var rows = (payload && payload.rows) || [];
    var byId = {}, byName = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var id = r[0], name = r[1], alt = r[2] || [], country = r[3] || '', cats = r[4] || [], nsfw = !!r[5], blocked = !!r[6];
      var info = { id: id, country: country, categories: cats, nsfw: nsfw, blocked: blocked };
      if (id && !byId[id]) byId[id] = info;
      var names = [name].concat(alt);
      for (var j = 0; j < names.length; j++) {
        var n = normalize(names[j]);
        if (n && !byName[n]) byName[n] = info;
      }
    }
    mem.rows = rows; mem.byId = byId; mem.byName = byName;
  }

  function isFresh(ts) { return typeof ts === 'number' && (Date.now() - ts) < REFRESH_MS; }

  function fetchFresh() {
    return fetch(DB_URL).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json();
    }).then(function (payload) {
      buildIndex(payload);
      mem.fetchedAt = Date.now();
      return idbSet({ fetchedAt: mem.fetchedAt, payload: payload }).then(function () { return true; });
    });
  }

  function ensure() {
    try {
      if (mem.byId && isFresh(mem.fetchedAt)) return Promise.resolve(true);
      return idbGet().then(function (rec) {
        if (rec && isFresh(rec.fetchedAt)) {
          buildIndex(rec.payload);
          mem.fetchedAt = rec.fetchedAt;
          return true;
        }
        return fetchFresh().catch(function () {
          // network failed: fall back to stale cached copy if any, else give up quietly.
          if (rec && rec.payload) { buildIndex(rec.payload); mem.fetchedAt = rec.fetchedAt || 0; return true; }
          return false;
        });
      }).catch(function () {
        // IndexedDB entirely unavailable: memory-only, still try the network once.
        return fetchFresh().catch(function () { return false; });
      });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function match(name, tvgId) {
    try {
      if (!mem.byId && !mem.byName) return null;
      if (tvgId && mem.byId[tvgId]) return mem.byId[tvgId];
      var n = normalize(name);
      if (n && mem.byName[n]) return mem.byName[n];
      return null;
    } catch (e) {
      return null;
    }
  }

  root.HK_chandb = { ensure: ensure, match: match, _normalize: normalize };
})(typeof window !== 'undefined' ? window : this);
