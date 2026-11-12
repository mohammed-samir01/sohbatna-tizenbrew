/* Sohbatna 6.0 — HK_m3u: user-supplied M3U/M3U8 streaming parser (web/LG/Windows).
 * Contract (docs/redesign-6.0/CONTRACT.md, Wave 4 — decision 0.26/0.28, PLAN 6ج F14, premium-5.14 decision 0.8):
 *   parse(text|ReadableStream, {limit}) -> Promise<{live, movies, series, groups, epgUrl}>
 *   load(urlOrFile, {limit, onProgress}) -> same shape
 *   isM3uUrl(str) -> boolean
 * HARD LEGAL RULE: this module never ships, embeds or fetches any channel/stream list of its own.
 * It only ever parses a URL or File the user picked themselves. No default URLs, no bundled playlists.
 *
 * Memory/perf: never materialises the whole playlist as one big string + one big array at the same time.
 * - String input: scanned by index (indexOf), no .split('\n') of the whole text.
 * - URL/File input: read as a byte stream, decoded incrementally (TextDecoder stream mode), line-by-line.
 * Every ~2000 lines we yield to the event loop (setTimeout 0) so a 100 MB file never freezes the UI/TV.
 */
(function (root) {
  'use strict';

  var DEFAULT_TV_LIMIT = 60000; // PLAN 5.14 decision 0.8 / CONTRACT F14: cap on TV devices
  var YIELD_EVERY_LINES = 2000;

  function isTvEnv() {
    try { return !!(root.document && root.document.documentElement.classList.contains('tv')); }
    catch (e) { return false; }
  }

  function nextTick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  // ---- small helpers -------------------------------------------------------------------------
  function stripQuotes(s) { return s; }

  // Splits an #EXTINF line's tail (after "#EXTINF:") into {duration, attrs, name}.
  // Attributes are key="value" pairs; the display name is everything after the first top-level
  // comma (a comma not inside a quoted attribute value).
  function parseExtinf(line) {
    var body = line.slice(8); // after '#EXTINF:'
    var inQuotes = false, commaIdx = -1;
    for (var i = 0; i < body.length; i++) {
      var ch = body.charAt(i);
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { commaIdx = i; break; }
    }
    var head = commaIdx === -1 ? body : body.slice(0, commaIdx);
    var name = commaIdx === -1 ? '' : body.slice(commaIdx + 1).trim();
    var attrs = {};
    var re = /([A-Za-z0-9_\-]+)\s*=\s*"([^"]*)"/g, m;
    while ((m = re.exec(head))) attrs[m[1].toLowerCase()] = m[2];
    return { attrs: attrs, name: name };
  }

  function parseHeaderAttrs(line) {
    var attrs = {};
    var re = /([A-Za-z0-9_\-]+)\s*=\s*"([^"]*)"/g, m;
    while ((m = re.exec(line))) attrs[m[1].toLowerCase()] = m[2];
    return attrs;
  }

  var SERIES_RE = /\bS\d{1,2}\s*E\d{1,3}\b|season\s*\d+|الموسم|مسلسل|حلقة\s*\d+/i;
  var MOVIE_EXT_RE = /\.(mp4|mkv|avi|mov)(\?[^#]*)?$/i;
  var MOVIE_GROUP_RE = /movie|vod|فيلم|أفلام/i;

  function classify(entry) {
    if (SERIES_RE.test(entry.name || '') || SERIES_RE.test(entry.group || '')) return 'series';
    if (MOVIE_EXT_RE.test(entry.url || '')) return 'movies';
    if (MOVIE_GROUP_RE.test(entry.group || '')) return 'movies';
    return 'live';
  }

  function slug(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, '-').replace(/^-+|-+$/g, '') || 'ch';
  }

  // ---- core line-by-line engine ---------------------------------------------------------------
  // `source` must expose readLine-driving via a push-based loop; we implement it as a generator
  // function that the two input adapters (string / stream) both feed.
  function makeCollector(opts) {
    opts = opts || {};
    var limit = typeof opts.limit === 'number' ? opts.limit : (isTvEnv() ? DEFAULT_TV_LIMIT : 0);
    var state = {
      live: [], movies: [], series: [], groupsSeen: [], groupsSet: {},
      epgUrl: '', pending: null, seenKeys: {}, counter: 0, total: 0, truncated: false,
      hasHeader: false   // 7.1: saw a real '#EXTM3U' line — lets callers tell "empty playlist" from "not an M3U at all"
    };

    function addGroup(g) {
      if (g && !state.groupsSet[g]) { state.groupsSet[g] = true; state.groupsSeen.push(g); }
    }

    function finalizePending(url) {
      var p = state.pending; state.pending = null;
      if (!p || !url) return;
      if (limit && state.total >= limit) { state.truncated = true; return; }
      var attrs = p.attrs;
      var group = attrs['group-title'] || '';
      var tvgId = attrs['tvg-id'] || '';
      var name = p.name || attrs['tvg-name'] || '';
      var catchup = {};
      Object.keys(attrs).forEach(function (k) {
        if (k.indexOf('catchup') === 0) catchup[k] = attrs[k];
      });
      var entry = {
        id: tvgId || (slug(name) + '-' + (state.counter++)),
        name: name,
        logo: attrs['tvg-logo'] || '',
        group: group,
        tvgId: tvgId,
        url: url.trim(),
        kind: '',
        catchupRaw: catchup
      };
      entry.kind = classify(entry);
      var dedupeKey = tvgId ? ('t:' + tvgId) : ('u:' + entry.url);
      if (state.seenKeys[dedupeKey]) return;
      state.seenKeys[dedupeKey] = true;
      addGroup(group);
      state.total++;
      if (entry.kind === 'movies') state.movies.push(entry);
      else if (entry.kind === 'series') state.series.push(entry);
      else state.live.push(entry);
    }

    function pushLine(raw) {
      var line = raw.replace(/\r$/, '');
      if (!line) return;
      if (line.charCodeAt(0) === 0xFEFF) line = line.slice(1); // BOM on first line
      if (line.indexOf('#EXTM3U') === 0) {
        var h = parseHeaderAttrs(line);
        state.epgUrl = h['url-tvg'] || h['x-tvg-url'] || state.epgUrl;
        state.hasHeader = true;
        return;
      }
      if (line.indexOf('#EXTINF:') === 0) {
        var parsed = parseExtinf(line);
        state.pending = { attrs: parsed.attrs, name: parsed.name };
        return;
      }
      if (line.charAt(0) === '#') return; // #EXTGRP, #EXTVLCOPT, #KODIPROP... ignored, not a URL
      if (state.pending) finalizePending(line);
    }

    function result() {
      return {
        live: state.live, movies: state.movies, series: state.series,
        groups: state.groupsSeen.slice(), epgUrl: state.epgUrl, truncated: state.truncated,
        hasHeader: state.hasHeader
      };
    }

    return { pushLine: pushLine, result: result, isFull: function () { return limit && state.total >= limit; } };
  }

  // ---- string input: index-scanned, chunked --------------------------------------------------
  function parseText(text, opts) {
    return new Promise(function (resolve, reject) {
      try {
        var collector = makeCollector(opts);
        var pos = 0, len = text.length, lineCount = 0;
        function step() {
          try {
            while (pos < len) {
              var nl = text.indexOf('\n', pos);
              var line = nl === -1 ? text.slice(pos) : text.slice(pos, nl);
              pos = nl === -1 ? len : nl + 1;
              collector.pushLine(line);
              lineCount++;
              if (collector.isFull()) break;
              if (lineCount % YIELD_EVERY_LINES === 0) { nextTick().then(step); return; }
            }
            resolve(collector.result());
          } catch (e) { reject(e); }
        }
        step();
      } catch (e) { reject(e); }
    });
  }

  // ---- stream input (fetch body / File.stream()): byte chunks -> text decoder -> lines --------
  function parseByteStream(getReader, opts, onBytes) {
    return new Promise(function (resolve, reject) {
      try {
        var collector = makeCollector(opts);
        var decoder = new TextDecoder('utf-8');
        var buf = '', lineCount = 0, loaded = 0;
        var reader = getReader();

        function drainLines(flush) {
          var idx;
          while ((idx = buf.indexOf('\n')) !== -1) {
            var line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            collector.pushLine(line);
            lineCount++;
            if (collector.isFull()) return true;
          }
          if (flush && buf) { collector.pushLine(buf); buf = ''; }
          return false;
        }

        function pump() {
          reader.read().then(function (res) {
            if (res.done) {
              buf += decoder.decode();
              drainLines(true);
              resolve(collector.result());
              return;
            }
            var chunk = res.value;
            loaded += chunk.byteLength || chunk.length || 0;
            if (onBytes) onBytes(loaded);
            buf += decoder.decode(chunk, { stream: true });
            var full = drainLines(false);
            if (full) { resolve(collector.result()); return; }
            if (lineCount > 0 && lineCount % YIELD_EVERY_LINES === 0) nextTick().then(pump);
            else pump();
          }, reject);
        }
        pump();
      } catch (e) { reject(e); }
    });
  }

  function isReadableStream(x) {
    return !!x && typeof x.getReader === 'function';
  }

  // ---- public: parse ---------------------------------------------------------------------------
  function parse(input, opts) {
    if (typeof input === 'string') return parseText(input, opts);
    if (isReadableStream(input)) return parseByteStream(function () { return input.getReader(); }, opts);
    return Promise.reject(new Error('HK_m3u.parse: unsupported input type'));
  }

  // ---- public: load (URL string or File/Blob) -------------------------------------------------
  function loadUrl(url, opts) {
    opts = opts || {};
    return fetch(url).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var total = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
      if (resp.body && isReadableStream(resp.body)) {
        return parseByteStream(function () { return resp.body.getReader(); }, opts, function (loaded) {
          if (opts.onProgress) opts.onProgress(loaded, total);
        });
      }
      return resp.text().then(function (text) {
        if (opts.onProgress) opts.onProgress(text.length, total || text.length);
        return parseText(text, opts);
      });
    });
  }

  function loadFile(file, opts) {
    opts = opts || {};
    var total = file.size || 0;
    if (typeof file.stream === 'function') {
      return parseByteStream(function () { return file.stream().getReader(); }, opts, function (loaded) {
        if (opts.onProgress) opts.onProgress(loaded, total);
      });
    }
    // Fallback: FileReader, sliced so we never hold more than one chunk + the growing result.
    return new Promise(function (resolve, reject) {
      var collector = makeCollector(opts);
      var decoder = new TextDecoder('utf-8');
      var CHUNK = 4 * 1024 * 1024;
      var offset = 0, buf = '', lineCount = 0;
      function readNext() {
        if (offset >= total) {
          buf += decoder.decode();
          var idx;
          while ((idx = buf.indexOf('\n')) !== -1) { collector.pushLine(buf.slice(0, idx)); buf = buf.slice(idx + 1); }
          if (buf) collector.pushLine(buf);
          resolve(collector.result());
          return;
        }
        var slice = file.slice(offset, offset + CHUNK);
        var fr = new FileReader();
        fr.onload = function () {
          offset += CHUNK;
          if (opts.onProgress) opts.onProgress(Math.min(offset, total), total);
          buf += decoder.decode(fr.result, { stream: true });
          var idx;
          while ((idx = buf.indexOf('\n')) !== -1) {
            collector.pushLine(buf.slice(0, idx));
            buf = buf.slice(idx + 1);
            lineCount++;
            if (collector.isFull()) { resolve(collector.result()); return; }
          }
          if (lineCount % YIELD_EVERY_LINES === 0) nextTick().then(readNext); else readNext();
        };
        fr.onerror = function () { reject(fr.error || new Error('FileReader error')); };
        fr.readAsArrayBuffer(slice);
      }
      readNext();
    });
  }

  function load(urlOrFile, opts) {
    try {
      if (typeof Blob !== 'undefined' && urlOrFile instanceof Blob) return loadFile(urlOrFile, opts);
      if (typeof File !== 'undefined' && urlOrFile instanceof File) return loadFile(urlOrFile, opts);
    } catch (e) { /* Blob/File not defined in this env */ }
    return loadUrl(urlOrFile, opts);
  }

  function isM3uUrl(str) {
    if (typeof str !== 'string') return false;
    return /\.m3u8?($|[?#])/i.test(str.trim());
  }

  root.HK_m3u = { parse: parse, load: load, isM3uUrl: isM3uUrl };
})(typeof window !== 'undefined' ? window : this);
