/* Sohbatna 6.0 — Wave 5 "MAC/Stalker" portal client (window.HK_stalker).
   Stalker/Ministra (MAG-style STB) portals: handshake -> token, get_profile, get_genres,
   get_ordered_list (paged, 60k cap on TV), VOD categories + list, series endpoints when the
   portal has them, create_link at play time. Every method returns the SAME shapes X.* returns
   in app.js (read-only reference) so the UI needs no changes when S.profile.type === 'stalker'
   — the coordinator swaps which client object is used, wiring documented in the final report.
   Only ever talks to the user's own portal URL + MAC; nothing is shipped by us. */
(function () {
  'use strict';

  var UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
  var X_UA = 'Model: MAG250; Link: WiFi';
  // Stalker firmwares disagree on where portal.php lives; try the common bases in order and
  // remember whichever answers the handshake first (both "/c/" and "/stalker_portal/" per spec).
  var LOADER_PATHS = ['/portal.php', '/c/portal.php', '/stalker_portal/server/load.php', '/stalker_portal/c/portal.php'];
  var CAP_TV = 60000;
  var CAP_DEFAULT = 200000;
  var MAX_PAGES = 500; // paging safety valve regardless of cap

  function normMac(mac) {
    var raw = String(mac == null ? '' : mac).toUpperCase();
    var compact = raw.replace(/[^0-9A-F]/g, '');
    if (compact.length !== 12) return raw;
    var parts = [];
    for (var i = 0; i < 12; i += 2) parts.push(compact.substr(i, 2));
    return parts.join(':');
  }

  function baseUrl(portal) {
    var s = String(portal == null ? '' : portal).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  }

  function isTvPlatform() {
    try { return document.documentElement.classList.contains('tv'); } catch (e) { return false; }
  }

  /**
   * @param {string} portal portal URL (the provider's own; never a shared/default value)
   * @param {string} mac STB MAC address
   * @param {object} [opts] {fetch, timezone, loaderPath} — fetch is the injectable fetcher
   *   (url, init) -> Promise<Response-like {ok, status, json()}>, defaults to window.fetch.
   */
  function createClient(portal, mac, opts) {
    opts = opts || {};
    var fetcher = opts.fetch || function (url, init) { return fetch(url, init); };
    var timezone = opts.timezone || 'Europe/Kiev';
    var macNorm = normMac(mac);
    var base = baseUrl(portal);
    var loaderPath = opts.loaderPath || null;
    var token = '';
    var cmdCache = {}; // key() -> stalker "cmd" needed by create_link at play time

    function headers() {
      var h = {
        'User-Agent': UA,
        'X-User-Agent': X_UA,
        'Cookie': 'mac=' + macNorm + '; stb_lang=en; timezone=' + timezone
      };
      if (token) h['Authorization'] = 'Bearer ' + token;
      return h;
    }

    function qs(params) {
      var parts = ['JsHttpRequest=1-xml'];
      Object.keys(params).forEach(function (k) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      });
      return parts.join('&');
    }

    function rawCall(path, params) {
      var url = base + path + '?' + qs(params);
      return Promise.resolve(fetcher(url, { headers: headers() })).then(function (res) {
        if (!res || (res.ok === false)) throw new Error('HTTP ' + (res && res.status));
        return res.json();
      }).then(function (data) {
        return data && Object.prototype.hasOwnProperty.call(data, 'js') ? data.js : data;
      });
    }

    function call(params) {
      if (loaderPath) {
        return rawCall(loaderPath, params).catch(function (e) { loaderPath = null; return tryAll(params); });
      }
      return tryAll(params);
    }

    function tryAll(params) {
      var i = 0, lastErr = null;
      function next() {
        if (i >= LOADER_PATHS.length) return Promise.reject(lastErr || new Error('no loader path worked'));
        var path = LOADER_PATHS[i++];
        return rawCall(path, params).then(function (r) { loaderPath = path; return r; },
          function (e) { lastErr = e; return next(); });
      }
      return next();
    }

    function handshake() {
      return call({ type: 'stb', action: 'handshake', token: token || '' }).then(function (js) {
        token = (js && js.token) || token;
        return js;
      });
    }

    function ensureToken() {
      return token ? Promise.resolve() : handshake().then(function () {});
    }

    function getProfile() {
      return ensureToken().then(function () {
        return call({ type: 'stb', action: 'get_profile', hd: '1', not_valid_token: '0' });
      });
    }

    function validate() {
      return ensureToken().then(getProfile).then(function () { return true; }, function () { return false; });
    }

    function mapCategory(c) {
      return { id: String((c && (c.id != null ? c.id : c.category_id)) || ''), name: (c && (c.title || c.name)) || 'بدون اسم' };
    }

    function categories(sec) {
      return ensureToken().then(function () {
        if (sec === 'movies') return call({ type: 'vod', action: 'get_categories' }).then(function (js) { return (js || []).map(mapCategory); });
        if (sec === 'series') return call({ type: 'series', action: 'get_categories' }).then(function (js) { return (js || []).map(mapCategory); }, function () { return []; });
        return call({ type: 'itv', action: 'get_genres' }).then(function (js) {
          return (js || []).filter(function (g) { return String(g.id) !== '*'; }).map(mapCategory);
        });
      });
    }

    function mapMedia(sec, item) {
      var type = sec === 'movies' ? 'movie' : sec === 'series' ? 'series' : 'live';
      var entry = {
        id: parseInt(item.id, 10) || 0,
        name: item.name || 'بدون اسم',
        extension: type === 'live' ? 'ts' : (item.cmd && /\.mkv($|\?)/i.test(item.cmd) ? 'mkv' : 'mp4'),
        type: type,
        rating: item.rating_imdb || item.rating || '',
        description: item.description || item.plot || '',
        imageUrl: item.screenshot_uri || item.logo || item.cover || '',
        categoryId: String(item.category_id != null ? item.category_id : (item.genre_id != null ? item.genre_id : (item.tv_genre_id != null ? item.tv_genre_id : ''))),
        categoryName: '',
        catchup: false, addedAt: 0, adult: false, epgId: ''
      };
      var k = entry.type + ':' + entry.id;
      if (item.cmd) cmdCache[k] = item.cmd;
      return entry;
    }

    function orderedList(reqType, catParamName, catId, tvCap) {
      var cap = tvCap ? CAP_TV : CAP_DEFAULT;
      var items = [];
      var page = 1;
      var total = Infinity;

      function step() {
        if (items.length >= total || items.length >= cap || page > MAX_PAGES) return Promise.resolve(items.slice(0, cap));
        var params = { type: reqType, action: 'get_ordered_list', p: String(page) };
        if (catId) params[catParamName] = catId;
        return call(params).then(function (js) {
          var data = (js && js.data) || [];
          total = js && js.total_items != null ? parseInt(js.total_items, 10) : items.length + data.length;
          if (!data.length) return items.slice(0, cap);
          items = items.concat(data);
          page++;
          return step();
        });
      }
      return step();
    }

    function media(sec, catId) {
      return ensureToken().then(function () {
        var tvCap = isTvPlatform();
        var reqType, catParam;
        if (sec === 'movies') { reqType = 'vod'; catParam = 'category'; }
        else if (sec === 'series') { reqType = 'series'; catParam = 'category'; }
        else { reqType = 'itv'; catParam = 'genre'; }
        return orderedList(reqType, catParam, catId, tvCap).then(function (raw) {
          return raw.map(function (it) { return mapMedia(sec, it); });
        }, function (e) {
          if (sec === 'series') return []; // series endpoints are optional on some portals
          throw e;
        });
      });
    }

    function episodes(seriesId) {
      return ensureToken().then(function () {
        return call({ type: 'series', action: 'get_ordered_list', movie_id: String(seriesId) }).then(function (js) {
          var data = (js && js.data) || [];
          var out = data.map(function (it, i) {
            var entry = {
              id: parseInt(it.id, 10) || 0,
              name: (it.episode_num ? ('S' + (it.season_num || '') + ' E' + it.episode_num + ' — ') : '') + (it.name || it.title || ('حلقة ' + (i + 1))),
              extension: 'mp4', type: 'episode', rating: '', description: it.description || '',
              imageUrl: it.screenshot_uri || '', seriesId: seriesId
            };
            if (it.cmd) cmdCache[entry.type + ':' + entry.id] = it.cmd;
            return entry;
          });
          return { episodes: out, info: {} };
        });
      });
    }

    function details(isSeriesFlag, id) {
      return ensureToken().then(function () {
        var reqType = isSeriesFlag ? 'series' : 'vod';
        return call({ type: reqType, action: 'get_ordered_list', movie_id: String(id) }).then(function (js) {
          var item = (js && js.data && js.data[0]) || {};
          return {
            plot: item.description || '', cast: item.actors || '', director: item.director || '',
            genre: item.genres_str || '', duration: item.time || '',
            year: String(item.year || ''), rating: item.rating_imdb || '',
            image: item.screenshot_uri || '', backdrop: ''
          };
        });
      });
    }

    function createLink(cmd) {
      return ensureToken().then(function () {
        return call({ type: 'itv', action: 'create_link', cmd: cmd }).then(function (js) {
          var link = (js && js.cmd) || '';
          var sp = link.indexOf(' ');
          if (/^ffmpeg\s/i.test(link) && sp >= 0) link = link.slice(sp + 1);
          return link;
        });
      });
    }

    // Async unlike X.url() (Xtream can build the URL offline); create_link is a required
    // network round-trip in the Stalker protocol — the coordinator's player-start call site
    // needs an `await`/`.then()` branch for account type 'stalker'. See final report.
    function url(item) {
      var k = item && (item.type + ':' + item.id);
      var cmd = k && cmdCache[k];
      if (!cmd) return Promise.reject(new Error('no cmd cached for item ' + k));
      return createLink(cmd);
    }

    return {
      validate: validate,
      categories: categories,
      media: media,
      episodes: episodes,
      details: details,
      url: url,
      handshake: handshake,
      getProfile: getProfile,
      _debug: function () { return { token: token, loaderPath: loaderPath, cmdCacheSize: Object.keys(cmdCache).length }; }
    };
  }

  window.HK_stalker = { createClient: createClient, normMac: normMac, baseUrl: baseUrl };
})();
