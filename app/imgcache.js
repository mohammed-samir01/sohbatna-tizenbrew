/* Sohbatna 6.0 — HK_img: poster cache (Cache API → IndexedDB → passthrough).
 * 150 MB cap, LRU eviction by last-use. Never caches non-image responses or files > 3 MB.
 * Revokes object URLs it created when an entry is evicted. Never throws — always resolves to a usable src.
 * Contract: HK_img.url(src) -> Promise<string>; HK_img.attach(imgEl, src). */
(function (root) {
  'use strict';
  var MAX_BYTES = 150 * 1024 * 1024;
  var MAX_FILE = 3 * 1024 * 1024;
  var META_KEY = 'hk.imgcache.meta';
  var backend = null;           // {type, get(key)->Promise<Blob|null>, put(key,blob)->Promise, del(key)}
  var objUrls = Object.create(null);
  var pending = Object.create(null);
  var meta = loadMeta();

  function loadMeta() {
    try {
      var v = JSON.parse(localStorage.getItem(META_KEY));
      if (v && v.items) return v;
    } catch (e) {}
    return { items: {} };
  }
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} }
  function totalSize() { var t = 0; for (var k in meta.items) t += meta.items[k].size; return t; }
  function touch(key, size) { meta.items[key] = { size: size, ts: Date.now() }; saveMeta(); evict(); }
  function evict() {
    var total = totalSize();
    if (total <= MAX_BYTES) return;
    var keys = Object.keys(meta.items).sort(function (a, b) { return meta.items[a].ts - meta.items[b].ts; });
    for (var i = 0; i < keys.length && total > MAX_BYTES; i++) {
      var k = keys[i], sz = meta.items[k] ? meta.items[k].size : 0;
      delete meta.items[k];
      total -= sz;
      if (objUrls[k]) { try { URL.revokeObjectURL(objUrls[k]); } catch (e) {} delete objUrls[k]; }
      if (backend) { try { backend.del(k); } catch (e) {} }
    }
    saveMeta();
  }

  // ---- backend detection: Cache API is unavailable on some file:// contexts (Electron/webOS) ----
  function detectCache() {
    if (!root.caches) return Promise.resolve(false);
    try {
      return caches.open('hk-img-v1').then(function (c) {
        var req = new Request('https://hk-cache-probe.invalid/p');
        return c.put(req, new Response('x')).then(function () { return c.match(req); })
          .then(function (r) { try { c.delete(req); } catch (e) {} return !!r; });
      }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  function makeCacheBackend() {
    var cp = caches.open('hk-img-v1');
    return {
      type: 'cache',
      get: function (key) { return cp.then(function (c) { return c.match(key); }).then(function (r) { return r ? r.blob() : null; }).catch(function () { return null; }); },
      put: function (key, blob) { return cp.then(function (c) { return c.put(key, new Response(blob)); }).catch(function () {}); },
      del: function (key) { cp.then(function (c) { c.delete(key); }).catch(function () {}); }
    };
  }
  var idbP = null;
  function openIdb() {
    if (idbP) return idbP;
    idbP = new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open('hk-img', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('blobs'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
    return idbP;
  }
  function detectIdb() {
    if (!root.indexedDB) return Promise.resolve(false);
    return openIdb().then(function () { return true; }).catch(function () { return false; });
  }
  function makeIdbBackend() {
    return {
      type: 'idb',
      get: function (key) {
        return openIdb().then(function (db) {
          return new Promise(function (resolve) {
            try {
              var tx = db.transaction('blobs', 'readonly');
              var r = tx.objectStore('blobs').get(key);
              r.onsuccess = function () { resolve(r.result || null); };
              r.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
          });
        }).catch(function () { return null; });
      },
      put: function (key, blob) {
        return openIdb().then(function (db) {
          return new Promise(function (resolve) {
            try {
              var tx = db.transaction('blobs', 'readwrite');
              tx.objectStore('blobs').put(blob, key);
              tx.oncomplete = function () { resolve(); };
              tx.onerror = function () { resolve(); };
            } catch (e) { resolve(); }
          });
        }).catch(function () {});
      },
      del: function (key) {
        openIdb().then(function (db) {
          try { db.transaction('blobs', 'readwrite').objectStore('blobs').delete(key); } catch (e) {}
        }).catch(function () {});
      }
    };
  }

  var ready = detectCache().then(function (ok) {
    if (ok) { backend = makeCacheBackend(); return; }
    return detectIdb().then(function (ok2) { if (ok2) backend = makeIdbBackend(); });
  }).catch(function () {});

  var badHost = {};   // 6.0: hosts without CORS (or failing) are not fetched again — the <img> loads them directly
  function hostOf(src) { var m = /^https?:\/\/([^\/?#]+)/i.exec(src); return m ? m[1].toLowerCase() : null; }
  function fetchAndCache(src) {
    var h = hostOf(src);
    if (!h || badHost[h]) return Promise.resolve(src);   // file://, data:, relative app assets: never through fetch
    return fetch(src).then(function (res) {
      if (!res.ok) return src;
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('image/') !== 0) return src; // never cache non-image responses
      return res.blob().then(function (blob) {
        if (!blob || blob.size === 0 || blob.size > MAX_FILE) return src; // never cache > 3 MB
        return backend.put(src, blob).then(function () {
          touch(src, blob.size);
          var u = URL.createObjectURL(blob);
          objUrls[src] = u;
          return u;
        });
      });
    }).catch(function () { badHost[h] = 1; return src; });
  }

  function url(src) {
    if (!src || !hostOf(src)) return Promise.resolve(src);
    if (pending[src]) return pending[src];
    var p = ready.then(function () {
      if (!backend) return src; // passthrough backend
      if (objUrls[src]) return objUrls[src];
      return backend.get(src).then(function (blob) {
        if (blob) {
          var u = URL.createObjectURL(blob);
          objUrls[src] = u;
          touch(src, meta.items[src] ? meta.items[src].size : blob.size);
          return u;
        }
        return fetchAndCache(src);
      });
    }).catch(function () { return src; }).then(
      function (v) { delete pending[src]; return v || src; },
      function () { delete pending[src]; return src; }
    );
    pending[src] = p;
    return p;
  }

  function attach(imgEl, src) {
    if (!imgEl) return;
    if (src) imgEl.src = src; // immediate paint, swapped for the cached blob URL once ready
    // 6.0 QA (LG): only swap in a real cached blob, and only while the <img> still shows `src`. Re-assigning the
    // same dead URL after the page's onerror fallback had already switched to icon.png brought back the browser's
    // broken-image glyph on every logo-less channel row.
    url(src).then(function (u) { if (imgEl && u && u !== src && imgEl.getAttribute('src') === src) imgEl.src = u; }).catch(function () {});
  }

  // Exposed for the coordinator's measurements only (not part of the contract surface).
  function _backendType() { return backend ? backend.type : 'passthrough'; }

  root.HK_img = { url: url, attach: attach, _backendType: _backendType, _ready: ready };
})(typeof window !== 'undefined' ? window : this);
