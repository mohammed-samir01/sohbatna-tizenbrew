/* Sohbatna — merge the quality copies of one live channel into a single entry (5.4.0).
 * Pure functions, no DOM. Same algorithm is ported 1:1 to Android (ChannelMerge.java);
 * tools/merge-vectors.json holds expected output that both implementations are tested against.
 *
 *   "BEIN SPORT 1 MINI 512K", "BEIN SPORT 1 H265 FHD 4M", "beINSport1"  ->  "BEIN SPORT 1" with 3 variants
 *   "MBC Drama" and "MBC+Drama HD" stay separate ("+" is kept in the key).
 */
(function (root) {
  // quality words: stripped from the name to build the key, kept as the variant label
  const TAG = /^(mini|low|sd|nano|hq|fhd|uhd|hd|4k|8k|h\.?265|h\.?264|hevc|power|pure|full|\d+(?:\.\d+)?k|\d+(?:\.\d+)?(?:\/\d+)?m(?:bps)?|\d{3,4}p)$/i;
  const LEVEL = { mini: 0.5, low: 1, sd: 2, nano: 2, hd: 3, hq: 4, fhd: 5, full: 5, pure: 6, uhd: 8, '4k': 8, '8k': 12, power: 8 };

  function split(name) {
    // "MBC1 HD" / "Bein Movies HD1" — glued forms are split so the tag can be recognised
    const s = String(name || '').replace(/[\u064b-\u0652\u0640]/g, '')
      .replace(/\b(hd|sd|fhd|uhd)(\d{1,2})\b/gi, '$1 $2')
      .replace(/([\s\-_|:()\[\]]|^)(h)\.(26[45])/gi, '$1$2$3');
    return s.split(/([\s\-_|:()\[\]]+)/);
  }
  function parse(name) {
    const parts = split(name), keep = [], tags = [];
    for (const p of parts) {
      if (/^[\s\-_|:()\[\]]+$/.test(p) || p === '') { keep.push(p); continue; }
      if (TAG.test(p) && keep.join('').replace(/[\s\-_|:()\[\]]/g, '') !== '') tags.push(p); else keep.push(p);
    }
    const clean = keep.join('').replace(/[\s\-_|:()\[\]]+$/g, '').replace(/^[\s\-_|:()\[\]]+/g, '').replace(/\s{2,}/g, ' ');
    const key = clean.toLowerCase().replace(/[^0-9a-z\u0600-\u06ff+]/g, '');
    let mbps = 0, level = 0, h265 = false;
    for (const t of tags) {
      const l = t.toLowerCase().replace('.', '');
      const m = l.match(/^(\d+(?:\.\d+)?)(?:\/(\d+))?m/); if (m) mbps = Math.max(mbps, parseFloat(m[2] || m[1]));
      const k = l.match(/^(\d+)k$/); if (k && +k[1] >= 100) mbps = Math.max(mbps, +k[1] / 1000);
      if (LEVEL[l]) level = Math.max(level, LEVEL[l]);
      if (l === 'h265' || l === 'hevc') h265 = true;
    }
    const rate = mbps || level || 2.5;                     // unknown = just under HD
    const score = rate * (h265 ? 1.6 : 1);                 // H265 at the same bitrate looks better
    return { key, clean, tags, h265, label: tags.length ? tags.map(t => t.toUpperCase().replace('H.265', 'H265')).join(' ') : 'أساسي', rate, score };
  }

  /** raw: [{id, name, extension, categoryId, ...}] in server order -> Map key -> {name, variants[]} */
  function group(raw) {
    const g = new Map();
    for (const it of raw) {
      const p = parse(it.name); if (!p.key) continue;
      let k = p.key, e = g.get(k);
      // Same name + same quality label in ANOTHER category = a different channel (e.g. "Fox" Turkey vs "Fox" Portugal): keep apart.
      if (e && e.variants.some(v => v.label.replace(/ \(\d+\)$/, '') === p.label && v.categoryId !== it.categoryId)) { k = p.key + '#' + it.categoryId; e = g.get(k); }
      if (!e) { e = { key: k, name: p.clean, first: it, variants: [] }; g.set(k, e); }
      if (!/\s/.test(e.name) && /\s/.test(p.clean)) e.name = p.clean;   // prefer "BEIN SPORT 1" over "beINSport1"
      if (e.variants.some(v => v.id === it.id)) continue;
      e.variants.push({ id: it.id, extension: it.extension, label: p.label, rate: p.rate, score: p.score, h265: p.h265, name: it.name, categoryId: it.categoryId });
    }
    for (const e of g.values()) {
      e.variants.sort((a, b) => b.score - a.score || a.rate - b.rate);
      const seen = {}; e.variants.forEach(v => { seen[v.label] = (seen[v.label] || 0) + 1; if (seen[v.label] > 1) v.label += ' (' + seen[v.label] + ')'; });
    }
    return g;
  }

  /** Merge live categories whose names differ only by quality words ("BEIN SPORT MINI 512K" + "BEIN SPORT HQ 4M"). */
  function categories(list) {
    const out = [], byKey = {};
    for (const c of list) {
      const p = parse(c.name), k = p.key || c.id;
      if (byKey[k]) { byKey[k].id += ',' + c.id; byKey[k].parts++; continue; }
      byKey[k] = { id: String(c.id), name: p.tags.length ? p.clean : c.name, parts: 1 }; out.push(byKey[k]);
    }
    return out;
  }

  /** Index of the variant to play. pref = remembered label (manual) or null (auto). */
  function pick(variants, pref, maxRate) {
    if (pref) { const i = variants.findIndex(v => v.label === pref); if (i >= 0) return i; }
    // auto: best non-H265 copy within the bandwidth cap (widest decoder support), then any copy within the cap
    const cap = maxRate || 4;
    let i = variants.findIndex(v => v.rate <= cap && !v.h265);
    if (i < 0) i = variants.findIndex(v => v.rate <= cap);
    return i >= 0 ? i : variants.length - 1;
  }

  const api = { parse, group, categories, pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Merge = api;
})(typeof window !== 'undefined' ? window : globalThis);
