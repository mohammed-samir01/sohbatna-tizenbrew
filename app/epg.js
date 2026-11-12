// 5.13 programme guide parser — the subscriber's own provider (xmltv.php) or an XMLTV link the subscriber adds.
// Never a third-party guide feed. Same matching rules as Android EpgXml.java: the channel's epg_channel_id first,
// then its name. Plain ES2015 so old webOS Chromium runs it; no DOMParser (a 40 MB guide would blow the TV's memory).
(function (root) {
  'use strict';
  var unesc = function (s) {
    return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;|&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&').trim();
  };
  // "20260930183000 +0300" → unix seconds (no zone = UTC, as the XMLTV spec says)
  function time(s) {
    var m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*(?:([+-])(\d\d):?(\d\d))?/.exec(String(s || '').trim());
    if (!m) return 0;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
    if (m[7]) t -= (m[7] === '-' ? -1 : 1) * (+m[8] * 3600 + +m[9] * 60);
    return t;
  }
  // channel names from the provider list vs. display-name in the guide: "AR: MBC 1 HD" ≈ "MBC 1"
  function nameKey(s) {
    return String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/^[a-z]{2,3}\s*[:|\-]\s*/, '').replace(/[\(\[].*?[\)\]]/g, ' ')
      .replace(/\b(fhd|uhd|hd|sd|hevc|h\.?265|4k|8k|1080p?|720p?|hq|backup|vip)\b/g, ' ').replace(/[^a-z0-9\u0600-\u06ff]+/g, '');
  }
  var attr = function (a, k) { var m = new RegExp('\\b' + k + '\\s*=\\s*"([^"]*)"').exec(a) || new RegExp('\\b' + k + "\\s*=\\s*'([^']*)'").exec(a); return m ? unesc(m[1]) : ''; };
  var tag = function (body, t) { var m = new RegExp('<' + t + '\\b[^>]*>([\\s\\S]*?)</' + t + '>').exec(body); return m ? unesc(m[1]) : ''; };

  /** text → { prog: {xmltvId: [[start, end, title, desc]]}, names: {nameKey: xmltvId}, count } — only lo..hi is kept. */
  function parse(text, lo, hi) {
    var prog = {}, names = {}, count = 0, m;
    var reCh = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
    while ((m = reCh.exec(text))) {
      var id = attr(m[1], 'id'); if (!id) continue;
      var reDn = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g, d;
      while ((d = reDn.exec(m[2]))) { var k = nameKey(unesc(d[1])); if (k.length >= 2 && !names[k]) names[k] = id; }
    }
    var reP = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    while ((m = reP.exec(text))) {
      var s = time(attr(m[1], 'start')), e = time(attr(m[1], 'stop'));
      if (!s || !e || e <= s || e < lo || s > hi) continue;
      var ch = attr(m[1], 'channel'); if (!ch) continue;
      (prog[ch] = prog[ch] || []).push([s, e, tag(m[2], 'title'), tag(m[2], 'desc').slice(0, 400)]);
      count++;
    }
    for (var c in prog) prog[c].sort(function (a, b) { return a[0] - b[0]; });
    return { prog: prog, names: names, count: count };
  }

  /** Programmes for one provider channel {epgId, name} → [{start, end, title, desc}]. */
  function lookup(g, ch) {
    if (!g || !g.count) return [];
    var id = ch.epgId && g.prog[ch.epgId] ? ch.epgId : g.names[nameKey(ch.name)];
    return ((id && g.prog[id]) || []).map(function (p) { return { start: p[0], end: p[1], title: p[2], desc: p[3] }; });
  }

  var api = { parse: parse, lookup: lookup, time: time, nameKey: nameKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HKEPG = api;
})(typeof window !== 'undefined' ? window : this);
