/* Sohbatna — shared renderer (Windows/Electron + LG webOS) */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const H = window.sohbatna;
const TV = document.documentElement.classList.contains('tv');

// ---------- 6.0 web-features glue (web-features agent's files; every call guarded) ----------
function hkAttachImgs(root) {
  if (!window.HK_img || typeof HK_img.attach !== 'function') return;
  try { (root || document).querySelectorAll('img[src]').forEach(img => { if (img.dataset.hkAttached) return; img.dataset.hkAttached = '1'; HK_img.attach(img, img.getAttribute('src')); }); } catch (e) {}
}
function hkBg(el, url) {
  if (!el) return;
  if (url && window.HK_img && typeof HK_img.url === 'function') {
    HK_img.url(url).then(u => { el.style.backgroundImage = `url("${u}")`; }).catch(() => { el.style.backgroundImage = `url("${url}")`; });
  } else { el.style.backgroundImage = url ? `url("${url}")` : ''; }
}
const CHUNK = 150, FIRST = 48; let rendered = 0, paintGen = 0;

// ---------- state ----------
const LOC = I18N.locale, EN_UI = I18N.lang === 'en';
I18N.localizeDom(document.body);
const S = {
  profile: null, section: 'home', catalog: {}, catNames: {}, history: [], reminders: [], errors: [], prefs: {}, perf: {}, epgCache: {}, similar: [], categoryId: '', categories: [], items: [], shown: [],
  favorites: {}, progress: {}, parental: { pin: '', locked: {}, hideAdult: true }, unlocked: false,
  filter: { lang: 'all', sort: 'default', minRating: 0, year: '', favOnly: false, catchupOnly: false }, query: '',
  epList: [], epIndex: -1, channelQueue: [], channelIndex: -1, current: null,
  player: null, multi: { players: [null, null, null, null], channels: [null, null, null, null], active: 0, mode: 'four' }
};

const ARABIC_MARKERS = ['عربي','عربية','عرب','مصري','مصر','خليجي','خليج','سعودي','سوري','لبناني','مغربي','تونسي','جزائري','عراقي','أردني','اردني','كويتي','إماراتي','اماراتي','قطري','رمضان','مسرح',
 'arab','egypt','masr','gulf','khaleej','khaliji','saudi','ksa','syria','lebanon','maroc','morocco','tunis','algeri','iraq','jordan','kuwait','emirat','qatar','ramadan','shahid'];
const FOREIGN_MARKERS = ['أجنبي','اجنبي','هندي','تركي','كوري','صيني','ياباني','أمريكي','امريكي','انمي','أنمي','مترجم','مدبلج',
 'english','foreign','hollywood','bollywood','hindi','indian','turkish','korean','kdrama','chinese','japanese','anime','french','spanish','german','italian','russian','latin','world','international','netflix','hbo','disney','marvel','thai','usa','european','africa','dubbed'];
const KIDS_RE = /kids|kid\b|cartoon|toon|disney|junior|nick|baby|أطفال|اطفال|كرتون|كارتون|براعم|طيور|سبيستون|spacetoon|anime|انمي|أنمي/i;
const isArabicScript = s => /[\u0600-\u06FF]/.test(s || '');
function classify(name) { const l = (name || '').toLowerCase(); if (FOREIGN_MARKERS.some(m => l.includes(m))) return -1; if (ARABIC_MARKERS.some(m => l.includes(m))) return 1; return 0; }
function isArabic(item) { const c = classify(item.categoryName); return c !== 0 ? c === 1 : isArabicScript(item.name); }
const rating = v => { if (!v) return 0; const n = parseFloat(String(v).split('/')[0]); return isNaN(n) ? 0 : n; };
const key = it => `${it.type}:${it.id}`;

// ---------- Xtream client ----------
const APIC = {};   // 5.9.2 in-memory Xtream response cache (see X.cached)
const X = {
  base() { let s = S.profile.server.trim().replace(/\/+$/, ''); if (!/^https?:\/\//.test(s)) s = 'http://' + s; return s; },
  api(q) { return H.json(`${this.base()}/player_api.php?username=${encodeURIComponent(S.profile.username)}&password=${encodeURIComponent(S.profile.password)}${q}`).catch(e => { logError('API ' + (q.match(/action=(\w+)/) || [, 'auth'])[1], e); throw e; }); },
  async validate(p) {
    const prev = S.profile; S.profile = p;
    try {
      const r = await this.api('');
      const problem = window.HK_loginErrors ? HK_loginErrors.forXtreamUserInfo(r && r.user_info) : null;
      if (problem) { const e = new Error(problem.lineWithAction()); e._classified = true; throw e; }
      return true;
    } finally { if (!p.keep) S.profile = prev; }
  },
  // 5.9.2: whole-list responses cached 15 min in memory (switching sections re-downloaded 19k movies every time)
  cached(q) {
    const k = S.profile.id + q, c = APIC[k];
    if (c && (c.p || Date.now() - c.at < 15 * 60 * 1000)) return c.p || Promise.resolve(c.v);
    const p = this.api(q).then(v => { APIC[k] = { at: Date.now(), v }; return v; }, e => { delete APIC[k]; throw e; });
    APIC[k] = { p }; return p;
  },
  async categories(sec) { const a = { live: 'get_live_categories', movies: 'get_vod_categories', series: 'get_series_categories' }[sec]; const r = await this.cached('&action=' + a); let list = (r || []).map(c => ({ id: String(c.category_id), name: c.category_name || T('بدون اسم') })); S.catNames[sec] = Object.fromEntries(list.map(c => [c.id, c.name]));
    if (sec === 'live' && S.prefs.merge) { list = Merge.categories(list); S.liveCatMap = {}; list.forEach(c => { S.catNames.live[c.id] = c.name; c.id.split(',').forEach(id => S.liveCatMap[id] = c.id); }); } return S.parental.kids ? list.filter(c => KIDS_RE.test(c.name)) : list; },
  async media(sec, catId) {
    if (sec === 'live' && S.prefs.merge) return mergedLive(await this.rawMedia('live', ''), catId);
    return this.rawMedia(sec, catId);
  },
  async rawMedia(sec, catId) {
    const a = { live: 'get_live_streams', movies: 'get_vod_streams', series: 'get_series' }[sec];
    const all = APIC[S.profile.id + '&action=' + a];
    const r = !catId ? await this.cached('&action=' + a)
      : all && all.v && Date.now() - all.at < 15 * 60 * 1000 ? all.v.filter(it => String(it.category_id) === String(catId) || (Array.isArray(it.category_ids) && it.category_ids.some(c => String(c) === String(catId))))
      : await this.api('&action=' + a + '&category_id=' + encodeURIComponent(catId));
    if (S.parental.kids && !S.catNames[sec]) await this.categories(sec).catch(() => {});
    const kidsOk = it => !S.parental.kids || KIDS_RE.test((S.catNames[sec] || {})[String(it.category_id)] || '');
    return (r || []).filter(kidsOk).map(it => {
      const type = sec === 'movies' ? 'movie' : sec === 'series' ? 'series' : 'live';
      let rt = it.rating && it.rating !== '0' ? it.rating : (parseFloat(it.rating_5based) > 0 ? (parseFloat(it.rating_5based) * 2).toFixed(1) : '');
      return { id: parseInt(sec === 'series' ? it.series_id : it.stream_id), name: it.name || T('بدون اسم'), extension: it.container_extension || (type === 'movie' ? 'mp4' : 'ts'), type,
        rating: rt, description: it.plot || '', imageUrl: sec === 'series' ? it.cover : it.stream_icon, categoryId: String(it.category_id ?? ''), categoryName: '',
        catchup: String(it.tv_archive) === '1', addedAt: parseInt(it.added) || 0, adult: String(it.is_adult) === '1', epgId: it.epg_channel_id ? String(it.epg_channel_id) : '' };
    });
  },
  async episodes(seriesId) {
    const r = await this.api('&action=get_series_info&series_id=' + seriesId); const out = [];
    const eps = r?.episodes || {};
    const push = (arr, season) => (arr || []).forEach((e, i) => out.push({ id: parseInt(e.id), name: (season ? `S${season} E${e.episode_num || i + 1} — ` : '') + (e.title || T('حلقة')), extension: e.container_extension || 'mp4', type: 'episode', rating: e.info?.rating || '', description: e.info?.plot || '', imageUrl: e.info?.movie_image || '', seriesId }));
    if (Array.isArray(eps)) push(eps, ''); else Object.keys(eps).sort((a, b) => a - b).forEach(s => push(eps[s], s));
    return { episodes: out, info: r?.info || {} };
  },
  async details(isSeries, id) { const r = await this.api(isSeries ? '&action=get_series_info&series_id=' + id : '&action=get_vod_info&vod_id=' + id); const i = r?.info || {}; return { plot: i.plot || i.description || '', cast: i.cast || i.actors || '', director: i.director || '', genre: i.genre || '', duration: i.duration || i.episode_run_time || '', year: (i.releasedate || i.releaseDate || i.release_date || '').slice(0, 4), rating: i.rating || '', image: i.movie_image || i.cover || i.cover_big || '', backdrop: Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : '' }; },
  async epg(streamId) { const r = await this.api('&action=get_short_epg&stream_id=' + streamId + '&limit=10'); const b64 = s => { try { const d = atob(s); return /[\x00-\x08]/.test(d) ? s : decodeURIComponent(escape(d)); } catch { return s; } }; return (r?.epg_list || r?.epg_listings || []).map(e => ({ title: b64(e.title || ''), start: parseInt(e.start_timestamp) || 0, end: parseInt(e.stop_timestamp) || 0 })); },
  url(it) { const f = it.type === 'episode' ? 'series' : it.type === 'movie' ? 'movie' : 'live'; const v = it.variants ? it.variants[it.vi ?? pickVariant(it)] : it; return `${this.base()}/${f}/${encodeURIComponent(S.profile.username)}/${encodeURIComponent(S.profile.password)}/${v.id}.${v.extension}`; }
};
// ---------- 6.0 F19/F20/F22: account type adapters (M3U + Stalker/MAC) ----------
// Xtream (S.profile.type === 'xtream', the default for every pre-6.0 saved account) never touches
// this: X keeps its original methods below, restored by bindClient() whenever the active profile is Xtream.
const X_ORIG = { categories: X.categories, media: X.media, rawMedia: X.rawMedia, episodes: X.episodes, details: X.details, epg: X.epg, url: X.url, validate: X.validate, base: X.base };
// IndexedDB cache for M3U playlists (per profile id) — "M3U data cached per account, reloaded on start".
const HK_M3U_IDB = { name: 'hk_m3u', store: 'kv' };
function hkM3uIdb() { return new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error('no idb')); const r = indexedDB.open(HK_M3U_IDB.name, 1); r.onupgradeneeded = () => { try { r.result.createObjectStore(HK_M3U_IDB.store); } catch (e) {} }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function m3uCacheGet(id) { return hkM3uIdb().then(db => new Promise(res => { try { const rq = db.transaction(HK_M3U_IDB.store, 'readonly').objectStore(HK_M3U_IDB.store).get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); } catch (e) { res(null); } })).catch(() => null); }
function m3uCacheSet(id, data) { return hkM3uIdb().then(db => new Promise(res => { try { const tx = db.transaction(HK_M3U_IDB.store, 'readwrite'); tx.objectStore(HK_M3U_IDB.store).put(data, id); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); } })).catch(() => false); }
// Builds an X-shaped adapter over an already-parsed HK_m3u result. Live channels without a group get
// identified via HK_chandb.match(name, tvgId); blocked channels are dropped, nsfw ones hidden (+18 rule).
async function buildM3uClient(parsed) {
  if (window.HK_chandb && typeof HK_chandb.ensure === 'function') { try { await HK_chandb.ensure(); } catch (e) {} }
  function decorate(entry, type) {
    let categoryName = entry.group || '', categoryId = entry.group || '__none', nsfw = false, blocked = false;
    if (!categoryName && window.HK_chandb && typeof HK_chandb.match === 'function') {
      try { const m = HK_chandb.match(entry.name, entry.tvgId); if (m) { nsfw = !!m.nsfw; blocked = !!m.blocked; if (m.categories && m.categories[0]) { categoryName = m.categories[0]; categoryId = categoryName; } } } catch (e) {}
    }
    return { id: entry.id, name: entry.name || T('بدون اسم'), extension: type === 'live' ? 'ts' : (/\.mkv(\?|$)/i.test(entry.url || '') ? 'mkv' : 'mp4'), type,
      rating: '', description: '', imageUrl: entry.logo || '', categoryId, categoryName: categoryName || T('بدون اسم'), catchup: false, addedAt: 0, adult: nsfw, epgId: entry.tvgId || '', _m3uUrl: entry.url, _blocked: blocked };
  }
  const sec = { live: parsed.live.map(e => decorate(e, 'live')).filter(i => !i._blocked), movies: parsed.movies.map(e => decorate(e, 'movie')).filter(i => !i._blocked), series: parsed.series.map(e => decorate(e, 'movie')).filter(i => !i._blocked) };
  return {
    categories: async s => { const map = {}; (sec[s] || []).forEach(i => map[i.categoryId] = i.categoryName); return Object.keys(map).map(id => ({ id, name: map[id] })); },
    media: async (s, catId) => { const items = (sec[s] || []).filter(i => !i.adult); return catId ? items.filter(i => String(i.categoryId) === String(catId)) : items; },
    episodes: async () => ({ episodes: [], info: {} }), details: async () => ({}), epg: async () => [],
    url: it => it._m3uUrl, validate: async () => true, base: () => (S.profile && S.profile.url) || ''
  };
}
// LG webOS note (CONTRACT F22): browser fetch cannot set User-Agent/Cookie — Stalker portals routinely
// reject a handshake without them. We still try plain fetch there; Windows routes through Electron main
// (net.request, see main.js `stalker:fetch`) which CAN set them.
function buildStalkerFetcher() {
  if (window.H && typeof H.stalkerFetch === 'function') {
    return (url, init) => H.stalkerFetch(url, init).then(r => ({ ok: r.ok, status: r.status, json: () => { try { return JSON.parse(r.text); } catch (e) { return null; } } }));
  }
  return (url, init) => fetch(url, init).then(r => r.ok ? r.json().then(j => ({ ok: true, status: r.status, json: () => j })) : { ok: false, status: r.status, json: () => null });
}
let ACC_STALKER = null;
// Switches X's methods to the active account's adapter; Xtream profiles are restored to the originals
// (so an existing Xtream user sees byte-identical behaviour — this never runs for them in a new way).
async function bindClient() {
  const type = (S.profile && S.profile.type) || 'xtream';
  ACC_STALKER = null;
  if (type === 'xtream') { Object.assign(X, X_ORIG); return true; }
  if (type === 'm3u') {
    let cached = await m3uCacheGet(S.profile.id).catch(() => null);
    let parsed = cached && cached.data;
    if (!parsed) {
      if (!S.profile.url) throw new Error(T('أعد اختيار ملف M3U — لم يتم العثور على نسخة محفوظة'));
      parsed = await HK_m3u.load(S.profile.url, { limit: TV ? 60000 : 0 });
      m3uCacheSet(S.profile.id, { data: parsed, at: Date.now() }).catch(() => {});
    }
    const c = await buildM3uClient(parsed);
    Object.assign(X, { categories: c.categories, media: c.media, rawMedia: c.media, episodes: c.episodes, details: c.details, epg: c.epg, url: c.url, validate: c.validate, base: c.base });
    return true;
  }
  if (type === 'stalker') {
    if (!window.HK_stalker) throw new Error(T('وحدة MAC غير متاحة'));
    const client = HK_stalker.createClient(S.profile.portal, S.profile.mac, { fetch: buildStalkerFetcher() });
    ACC_STALKER = client;
    Object.assign(X, { categories: client.categories, media: client.media, rawMedia: client.media, episodes: client.episodes, details: client.details, epg: async () => [], url: it => client.url(it), validate: client.validate, base: () => S.profile.portal || '' });
    return true;
  }
  return true;
}

// ---------- persistence ----------
async function loadState() {
  S.favorites = (await H.store.get('favorites')) || {}; S.favOrder = (await H.store.get('favOrder')) || { at: 0, list: [] };
  S.progress = (await H.store.get('progress')) || {};
  S.parental = Object.assign({ pin: '', locked: {}, hideAdult: true, kids: false }, (await H.store.get('parental')) || {});
  S.parental.hideAdult = true;   // +18 is always hidden (Google Play content policy) — there is no setting to show it
  S.history = (await H.store.get('history')) || [];
  S.reminders = ((await H.store.get('reminders')) || []).filter(r => r.start + 3600 > Date.now() / 1000);
  S.errors = (await H.store.get('errors')) || [];
  S.prefs = Object.assign({ aspect: 'contain', start: 'home', lastUpdateCheck: 0, merge: true, quality: {}, subLang: 'ar', subSize: 100, uiScale: 1 }, (await H.store.get('prefs')) || {});
  if (window.HK_applyScale) HK_applyScale(+S.prefs.uiScale || 1);   // 5.13 interface size (Settings)
  if (window.HK_fx) HK_fx(S.prefs.fx);   // 5.14 effects level (Settings → الحركة والتأثيرات)
  S.perf = (await H.store.get('perf')) || {};
  S.teams = (await H.store.get('teams')) || {}; S.teamsStamp = (await H.store.get('teamsStamp')) || {}; S.epSeen = (await H.store.get('epSeen')) || {}; S.newEps = (await H.store.get('newEps')) || {};
  S.later = (await H.store.get('later')) || {}; S.laterStamp = (await H.store.get('laterStamp')) || {}; S.lastCh = (await H.store.get('lastCh')) || null;
  S.favStamp = (await H.store.get('favStamp')) || {}; S.progDone = (await H.store.get('progDone')) || {}; S.meta = (await H.store.get('meta')) || {};
  S.section = S.prefs.start || 'home';
}
const save = k => H.store.set(k, S[k]);

// ---------- screens ----------
function show(id) {
  const prev = document.querySelector('.screen:not(.hidden)'); if (prev && prev.id !== id && $('#modal').classList.contains('hidden')) Nav.remember(prev.id);
  $$('.screen').forEach(s => s.classList.add('hidden')); $('#' + id).classList.remove('hidden');
  // 6.0 QA: the fixed ambient glow / focus ring painted over the video (purple-teal band across the player)
  if (id === 'player' || id === 'multi') { const g = $('#ambient-glow'), r = $('#focus-ring'); if (g) g.classList.remove('on'); if (r) r.classList.remove('on'); }
  if (!prev || prev.id !== id) hkEnter($('#' + id));   // 5.14 page transition (CSS skips the player)
  if (!$('#modal').classList.contains('hidden')) closeModal(); else Nav.restore(id);
}
Nav.defaults({ login: '#l-server', home: '#hero .primary, .shelf-row .card, #content .card, .tab.active', details: '#d-play', player: '#p-play', multi: '#m-pick' });
// 5.14: restart an entrance animation (class removed, reflow, added back)
function hkEnter(el) { if (!el || window.HK_FX === 'off') return; el.classList.remove('hk-enter'); void el.offsetWidth; el.classList.add('hk-enter'); }
function modal(html) {
  $('#modal').classList.remove('p-sheet');
  if ($('#modal').classList.contains('hidden')) { const sc = document.querySelector('.screen:not(.hidden)'); if (sc) Nav.remember(sc.id); }
  $('#modal-card').classList.remove('s-compact', 's-dialog'); $('#modal-card').innerHTML = html; $('#modal').classList.remove('hidden');
  const first = $('#modal-card').querySelector('.opt.on, .opt, button, input:not([type=checkbox]), label input'); if (first) Nav.set(first);
  return $('#modal-card');
}
function closeModal() { if (S.updLock || (S.licLock && licBlocked())) return; $('#modal').classList.add('hidden'); const sc = document.querySelector('.screen:not(.hidden)'); if (sc) Nav.restore(sc.id); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
function toast(msg, ms = 2500) { const el = $('#p-status'); el.textContent = msg; el.classList.remove('hidden'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), ms); }

// ---------- login ----------
async function boot() {
  const t0 = Date.now();
  if (window.HK_fx3d && typeof HK_fx3d.splash === 'function') { try { HK_fx3d.splash($('#splash .logo')); } catch (e) {} }
  await loadState();
  if (window.HK_accent) { try { HK_accent.set(HK_accent.get()); } catch (e) {} }   // 6.0 F23: apply saved accent ASAP
  if (window.HK_family) { try { HK_family.senior(HK_family.senior()); } catch (e) {} }   // 6.0 F17: re-apply senior class
  S.profile = await H.profiles.active();
  if (S.profile) { try { await bindClient(); } catch (e) { logError('bindClient', e); } openHome(); } else show('login');
  setTimeout(() => $('#splash').classList.add('out'), Math.max(0, 600 - (Date.now() - t0)));
  setTimeout(() => $('#splash').remove(), Math.max(0, 600 - (Date.now() - t0)) + 500);
  reminderLoop(); setInterval(reminderLoop, 30000);
  setTimeout(syncNow, 2500); setInterval(syncNow, 5 * 60000);
  setTimeout(() => checkExpiry(), 6000); setInterval(() => checkExpiry(), 6 * 3600000);
  setTimeout(teamsTick, 9000); setInterval(teamsTick, 30 * 60000);
  setTimeout(checkNewEpisodes, 20000); setInterval(checkNewEpisodes, 6 * 3600000);
  // 5.12.3: every start + every 6 h (a forced update must not wait a day); the optional notice still shows once a day
  setTimeout(() => checkUpdate(false, true), 4000); setInterval(() => checkUpdate(false, true), 6 * 3600000);
  setTimeout(licCheck, 1500); setInterval(licCheck, 6 * 3600000);   // 5.11 licence (license.js)
  hkPrayerBoot();   // 6.0 F21 prayer/Ramadan runtime
}
// ---------- 6.0 F19: login tabs (Xtream / M3U / MAC) ----------
let loginType = 'xtream';
$$('#l-type .opt').forEach(b => b.onclick = () => {
  loginType = b.dataset.type; $$('#l-type .opt').forEach(x => x.classList.toggle('on', x === b));
  ['xtream', 'm3u', 'stalker'].forEach(t => $('#l-pane-' + t).classList.toggle('hidden', t !== loginType));
  $('#l-error').textContent = '';
});
$('#lm-file-btn') && ($('#lm-file-btn').onclick = () => $('#lm-file').click());
$('#lm-file') && ($('#lm-file').addEventListener('change', () => { $('#lm-file-name').textContent = ($('#lm-file').files[0] || {}).name || ''; }));
$('#l-btn').onclick = async () => {
  $('#l-error').textContent = ''; $('#l-btn').disabled = true;
  const userMsg = text => { const e = new Error(text); e._classified = true; return e; };
  try {
    if (loginType === 'xtream') {
      const p = { type: 'xtream', label: $('#l-label').value.trim(), server: $('#l-server').value.trim(), username: $('#l-user').value.trim(), password: $('#l-pass').value };
      if (!p.server || !p.username || !p.password) throw userMsg(T('أدخل رابط السيرفر واسم المستخدم وكلمة المرور'));
      const okCtx = Object.create(X); okCtx.base = X_ORIG.base;   // validate must always use the real Xtream base(), even mid-session with another account type bound
      await X_ORIG.validate.call(okCtx, p);   // throws a classified, bilingual message (wrong login / expired / max connections / network…) on failure
      await H.profiles.add(p); $('#l-pass').value = '';
    } else if (loginType === 'm3u') {
      const label = $('#lm-label').value.trim(), url = $('#lm-url').value.trim(), file = $('#lm-file').files[0], epgUrl = $('#lm-epg').value.trim();
      if (!url && !file) throw userMsg(T('أدخل رابط M3U أو اختر ملفاً من الجهاز'));
      const src = file || url;
      let parsed;
      try {
        parsed = await HK_m3u.load(src, { limit: TV ? 60000 : 0 });
      } catch (e) {
        // 7.1: HK_m3u.load rejects a bad HTTP response with a plain "HTTP <code>" Error — route it
        // through forHttpStatus so a 404/500 link gets its specific message, not the generic net one.
        const httpM = /^HTTP (\d+)$/.exec((e && e.message) || '');
        if (httpM && window.HK_loginErrors) throw userMsg(HK_loginErrors.forHttpStatus(parseInt(httpM[1], 10)).lineWithAction());
        throw e;
      }
      const total = (parsed.live || []).length + (parsed.movies || []).length + (parsed.series || []).length;
      // 7.1: a link with no total channels AND no real '#EXTM3U' header is not a playlist at all
      // (e.g. it returned a web/error page) — tell the user that, instead of "the playlist is empty".
      if (window.HK_loginErrors) { const looksLikeHtml = total === 0 && !parsed.hasHeader; const problem = HK_loginErrors.forPlaylist(total, looksLikeHtml); if (problem) throw userMsg(problem.lineWithAction()); }
      const id = await H.profiles.add({ type: 'm3u', label, url: url || '', epgUrl, m3uFileName: file ? file.name : '' });
      await m3uCacheSet(id, { data: parsed, at: Date.now() });
      if (!url) setTimeout(() => toast(T('قائمتك محفوظة على هذا الجهاز. لإعادة التحميل على جهاز آخر ستحتاج لاختيار الملف من جديد.'), 5000), 800);
    } else if (loginType === 'stalker') {
      const label = $('#ls-label').value.trim(), portal = $('#ls-portal').value.trim(), mac = $('#ls-mac').value.trim();
      if (!portal || !mac) throw userMsg(T('أدخل رابط البورتال وعنوان MAC'));
      if (!window.HK_stalker) throw userMsg(T('وحدة MAC غير متاحة'));
      const client = HK_stalker.createClient(portal, mac, { fetch: buildStalkerFetcher() });
      const ok = await client.validate().catch(() => false);
      if (!ok) {
        const fallback = window.HK_loginErrors ? HK_loginErrors.forException(new Error('connect')).lineWithAction() : T('تعذر الاتصال بالبورتال — تحقق من الرابط وعنوان MAC');
        throw userMsg(TV ? T('اشتراكات MAC غير مدعومة على شاشات LG حالياً') : fallback);
      }
      await H.profiles.add({ type: 'stalker', label, portal, mac });
    }
    S.profile = await H.profiles.active(); await bindClient(); openHome();
  } catch (e) {
    if (e && e._classified) { $('#l-error').textContent = e.message; }
    else {
      const net = window.HK_loginErrors ? HK_loginErrors.forException(e) : null;
      $('#l-error').textContent = net ? net.lineWithAction() : ((e && e.message) || T('حدث خطأ'));
    }
  }
  finally { $('#l-btn').disabled = false; }
};
$('#l-cancel').onclick = () => openHome();

// ---------- home ----------
// 5.9.2: header gets denser only when it would overflow (TV zoom, English labels, narrow windows)
function fitHeader() {
  const h = $('header'); if (!h || !h.offsetParent) return;
  h.classList.remove('hdr-1', 'hdr-2', 'hdr-3');
  const nav = h.querySelector('nav');
  // the nav can shrink (min-width:0), so its own overflow is what hides the last tabs under the buttons
  const over = () => h.scrollWidth > h.clientWidth + 1 || (nav && nav.scrollWidth > nav.clientWidth + 1);
  for (const c of ['hdr-1', 'hdr-2', 'hdr-3']) { if (!over()) break; h.classList.add(c); }
}
window.addEventListener('resize', () => { clearTimeout(fitHeader.t); fitHeader.t = setTimeout(fitHeader, 120); });
$$('nav .tab').forEach(b => { if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', b.textContent.trim()); });   // 7.0.6: no title tooltip — the rail shows the name itself
function openHome() { if (window.licApply && LIC) setTimeout(licApply, 0); show('home'); setTimeout(fitHeader, 0); $('#profile-name').textContent = S.profile.label; $('#kids-badge').classList.toggle('hidden', !S.parental.kids); $('#l-cancel').classList.add('hidden'); switchSection(S.section); }
$$('.tab').forEach(b => b.onclick = () => switchSection(b.dataset.sec));
// 6.0: account group lives in the rail's bottom; on narrow screens it opens as a sheet from account-tab.
$('#account-tab') && ($('#account-tab').onclick = e => { e.stopPropagation(); $('#rail-foot').classList.toggle('open'); });
document.addEventListener('click', e => {
  const rf = $('#rail-foot'); if (!rf || !rf.classList.contains('open')) return;
  if (!rf.contains(e.target) && e.target !== $('#account-tab') && !$('#account-tab').contains(e.target)) rf.classList.remove('open');
});
$$('#rail-foot .actions button').forEach(b => b.addEventListener('click', () => { const rf = $('#rail-foot'); if (rf) rf.classList.remove('open'); }));
$('#logout-btn').onclick = async () => { await H.profiles.remove(S.profile.id); S.profile = await H.profiles.active(); S.profile ? openHome() : show('login'); };
// 5.10: same matcher as Android Search.java — Arabic spelling variants, accents, any word order
const norm = s => (s || '').normalize('NFD').toLowerCase().replace(/[\u0300-\u036f\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const NORM = new Map();   // name → normalised, computed once (28k titles; the TV would redo it on every key press)
const normName = s => { let v = NORM.get(s); if (v === undefined) { v = norm(s); if (NORM.size > 60000) NORM.clear(); NORM.set(s, v); } return v; };
const qMatch = (name, q) => { if (!q) return true; const n = normName(name); return q.split(' ').every(w => n.includes(w)); };
let searchT = 0;   // search after typing pauses (TV: ~130 ms per pass over 28k titles)
$('#search').oninput = e => {
  clearTimeout(searchT); const v = e.target.value; hideSearchHistory();
  searchT = setTimeout(() => { S.query = norm(v); render(); showEpgSearchHits(v); if (v && v.trim()) hkSaveSearchHistory(v.trim()); }, 180);
};
$('#search').addEventListener('focus', () => { if (!$('#search').value) showSearchHistory(); });
$('#search').addEventListener('blur', () => setTimeout(hideSearchHistory, 150));
function hkSaveSearchHistory(q) {
  try { let h = JSON.parse(localStorage.getItem('hk.searchHistory') || '[]'); h = [q].concat(h.filter(x => x !== q)).slice(0, 5); localStorage.setItem('hk.searchHistory', JSON.stringify(h)); } catch (e) {}
}
function showSearchHistory() {
  let h = []; try { h = JSON.parse(localStorage.getItem('hk.searchHistory') || '[]'); } catch (e) {}
  const el = $('#search-history'); if (!el || !h.length) return;
  el.innerHTML = h.map(q => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { $('#search').value = b.dataset.q; S.query = norm(b.dataset.q); render(); hideSearchHistory(); });
  el.classList.remove('hidden');
}
function hideSearchHistory() { const el = $('#search-history'); if (el) el.classList.add('hidden'); }
function showEpgSearchHits(q) {
  const wrap = $('#content'); if (!wrap) return; const old = document.getElementById('epg-hits'); if (old) old.remove();
  if (!q || !window.HK_epg || typeof HK_epg.search !== 'function') return;
  try {
    const hits = HK_epg.search(q, S.epgCache || {}, S.catalog.live && S.catalog.live.items || []).slice(0, 10);
    if (!hits.length) return;
    const sec = document.createElement('section'); sec.id = 'epg-hits'; sec.className = 'shelf';
    sec.innerHTML = `<h3>${T('نتائج في دليل البرامج')} <small class="muted">${hits.length}</small></h3><div class="list">${hits.map(h => `<div class="ep"><span>${esc(h.channel)} — ${esc(h.title)}</span><span class="muted">${esc(h.start || '')}</span></div>`).join('')}</div>`;
    wrap.insertAdjacentElement('afterbegin', sec);
  } catch (e) {}
}
// Warm the name cache in 2k-title slices as soon as the box gets focus, so the first key press doesn't stall the TV.
$('#search').addEventListener('focus', () => {
  const all = ['movies', 'series', 'live'].flatMap(k => (S.catalog[k] && S.catalog[k].items) || []);
  let i = 0; const step = () => { const end = Math.min(i + 2000, all.length); for (; i < end; i++) normName(all[i].name); if (i < all.length) setTimeout(step, 0); };
  step();
});

async function switchSection(sec) {
  if (sec === 'matches' && !MATCHES_ON) sec = 'home';
  clearTimeout(searchT); S.section = sec; S.query = ''; $('#search').value = ''; S.filter = { lang: 'all', sort: 'default', minRating: 0, year: '', favOnly: false, catchupOnly: false };
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.sec === sec)); fitHeader(); hkEnter($('#content'));
  $('#content').scrollTop = 0;   // 7.0.7: a new section starts at its top (the home hero opened half under the toolbar after a scrolled list)
  if (sec !== 'home') $('#home').style.removeProperty('--tint');   // the poster colour belongs to the home hero only
  $('#categories').classList.toggle('hidden', sec === 'favorites' || sec === 'continue' || sec === 'home' || sec === 'matches');
  $('#guide').classList.toggle('hidden', sec !== 'guide'); $('#content').classList.toggle('hidden', sec === 'guide'); $('.toolbar').classList.toggle('hidden', sec === 'guide');
  if (sec === 'guide') return openGuide();
  if (sec === 'matches') { $('#filter-btn').classList.add('hidden'); $('#search').placeholder = T('⌕  ابحث عن فريق أو بطولة'); return openMatches(); }
  $('#search').placeholder = sec === 'home' ? T('⌕  ابحث في كل الأفلام والمسلسلات والقنوات') : T('⌕  ابحث في القسم الحالي');
  $('#filter-btn').classList.toggle('hidden', sec === 'home');
  if (sec === 'home') { $('#home').classList.add('home-dash'); await openHomeShelves(); if (window.HK_onboard && typeof HK_onboard.maybeShow === 'function') { try { HK_onboard.maybeShow(); } catch (e) {} } return; }
  $('#home').classList.remove('home-dash'); stopHeroRotate();
  if (sec === 'favorites') { S.items = favList().filter(kidsItem); render(); if (S.items.length > 1) $('#count').innerHTML += ` <button class="chip small" id="fav-sort" data-ic="sort">${T('ترتيب')}</button>`, paintIcons(), $('#fav-sort').onclick = favSortMode; return; }
  if (sec === 'continue') { S.items = Object.values(S.progress).filter(p => p.item).sort((a, b) => b.updatedAt - a.updatedAt).map(p => ({ ...p.item, percent: p.duration ? Math.min(99, Math.round(p.position * 100 / p.duration)) : 0, seriesId: p.seriesId })); return render(); }
  setLoading(true);
  try {
    const cats = await X.categories(sec);
    const kind = sec === 'live' ? T('القنوات') : sec === 'movies' ? T('الأفلام') : T('المسلسلات');
    S.categories = [{ id: '', name: T('جميع ') + kind }];
    if (sec !== 'live') S.categories.push({ id: '__ar', name: kind + T(' العربية') }, { id: '__fr', name: kind + T(' الأجنبية') });
    S.categories.push(...cats);
    renderCategories(); loadMedia('');
  } catch (e) { setLoading(false); toast(T('تعذر تحميل التصنيفات: ') + e.message); }
}
function renderCategories() {
  const locked = S.parental.locked[S.section] || [];
  let cats = S.categories.filter(c => !(S.parental.pin && !S.unlocked && locked.includes(c.id)));
  if (window.HK_layout && typeof HK_layout.apply === 'function' && ['live', 'movies', 'series'].includes(S.section)) {
    try { cats = HK_layout.apply(S.section, cats, c => c.id); } catch (e) {}
    try { (HK_layout.groups ? HK_layout.groups() : []).forEach(g => { if (g.keys && g.keys.length) cats = cats.concat([{ id: '__grp:' + g.id, name: g.name }]); }); } catch (e) {}
  }
  $('#categories').innerHTML = cats.map(c => `<button class="cat ${c.id === S.categoryId ? 'active' : ''} ${locked.includes(c.id) ? 'locked' : ''}" data-id="${c.id}">${c.name}</button>`).join('');
  $$('.cat').forEach(b => b.onclick = () => S.section === 'guide' ? guideCategory(b.dataset.id) : loadMedia(b.dataset.id));
  const act = $('#categories .cat.active'); if (act) { const box = $('#categories'); const top = act.offsetTop - box.clientHeight / 2 + act.offsetHeight / 2; if (act.offsetTop < box.scrollTop || act.offsetTop + act.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top); }
}
async function loadMedia(catId) {
  const locked = S.parental.locked[S.section] || [];
  const isLocked = id => String(id).split(',').some(x => locked.includes(x)) || locked.includes(id);
  if (S.parental.pin && !S.unlocked && isLocked(catId)) return requirePin(() => { renderCategories(); loadMedia(catId); });
  S.categoryId = catId; renderCategories(); setLoading(true);
  const virtual = catId.startsWith('__');
  if (catId.startsWith('__grp:')) {
    try { S.items = await groupItems(catId.slice(6)); } catch (e) { S.items = []; }
    render(); setLoading(false); return;
  }
  try {
    let items = await X.media(S.section, virtual ? '' : catId);
    const names = Object.fromEntries(S.categories.map(c => [c.id, c.name]));
    items.forEach(i => i.categoryName = names[i.categoryId] || (S.catNames[S.section] || {})[i.categoryId] || '');
    if (S.parental.hideAdult) items = items.filter(i => !i.adult);
    if (S.parental.pin && !S.unlocked) items = items.filter(i => !isLocked(i.categoryId));
    if (virtual) items = items.filter(i => isArabic(i) === (catId === '__ar'));
    S.items = items; render();
  } catch (e) { toast(T('تعذر تحميل المحتوى: ') + e.message); } finally { setLoading(false); }
}
function setLoading(on) { $('#loading').classList.toggle('hidden', !on); }

function render(opts) {
  if (S.section === 'home') return renderHome();
  if (S.section === 'matches') return renderMatches();
  const f = S.filter; let list = [...S.items];
  if (S.query) list = list.filter(i => qMatch(i.name, S.query));
  if (f.lang === 'arabic') list = list.filter(isArabic); if (f.lang === 'foreign') list = list.filter(i => !isArabic(i));
  if (f.minRating) list = list.filter(i => rating(i.rating) >= f.minRating);
  if (f.year) list = list.filter(i => i.name.includes(f.year));
  if (f.favOnly) list = list.filter(i => S.favorites[key(i)]);
  if (f.catchupOnly) list = list.filter(i => i.catchup);
  if (f.sort === 'name_asc') list.sort((a, b) => a.name.localeCompare(b.name)); if (f.sort === 'name_desc') list.sort((a, b) => b.name.localeCompare(a.name));
  if (f.sort === 'rating') list.sort((a, b) => rating(b.rating) - rating(a.rating)); if (f.sort === 'newest') list.sort((a, b) => b.addedAt - a.addedAt || b.id - a.id);
  S.shown = list;
  const active = f.lang !== 'all' || f.sort !== 'default' || f.minRating || f.year || f.favOnly || f.catchupOnly;
  $('#filter-btn').classList.toggle('on', !!active);
  $('#count').textContent = S.items.length ? (list.length === S.items.length ? S.items.length : `${list.length} / ${S.items.length}`) : '';
  const poster = S.section === 'movies' || S.section === 'series' || (list[0] && list[0].type !== 'live' && list[0].type !== 'episode');
  const c = $('#content'); c.className = poster ? 'grid' : 'rows';
  $('#empty').classList.toggle('hidden', list.length > 0); $('#empty').textContent = S.items.length ? T('لا توجد نتائج مطابقة للفلتر') : (S.section === 'continue' ? T('لم تبدأ مشاهدة أي فيلم أو حلقة بعد') : T('لا يوجد محتوى'));
  // 5.9.6: first paint = one screenful (48 cards); the rest of the first chunk follows on the next frame.
  // The TV spent ~460 ms laying out 150 cards before anything appeared.
  const n = opts && opts.keep ? Math.max(rendered, CHUNK) : FIRST; const st = c.scrollTop;
  c.innerHTML = list.slice(0, n).map(cardHtml).join(''); rendered = Math.min(n, list.length); c.scrollTop = opts && opts.keep ? st : 0; hkAttachImgs(c);
  if (rendered < Math.min(CHUNK, list.length)) { const gen = ++paintGen; setTimeout(() => { if (gen === paintGen && S.shown === list) renderMore(CHUNK - rendered); }, 60); }
}
function cardHtml(i, idx) {
    const kind = i.type === 'series' ? T('مسلسل') : i.type === 'episode' ? T('حلقة') : i.type === 'movie' ? T('فيلم') : (chanNo(i) ? chanNo(i) + T('  ·  بث مباشر') : T('بث مباشر'));
    const r = rating(i.rating) ? ` ★ ${i.rating}` : ''; const p = i.percent != null ? ` ⏵ ${i.percent}${T('٪')}` : '';
    const isP = i.type === 'movie' || i.type === 'series' || i.type === 'episode';   // an episode used to get the small channel layout inside the posters row
    return `<div class="card ${isP ? '' : 'row'}" data-i="${idx}"><img src="${esc(i.imageUrl || 'icon.png')}" loading="lazy">${isP ? '<div class="sheen-fx"></div>' : ''}<div class="txt"><div class="t">${esc(i.name)}</div><div class="m">${kind}${r}${p}${i.badge ? ' · <b class="accent">' + esc(i.badge) + '</b>' : ''}</div></div><button class="fav ${S.favorites[key(i)] ? 'on' : ''}" data-i="${idx}" data-nonav>★</button>${i.percent != null ? `<div class="prog" style="width:${i.percent}%"></div>` : ''}</div>`;
}
function renderMore(count = CHUNK) {
  if (S.section === 'home' || rendered >= S.shown.length) return false;
  $('#content').insertAdjacentHTML('beforeend', S.shown.slice(rendered, rendered + count).map((i, k) => cardHtml(i, rendered + k)).join('')); hkAttachImgs($('#content'));
  rendered = Math.min(rendered + count, S.shown.length); return true;
}
$('#content').addEventListener('click', e => { const hm = e.target.closest('[data-hm]'); if (hm) return openNowMatch(hm.dataset.hm); const h = e.target.closest('[data-hero]'); if (h) return heroAction(h.dataset.hero); const f = e.target.closest('.fav'); if (f) return toggleFav(S.shown[+f.dataset.i]); const card = e.target.closest('.card'); if (card) openItem(S.shown[+card.dataset.i], card); });
// 6.0: card focus depth (fx-full only, CSS gates it): tilt follows the mouse, one-shot sheen, row dims.
(function cardTilt() {
  let active = null;
  function clear(c) { if (!c) return; c.style.removeProperty('--tilt-x'); c.style.removeProperty('--tilt-y'); c.classList.remove('sheen-go'); const row = c.closest('.shelf-row, #content'); if (row) row.classList.remove('dim'); }
  document.addEventListener('mousemove', e => {
    if (!document.documentElement.classList.contains('fx-full')) { if (active) { clear(active); active = null; } return; }
    const c = e.target.closest && e.target.closest('.card:not(.row)');
    if (c !== active) { clear(active); active = c; if (c) { c.classList.add('sheen-go'); const row = c.closest('.shelf-row, #content'); if (row) row.classList.add('dim'); } }
    if (c) { const r = c.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; c.style.setProperty('--tilt-y', (x * 14).toFixed(1) + 'deg'); c.style.setProperty('--tilt-x', (-y * 10).toFixed(1) + 'deg'); }
  });
  document.addEventListener('mouseleave', () => { if (active) { clear(active); active = null; } }, true);
})();
$('#content').addEventListener('error', e => { const img = e.target; if (img.tagName === 'IMG' && !img.dataset.fb) { img.dataset.fb = '1'; img.src = 'icon.png'; } else if (img.tagName === 'IMG') posterLoaded(img); }, true);
// 5.14: posters fade in once downloaded (CSS hides them until .ld). Every card image ends in load or error → always shown.
function posterLoaded(img) { img.classList.add('ld'); const c = img.closest('.card'); if (c) c.classList.add('ld'); }
document.addEventListener('error', e => { const img = e.target; if (img.tagName === 'IMG' && img.closest && img.closest('.card') && (img.dataset.fb || !img.closest('#content'))) posterLoaded(img); }, true);
document.addEventListener('load', e => { if (e.target.tagName === 'IMG' && e.target.parentNode && e.target.parentNode.classList && e.target.parentNode.classList.contains('card')) posterLoaded(e.target); }, true);
$('#content').addEventListener('scroll', () => { const c = $('#content'); if (c.scrollTop + c.clientHeight > c.scrollHeight - 800) renderMore(); });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 5.9.8: the provider sends some names HTML-escaped ("O&apos;Shea Jackson"); decode before textContent.
const unent = s => s && s.indexOf('&') >= 0 ? s.replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : s;
function toggleFav(it) { const k = key(it); if (S.favorites[k]) { delete S.favorites[k]; S.favStamp[k] = { at: Date.now(), del: true }; } else { S.favorites[k] = it; S.favStamp[k] = { at: Date.now() }; } save('favorites'); save('favStamp'); syncSoon(); if (S.section === 'favorites') S.items = Object.values(S.favorites); if (S.section === 'home') { const c = $('#content'), st = c.scrollTop; renderHome(); c.scrollTop = st; return; } render({ keep: true }); }

function openItem(it, fromEl) {
  if (it.type === 'movie' || it.type === 'series') {
    if (fromEl && window.HK_fx3d && typeof HK_fx3d.flip === 'function' && (document.documentElement.classList.contains('fx-full') || document.documentElement.classList.contains('fx-tv'))) {
      try { const r = fromEl.getBoundingClientRect(); HK_fx3d.flip(fromEl, r, () => openDetails(it)); return; } catch (e) {}
    }
    return openDetails(it);
  }
  if (it.type === 'episode') return play(it, { seriesId: it.seriesId });
  S.channelQueue = S.section === 'home' ? S.shown.filter(i => i.type === 'live' && i._shelf === it._shelf) : S.shown.filter(i => i.type === 'live'); S.channelIndex = S.channelQueue.findIndex(i => i.id === it.id);
  play(it, { live: true });
}

// ---------- home: hero + shelves + global search ----------
// Full catalogs are fetched once per session (≈4 s on the TV for ~27k titles) and kept in memory only.
async function catalog(sec) {
  const c = S.catalog[sec]; if (c && Date.now() - c.at < 30 * 60 * 1000) return c.items;
  if (c && c.pending) return c.pending;
  // 5.9.6: category list fetched alongside (first open of Series/Live on the TV waited ~2 s just for it)
  X.categories(sec).catch(() => {});
  const pending = X.media(sec, '').then(items => { if (S.parental.hideAdult) items = items.filter(i => !i.adult); S.catalog[sec] = { at: Date.now(), items }; return items; });
  S.catalog[sec] = { at: 0, items: [], pending }; try { return await pending; } catch (e) { delete S.catalog[sec]; throw e; }
}
const newest = list => [...list].sort((a, b) => b.addedAt - a.addedAt || b.id - a.id);
// Providers often list the same title in several categories — show it once per shelf.
const uniq = list => { const seen = new Set(); return list.filter(i => { const k = i.type + ':' + i.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
async function openHomeShelves() {
  $('#content').className = 'shelves'; $('#empty').classList.add('hidden'); $('#count').textContent = '';
  renderHome(); setLoading(true);
  if (!S._ramadanToast && window.HK_prayer && HK_prayer.ramadan(new Date()).on) { S._ramadanToast = true; const line = ramadanLine(); if (line) setTimeout(() => hint(line, 6000), 1200); }
  try { await Promise.all(['movies', 'series', 'live'].map(s => catalog(s).catch(() => []))); } finally { setLoading(false); }
  if (!window._homeDone) { window._homeDone = 1; perfMark('home', performance.now()); }
  const bootFocus = !S._bootFocus; S._bootFocus = 1;   // 6.0: first home of the session starts in the page, not on the rail (a focused rail opens over the hero)
  if (S.section === 'home') { renderHome(); if (!Nav.current() || bootFocus || !Nav.inside('#content') && !Nav.inside('header')) Nav.set($('#hero .primary') || $('#content .shelf-row .card') || $('.tab.active')); loadHero(); }
  loadFixtures().then(() => { if (S.section === 'home' && visible('home') && !S.query) { const c = $('#content'), st = c.scrollTop, cur = Nav.current(), ci = cur && cur.dataset && cur.dataset.i; renderHome(); c.scrollTop = st; if (S.hero) { const el = $('#hero'); if (el) el.innerHTML = heroHtml(S.hero); } if (ci != null) { const el = $(`#content .card[data-i="${ci}"]`); if (el) Nav.set(el, { scroll: false }); } } }).catch(() => {});
}
function homeShelves() {
  const mv = (S.catalog.movies || {}).items || [], sr = (S.catalog.series || {}).items || [], lv = (S.catalog.live || {}).items || [];
  const q = S.query;
  if (q) {
    const hit = l => uniq(l.filter(i => qMatch(i.name, q))).slice(0, 40);
    return [[T('أفلام'), hit(mv)], [T('مسلسلات'), hit(sr)], [T('قنوات'), hit(lv)]].filter(x => x[1].length);
  }
  const cont = Object.values(S.progress).filter(p => p.item && kidsItem(p.item)).sort((a, b) => b.updatedAt - a.updatedAt).map(p => ({ ...p.item, percent: p.duration ? Math.min(99, Math.round(p.position * 100 / p.duration)) : 0, seriesId: p.seriesId, _remainMs: p.duration ? Math.max(0, p.duration - p.position) : null }));
  const favs = favList().filter(kidsItem);
  const recentLive = uniq(S.history.map(h => h.item).filter(i => i.type === 'live').filter(kidsItem)).slice(0, 20);
  const nm = uniq(newest(mv)), ns = uniq(newest(sr));
  return [
    [T('متابعة المشاهدة'), cont.slice(0, 30)],
    [T('حلقات جديدة'), newEpItems()],
    [T('المشاهدة لاحقاً'), Object.values(S.later).filter(kidsItem).reverse().slice(0, 30)],
    [T('القنوات المفضلة'), favs.filter(f => f.type === 'live').slice(0, 30)],
    [T('شاهدت مؤخراً'), recentLive],
    [T('المفضلة'), favs.filter(f => f.type !== 'live').slice(0, 30)],
    [T('أحدث الأفلام'), nm.slice(0, 30)],
    [T('أحدث المسلسلات'), ns.slice(0, 30)],
    [T('أفلام عربية جديدة'), nm.filter(isArabicScriptItem).slice(0, 30)],
    [T('مسلسلات عربية جديدة'), ns.filter(isArabicScriptItem).slice(0, 30)],
  ].filter(x => x[1].length);
}
const isArabicScriptItem = i => isArabicScript(i.name);
function renderHome() {
  const c = $('#content'); c.className = 'shelves';
  const shelves = homeShelves(); S.shown = [];
  let html = S.query ? '' : `<div id="hero" class="hero">${S.hero ? heroHtml(S.hero) : ''}</div>` + nowMatchesShelf();
  const seeAllTarget = title => ({ [T('أحدث الأفلام')]: 'movies', [T('أفلام عربية جديدة')]: 'movies', [T('أحدث المسلسلات')]: 'series', [T('مسلسلات عربية جديدة')]: 'series', [T('القنوات المفضلة')]: 'live', [T('شاهدت مؤخراً')]: 'live', [T('المفضلة')]: 'favorites', [T('متابعة المشاهدة')]: 'continue' }[title]);
  shelves.forEach(([title, items], si) => {
    const start = S.shown.length; items.forEach(i => S.shown.push({ ...i, _shelf: si }));
    const live = items[0].type === 'live';
    const wide = false;   // 7.0.6: continue-watching uses the same portrait posters as every other shelf (16:9 cropped them)
    const target = seeAllTarget(title);
    const seeAll = target ? `<button class="chip icon see-all" type="button" data-seeall="${esc(target)}">${T('عرض الكل')} ›</button>` : '';
    const row = wide ? items.map((it, k) => cardWideHtml(it, start + k)).join('') : items.map((it, k) => cardHtml(it, start + k)).join('');
    html += `<section class="shelf"><h3>${esc(title)} <small class="muted">${items.length}</small>${seeAll}</h3><div class="shelf-row ${live ? 'chan-row' : ''}${wide ? ' wide-row' : ''}" id="shelf-${si}">${row}</div></section>`;
  });
  if (!shelves.length) html += `<div class="empty">${!(S.catalog.movies && !S.catalog.movies.pending) ? T('جاري تحميل المكتبة…') : S.query ? T('لا توجد نتائج') : T('لا يوجد محتوى')}</div>`;
  c.innerHTML = html; rendered = S.shown.length;
  if (!TV) addShelfNav(c.querySelectorAll('.shelf'));
}
$('#content').addEventListener('click', e => { const sa = e.target.closest('[data-seeall]'); if (sa) { S.section = sa.dataset.seeall; return switchSection(sa.dataset.seeall); } });
function cardWideHtml(i, idx) {
  const remain = i._remainMs != null ? Math.round(i._remainMs / 60000) : null;
  const m = remain != null ? `${remain}${T('د')} ${T('متبقية')}` : (i.categoryName || '');
  return `<div class="card wide" data-i="${idx}"><img src="${esc(i.imageUrl || 'icon.png')}" loading="lazy"><div class="wide-txt"><div class="t">${esc(i.name)}</div><div class="m">${esc(m)}</div></div>${i.percent != null ? `<div class="prog" style="width:${i.percent}%"></div>` : ''}</div>`;
}
// 5.9.7: ‹ › buttons on each shelf (mouse); hidden at the ends. RTL: scrollLeft runs 0 → negative.
function addShelfNav(shelves) {
  shelves.forEach(sh => {
    const row = sh.querySelector('.shelf-row'); if (!row) return;
    const mk = (cls, txt, dir) => { const b = document.createElement('button'); b.className = 'shelf-nav ' + cls; b.textContent = txt; b.dataset.nonav = '';
      b.onclick = e => { e.stopPropagation(); const rtl = getComputedStyle(row).direction === 'rtl'; row.scrollBy({ left: (rtl ? -1 : 1) * dir * row.clientWidth * 0.85, behavior: 'smooth' }); }; sh.appendChild(b); return b; };
    const rtlDoc = document.documentElement.dir !== 'ltr';
    const prev = mk('prev', rtlDoc ? '›' : '‹', -1), next = mk('next', rtlDoc ? '‹' : '›', 1);
    const upd = () => { const max = row.scrollWidth - row.clientWidth, pos = Math.abs(row.scrollLeft); prev.hidden = pos < 4; next.hidden = pos > max - 4; };
    row.addEventListener('scroll', upd, { passive: true }); upd();
  });
}
// Hero: up to 3 real candidates — the newest continue-watching item (if it has art) + up to 2 newest movies.
// Rotates every 6s with progress dots; paused when hidden, in the player, or fx level isn't "full".
var HERO = { list: [], idx: 0, timer: null };
function stopHeroRotate() { if (HERO.timer) { clearInterval(HERO.timer); HERO.timer = null; } }
function heroShouldRotate() { return document.visibilityState !== 'hidden' && !visible('player') && window.HK_FX === 'full' && HERO.list.length > 1; }
function startHeroRotate() {
  stopHeroRotate();
  if (!heroShouldRotate()) return;
  HERO.timer = setInterval(() => { if (!heroShouldRotate()) return stopHeroRotate(); heroShow((HERO.idx + 1) % HERO.list.length); }, 6000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopHeroRotate(); else if (S.section === 'home') startHeroRotate(); });
async function loadHero() {
  const cont = Object.values(S.progress).filter(p => p.item && kidsItem(p.item) && (p.item.imageUrl)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const mv = newest(((S.catalog.movies || {}).items) || []).filter(i => i.imageUrl).slice(0, 8);
  const cands = [];
  if (cont) cands.push(cont.item);
  for (const it of mv) { if (cands.length >= 3) break; if (!cands.some(c => c.type === it.type && c.id === it.id)) cands.push(it); }
  if (!cands.length) return;
  const withDetails = await Promise.all(cands.slice(0, 3).map(async it => { try { return { it, d: await X.details(false, it.id) }; } catch { return { it, d: {} }; } }));
  HERO.list = withDetails; HERO.idx = 0;
  S.hero = HERO.list[0];
  const el = $('#hero'); if (el && S.section === 'home' && !S.query) { el.innerHTML = heroHtml(S.hero); el.classList.add('hk-in'); hkAttachImgs(el); }
  heroTint(S.hero.d.backdrop || S.hero.d.image || S.hero.it.imageUrl);
  startHeroRotate();
}
function heroShow(i) {
  if (!HERO.list[i]) return; HERO.idx = i; S.hero = HERO.list[i];
  const el = $('#hero'); if (!el || S.section !== 'home' || S.query) return;
  el.innerHTML = heroHtml(S.hero); el.classList.remove('hk-in'); void el.offsetWidth; el.classList.add('hk-in'); hkAttachImgs(el);
  heroTint(S.hero.d.backdrop || S.hero.d.image || S.hero.it.imageUrl);
}
// 5.14: the home glow + focus ring take the hero poster's colour (8×8 sample, saturated). Best effort: a server without
// CORS taints the canvas → getImageData throws → the brand teal stays.
function heroTint(url) {
  if (!url || window.HK_FX === 'off') return;
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => { try {
    const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data; let best = null, bs = -1;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], b = d[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0, sc = sat * (mx / 255);
      if (mx > 60 && sc > bs) { bs = sc; best = [r, gg, b]; } }
    if (!best || bs < .18) return;
    const mx = Math.max(...best), k = 225 / mx; const rgb = best.map(v => Math.min(255, Math.round(v * k)));   // same hue, bright enough for a ring
    if (S.section === 'home') $('#home').style.setProperty('--tint', rgb.join(','));
  } catch (e) {} };
  img.src = url;
}
function heroHtml({ it, d }) {
  const bg = d.backdrop || d.image || it.imageUrl;
  const chips = [d.year, d.genre].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('<span>·</span>');
  const durTag = prettyDur(d.duration) ? `<span class="tag">${esc(prettyDur(d.duration))}</span>` : '';
  const favOn = S.favorites[key(it)] ? ' on' : '';
  const dots = HERO.list.length > 1 ? `<div class="hero-dots">${HERO.list.map((_, i) => `<button type="button" class="${i === HERO.idx ? 'on' : ''}" data-herodot="${i}" data-nonav aria-label="${i + 1}"></button>`).join('')}</div>` : '';
  // 6.0 QA: most providers have no wide backdrop — stretching the 2:3 poster over the whole hero looked blurry and
  // cropped («CARTER» letters). Without a backdrop: dim tinted poster behind + the crisp poster card beside the text.
  const art = !d.backdrop && bg ? `<img class="hero-art" src="${esc(bg)}" alt="" onerror="this.remove()">` : '';
  if (art) setTimeout(() => { const h = $('#hero'); if (h) h.classList.add('hero-poster'); }, 0); else setTimeout(() => { const h = $('#hero'); if (h) h.classList.remove('hero-poster'); }, 0);
  return `<div class="hero-bg" style="background-image:url('${esc(bg)}')"></div>${art}<div class="hero-txt"><small class="accent">${T('جديد')}</small><h2${(it.name || '').length > 26 ? ' class="long"' : ''}>${esc(it.name)}</h2><div class="meta-chips">${chips}${durTag}</div><p>${esc((d.plot || '').slice(0, 220))}${(d.plot || '').length > 220 ? '…' : ''}</p>
    <div class="row"><button class="primary" data-hero="play">${T('▶ تشغيل')}</button><button class="chip" data-hero="info">${T('ⓘ التفاصيل')}</button><button class="chip icon hero-fav${favOn}" data-hero="fav" title="${T('المفضلة')}">★</button></div></div>${dots}`;
}
// Xtream durations come as '93', '01:33:58' or '01:33:58,976' — show '1س 33د'.
function prettyDur(v) { if (!v || v === '0') return ''; v = String(v).split(/[,.]/)[0]; let m; if (/^\d+$/.test(v)) m = +v; else { const p = v.split(':').map(Number); if (p.some(isNaN)) return v; m = p.length === 3 ? p[0] * 60 + p[1] : p[0]; } return m >= 60 ? Math.floor(m / 60) + (EN_UI ? 'h ' : 'س ') + (m % 60 ? (m % 60) + (EN_UI ? 'm' : 'د') : '') : m + T(' دقيقة'); }
function heroAction(a) {
  if (!S.hero) return;
  const dotBtn = a && a.dataset; // not used, kept for clarity
  if (a === 'play') return play(S.hero.it, {}); if (a === 'fav') { toggleFav(S.hero.it); const b = $('.hero-fav'); if (b) b.classList.toggle('on', !!S.favorites[key(S.hero.it)]); return; } openDetails(S.hero.it);
}
function renderSimilar(it) {
  const cat = ((S.catalog[it.type === 'series' ? 'series' : 'movies'] || {}).items) || [];
  const pool = cat.length ? cat : S.items.filter(x => x.type === it.type);
  const same = pool.filter(x => x.categoryId === it.categoryId && x.id !== it.id);
  S.similar = uniq(newest(same)).filter(x => x.name !== it.name).slice(0, 20);
  $('#d-similar-wrap').classList.toggle('hidden', !S.similar.length);
  $('#d-similar').innerHTML = S.similar.map((x, k) => cardHtml(x, k).replace('class="card', 'class="card sim')).join(''); hkAttachImgs($('#d-similar'));
  const sw = $('#d-similar-wrap'); sw.querySelectorAll('.shelf-nav').forEach(b => b.remove()); if (!TV && S.similar.length) addShelfNav([sw]);
}
$('#d-similar').addEventListener('click', e => { const card = e.target.closest('.card'); if (!card || e.target.closest('.fav')) return; openDetails(S.similar[+card.dataset.i]); $('#details').scrollTop = 0; });

// ---------- filter ----------
$('#layout-btn').onclick = () => {
  if (!window.HK_layout || typeof HK_layout.open !== 'function') return toast(T('تخصيص الأقسام غير متاح'));
  const sec = ['live', 'movies', 'series'].includes(S.section) ? S.section : 'movies';
  const cats = (S.categories || []).filter(c => c.id && !c.id.startsWith('__')).map(c => [c.id, c.name]);
  try { HK_layout.open(document.activeElement, sec, cats, () => renderCategories()); } catch (e) {}
};
$('#filter-btn').onclick = () => {
  const f = S.filter; const live = S.section === 'live'; const hasRating = S.items.some(i => rating(i.rating) > 0);
  const seg = (name, opts, val) => `<div class="seg">${opts.map(([v, l]) => `<button class="opt ${val === v ? 'on' : ''}" data-k="${name}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const m = modal(`<h3>${T('⚲ الفلتر والترتيب')}</h3>
    <div class="section">${T('اللغة')}</div>${seg('lang', [['all', T('الكل')], ['arabic', T('عربي')], ['foreign', T('أجنبي')]], f.lang)}
    <div class="section">${T('الترتيب')}</div>${seg('sort', [['default', T('افتراضي')], ['newest', T('الأحدث')], ['name_asc', T('أ←ي')], ['name_desc', T('ي←أ')], ...(hasRating ? [['rating', T('التقييم')]] : [])], f.sort)}
    ${hasRating ? `<div class="section">${T('الحد الأدنى للتقييم')}</div>${seg('minRating', [[0, T('أي')], [6, '★6+'], [8, '★8+']], f.minRating)}` : ''}
    ${!live ? `<div class="section">${T('سنة الإصدار')}</div><input id="f-year" placeholder="${T('مثال: 2025')}" value="${f.year}">` : ''}
    <label><input type="checkbox" id="f-fav" ${f.favOnly ? 'checked' : ''}> ${T('المفضلة فقط')}</label>
    ${live ? `<label><input type="checkbox" id="f-catch" ${f.catchupOnly ? 'checked' : ''}> ${T('القنوات التي تدعم الإعادة فقط')}</label>` : ''}
    <div class="btns"><button class="primary" id="f-apply">${T('تطبيق')}</button><button class="chip" id="f-clear">${T('مسح الكل')}</button><button class="chip" id="f-cancel">${T('إلغاء')}</button></div>`);
  const tmp = { ...f };
  m.querySelectorAll('.opt').forEach(b => b.onclick = () => { tmp[b.dataset.k] = isNaN(b.dataset.v) ? b.dataset.v : +b.dataset.v; m.querySelectorAll(`[data-k="${b.dataset.k}"]`).forEach(x => x.classList.toggle('on', x === b)); });
  m.querySelector('#f-apply').onclick = () => { S.filter = { ...tmp, year: (m.querySelector('#f-year')?.value || '').trim(), favOnly: m.querySelector('#f-fav').checked, catchupOnly: !!m.querySelector('#f-catch')?.checked }; closeModal(); render(); };
  m.querySelector('#f-clear').onclick = () => { S.filter = { lang: 'all', sort: 'default', minRating: 0, year: '', favOnly: false, catchupOnly: false }; closeModal(); render(); };
  m.querySelector('#f-cancel').onclick = closeModal;
};

// ---------- profiles & parental ----------
$('#profile-btn').onclick = async () => {
  const list = await H.profiles.list();
  const m = modal(`<h3>${T('الحسابات')}</h3>${list.map(p => `<button class="opt ${p.id === S.profile.id ? 'on' : ''}" data-id="${p.id}">${p.id === S.profile.id ? '✓ ' : ''}${esc(p.label)}</button>`).join('')}
    <button class="opt" id="p-add">${ic('plus')} ${T('إضافة حساب جديد')}</button><button class="opt" id="p-epg">${ic('guide')} ${T('دليل البرامج (XMLTV)')} <small class="muted">${S.profile.epgUrl ? T('رابط مخصّص') : T('من مزوّدك')}</small></button><button class="opt" id="p-parental">${ic('lock')} ${T('الرقابة الأبوية (PIN)')}</button><button class="opt" id="p-history">${ic('history')} ${T('سجل المشاهدة')}</button>`);
  m.querySelector('#p-history').onclick = () => historyMenu();
  m.querySelectorAll('[data-id]').forEach(b => b.onclick = async () => { await H.profiles.setActive(b.dataset.id); S.profile = await H.profiles.active(); S.unlocked = false; closeModal(); try { await bindClient(); } catch (e) { logError('bindClient', e); } openHome(); });
  m.querySelector('#p-add').onclick = () => { closeModal(); show('login'); $('#l-cancel').classList.remove('hidden'); };
  m.querySelector('#p-parental').onclick = () => { closeModal(); requirePin(parentalMenu); };
  m.querySelector('#p-epg').onclick = epgLinkMenu;
};
// 5.13: the account's guide link — optional; empty = the provider's own xmltv.php. Only the subscriber adds it.
function epgLinkMenu() {
  const m = modal(`<h3>${T('دليل البرامج (XMLTV)')}</h3>
    <p class="muted">${T('يُعرض الدليل من مزوّدك تلقائياً. إذا أعطاك مزوّدك رابط دليل برامج منفصلاً (XMLTV) فأضفه هنا. اتركه فارغاً لاستخدام دليل المزوّد.')}</p>
    <input id="epg-url" class="ltr" placeholder="https://…/epg.xml" value="${esc(S.profile.epgUrl || '')}">
    <div class="btns"><button class="primary" id="epg-save">${T('حفظ')}</button><button class="chip" id="epg-c">${T('إلغاء')}</button></div>`);
  m.querySelector('#epg-c').onclick = closeModal;
  m.querySelector('#epg-save').onclick = async () => {
    const u = m.querySelector('#epg-url').value.trim();
    if (u && !/^https?:\/\//i.test(u)) return toast(T('الرابط يجب أن يبدأ بـ http:// أو https://'));
    if (!(await H.profiles.setEpg(S.profile.id, u))) return toast(T('تعذر حفظ الرابط'));
    S.profile = await H.profiles.active(); GUIDE.pid = ''; GUIDE.g = null; GUIDE.failAt = 0; S.epgCache = {};
    closeModal(); toast(u ? T('تم حفظ رابط الدليل') : T('سيُستخدم دليل مزوّدك'));
    if (S.section === 'guide') switchSection('guide');
  };
}
function requirePin(then) {
  if (!S.parental.pin || S.unlocked) return then();
  const m = modal(`<h3>${T('محتوى محمي')}</h3><input id="pin" type="password" placeholder="${T('أدخل رمز PIN')}" inputmode="numeric"><div class="btns"><button class="primary" id="pin-ok">${T('فتح')}</button><button class="chip" id="pin-c">${T('إلغاء')}</button></div>`);
  m.querySelector('#pin-ok').onclick = () => { if (m.querySelector('#pin').value === S.parental.pin) { S.unlocked = true; closeModal(); then(); } else toast(T('رمز PIN غير صحيح')); };
  m.querySelector('#pin-c').onclick = closeModal; m.querySelector('#pin').focus();
}
function parentalMenu() {
  const on = !!S.parental.pin;
  const m = modal(`<h3>${T('الرقابة الأبوية')}</h3><button class="opt" id="pa-set">${on ? T('تغيير رمز PIN') : T('تفعيل الرقابة الأبوية (تعيين PIN)')}</button>${on ? T('<button class="opt" id="pa-off">إلغاء الرقابة الأبوية</button>') : ''}
    <button class="opt ${S.parental.kids ? 'on' : ''}" id="pa-kids">${ic('kids')} ${S.parental.kids ? '✓ ' : ''}${T('وضع الأطفال')}</button>${on && !['favorites', 'continue'].includes(S.section) ? T('<button class="opt" id="pa-lock">قفل/فتح تصنيفات القسم الحالي…</button>') : ''}`);
  m.querySelector('#pa-set').onclick = () => { const mm = modal(`<h3>${T('تعيين رمز PIN')}</h3><input id="np" type="password" placeholder="${T('4 أرقام أو أكثر')}"><div class="btns"><button class="primary" id="np-ok">${T('حفظ')}</button></div>`); mm.querySelector('#np-ok').onclick = () => { const v = mm.querySelector('#np').value; if (v.length < 4) return toast(T('الرمز قصير جدًا')); S.parental.pin = v; S.unlocked = true; save('parental'); closeModal(); toast(T('تم حفظ رمز PIN')); }; };
  m.querySelector('#pa-off')?.addEventListener('click', () => { S.parental.pin = ''; save('parental'); closeModal(); renderCategories(); toast(T('تم إلغاء الرقابة الأبوية')); });
  m.querySelector('#pa-kids').onclick = () => { if (!S.parental.pin) { closeModal(); return toast(T('عيّن رمز PIN أولاً لتفعيل وضع الأطفال')); } setKids(!S.parental.kids); };
  m.querySelector('#pa-lock')?.addEventListener('click', () => {
    const locked = new Set(S.parental.locked[S.section] || []);
    const mm = modal(`<h3>${T('التصنيفات المقفولة')}</h3>${S.categories.filter(c => c.id && !c.id.startsWith('__')).map(c => `<label><input type="checkbox" data-id="${c.id}" ${locked.has(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}<div class="btns"><button class="primary" id="lk-ok">${T('تم')}</button></div>`);
    mm.querySelector('#lk-ok').onclick = () => { S.parental.locked[S.section] = [...mm.querySelectorAll('input:checked')].map(i => i.dataset.id); save('parental'); S.unlocked = false; closeModal(); renderCategories(); };
  });
}

// ---------- details ----------
async function openDetails(it) {
  show('details'); S.current = it; if (it.type === 'series') seenEpisodes(it);
  $('#d-title').textContent = it.name; $('#d-poster').src = it.imageUrl || 'icon.png'; hkAttachImgs($('#d-poster').parentElement); hkBg($('#d-backdrop'), it.imageUrl || '');
  $('#d-source').textContent = ''; $('#d-trailer').classList.add('hidden');
  $('#d-meta').textContent = ''; $('#d-genre').textContent = ''; $('#d-plot').textContent = T('جاري التحميل…'); $('#d-cast').textContent = ''; $('#d-director').textContent = '';
  $('#d-play').textContent = it.type === 'series' ? T('▶ الحلقات') : T('▶ تشغيل'); $('#d-ext').classList.toggle('hidden', it.type === 'series');
  $('#d-episodes').classList.add('hidden'); $('#d-ep-list').innerHTML = '';
  const fav = () => $('#d-fav').classList.toggle('on', !!S.favorites[key(it)]); fav(); $('#d-fav').onclick = () => { toggleFav(it); fav(); };
  const lat = () => { const on = !!S.later[key(it)]; $('#d-later').classList.toggle('on', on); $('#d-later').lastChild.textContent = on ? T(' في قائمتي') : T(' المشاهدة لاحقاً'); }; lat(); $('#d-later').onclick = () => { toggleLater(it); lat(); };
  const addGroupBtn = $('#d-addgroup'); if (addGroupBtn) addGroupBtn.onclick = () => openGroupPicker(it);
  const pr = S.progress[key(it)]; $('#d-resume').textContent = pr ? `${T('سيتم الاستكمال من')} ${fmt(pr.position)}` : '';
  $('#d-ext').onclick = () => openInExternal(it);
  $('#d-play').onclick = () => it.type === 'series' ? loadEpisodes(it) : play(it, {});
  try {
    const d = await X.details(it.type === 'series', it.id);
    $('#d-plot').textContent = unent(d.plot) || it.description || T('لا توجد قصة متاحة');
    const dur = prettyDur(d.duration);
    $('#d-meta').textContent = [d.year, dur, rating(d.rating) ? '★ ' + rating(d.rating).toFixed(1) : ''].filter(Boolean).join('  •  ');
    $('#d-genre').textContent = d.genre; if (d.cast) $('#d-cast').textContent = T('الممثلون: ') + unent(d.cast); if (d.director) $('#d-director').textContent = T('الإخراج: ') + unent(d.director);
    if (d.backdrop || d.image) hkBg($('#d-backdrop'), d.backdrop || d.image);
    if (!it.imageUrl && d.image) { $('#d-poster').src = d.image; $('#d-poster').dataset.hkAttached = ''; hkAttachImgs($('#d-poster').parentElement); }
    enrichDetails(it, d);
  } catch { $('#d-plot').textContent = it.description || T('تعذر تحميل التفاصيل'); enrichDetails(it, {}); }
  renderSimilar(it);
  if (it.type === 'series') loadEpisodes(it);
}
$('#d-back').onclick = () => show('home');
async function loadEpisodes(series) {
  $('#d-episodes').classList.remove('hidden'); $('#d-ep-list').innerHTML = T('<div class="muted">جاري التحميل…</div>');
  try {
    const { episodes } = await X.episodes(series.id); S.epList = episodes;
    const renderEps = q => { $('#d-ep-list').innerHTML = episodes.filter(e => !q || e.name.toLowerCase().includes(q)).map(e => `<div class="ep" data-id="${e.id}"><span>${esc(e.name)}</span><span class="muted">${S.progress[key(e)] ? '⏵ ' + Math.round(S.progress[key(e)].position / 1000 / 60) + T(' د') : ''}</span></div>`).join('') || T('<div class="muted">لا توجد حلقات</div>'); $$('.ep').forEach(el => el.onclick = () => play(episodes.find(e => e.id === +el.dataset.id), { seriesId: series.id })); };
    renderEps(''); $('#d-ep-search').oninput = e => renderEps(e.target.value.trim().toLowerCase());
  } catch (e) { $('#d-ep-list').innerHTML = T('<div class="muted">تعذر تحميل الحلقات</div>'); }
}
const fmt = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// ---------- player ----------
async function resolveStream(url) {
  // Many Xtream servers 302 a .ts request to an HLS playlist on another host (with a session token).
  // Follow the redirect once so we choose the right engine for the FINAL url and never hammer the origin.
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { Range: 'bytes=0-0' } });
    clearTimeout(t);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const fin = r.url || url;
    try { r.body && r.body.cancel(); } catch {}
    if (r.status === 503 || r.status === 429) return { url: fin, kind: 'busy', status: r.status };
    if (/mpegurl|m3u8/.test(ct) || /\.m3u8(\?|$)/i.test(fin)) return { url: fin, kind: 'hls' };
    if (/video\/mp2t|\.ts(\?|$)/i.test(ct + ' ' + fin)) return { url: fin, kind: 'ts' };
    if (/video\/mp4|\.(mp4|mkv|webm)(\?|$)/i.test(ct + ' ' + fin)) return { url: fin, kind: 'file' };
    return { url: fin, kind: /\.m3u8/i.test(url) ? 'hls' : /\.ts/i.test(url) ? 'ts' : 'file' };
  } catch { return { url, kind: /\.m3u8/i.test(url) ? 'hls' : /\.ts/i.test(url) ? 'ts' : 'file' }; }
}
let attachGen = 0;
// Buffers sized for a 1 GB TV: enough ahead to ride out jitter, small back-buffer so seeks/zaps stay cheap.
const HLS_CFG = { lowLatencyMode: false, backBufferLength: TV ? 20 : 30, maxBufferLength: TV ? 25 : 30, maxMaxBufferLength: 60, maxBufferSize: (TV ? 40 : 60) * 1000 * 1000,
  startFragPrefetch: true, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3, fragLoadingMaxRetry: 4, fragLoadingRetryDelay: 600, nudgeMaxRetry: 5 };
const RETRIES = 3;
function busy(on, msg) { const el = $('#p-spin'); if (!el) return; el.classList.toggle('hidden', !on); el.querySelector('span').textContent = msg || ''; }
async function attach(video, url, { live, tries = 0 } = {}) {
  url = await url;   // 6.0: M3U/MAC accounts resolve the stream URL asynchronously; Xtream stays a plain string (no-op await)
  detach(video); const gen = ++attachGen; if (video.id === 'video') busy(true, tries ? `${T('إعادة المحاولة')} ${tries}/${RETRIES}…` : '');
  const retry = why => { if (gen !== attachGen) return; if (video.id === 'video' && failover(why)) return; if (tries < RETRIES) { setTimeout(() => { if (gen === attachGen) attach(video, url, { live, tries: tries + 1 }).then(() => video.play().catch(() => {})); }, 1200 * (tries + 1)); } else { busy(false); toast(why, 4000); logError('تشغيل ' + ((ctx.item && ctx.item.name) || ''), why); } };
  video._retry = retry;
  // live watchdog: a stream that opens but never delivers frames raises no error — treat 10 s without progress as a failure
  if (live && video.id === 'video') { clearInterval(video._wd); let last = -1, still = 0; video._wd = setInterval(() => { if (gen !== attachGen) return clearInterval(video._wd); if (video.paused && video.readyState >= 3) { still = 0; return; } const t = video.currentTime; if (video.readyState >= 3 && t !== last) { still = 0; last = t; return; } last = t; if (++still >= 10) { clearInterval(video._wd); logError('توقف البث', (ctx.item && ctx.item.name) || ''); retry(T('توقف البث')); } }, 1000); }
  const r = await resolveStream(url); if (gen !== attachGen) return;
  if (r.kind === 'busy') return retry(T('السيرفر مشغول (') + r.status + T(') — جرّب بعد ثوانٍ'));
  // Tizen: hls.js/mpegts.js rely on MSE blob: sources, reported unreliable in Samsung's webview (see
  // docs/tv/SAMSUNG-BROWSER.md). window.HK_TIZEN_AVPLAY is set by platform.js only on a real/stubbed
  // Tizen webview with webapis.avplay present; every other platform never takes this branch.
  if (window.HK_TIZEN_AVPLAY && window.HK_avplay && r.kind !== 'busy') {
    try {
      video._engine = window.HK_avplay.attach(video, r.url, { live, onError: () => retry(T('تعذر تشغيل البث')) });
      return;
    } catch (e) { /* fall through to hls.js/mpegts.js below as a last resort */ }
  }
  if (r.kind === 'hls' && Hls.isSupported()) {
    const h = new Hls(HLS_CFG); h.loadSource(r.url); h.attachMedia(video); video._engine = h;
    if (video.id === 'video' && window.HK_stream && typeof HK_stream.attach === 'function') { try { HK_stream.attach(video, { hls: h }); } catch (e) {} }
    let mediaRecovered = 0;
    h.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal || gen !== attachGen) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecovered++ < 2) { h.recoverMediaError(); return; }
      const code = d.response && d.response.code;
      retry(code === 503 || code === 429 ? T('السيرفر مشغول — جرّب بعد ثوانٍ') : T('تعذر تشغيل البث'));
    });
    return;
  }
  if (r.kind === 'ts') return fallbackTs(video, r.url, live, retry);
  video.src = r.url; video._engine = null;
}
function fallbackTs(video, url, live, retry) {
  detach(video);
  if (!mpegts.isSupported()) { video.src = url; return; }
  const p = mpegts.createPlayer({ type: 'mpegts', isLive: !!live, url }, { enableStashBuffer: true, stashInitialSize: 384, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 8, liveBufferLatencyMinRemain: 2, autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 30, autoCleanupMinBackwardDuration: 15 });
  p.attachMediaElement(video); p.load(); p.play().catch(() => {}); video._engine = p;
  if (video.id === 'video' && window.HK_stream && typeof HK_stream.attach === 'function') { try { HK_stream.attach(video, { mpegts: p }); } catch (e) {} }
  let tsErr = false;
  p.on(mpegts.Events.ERROR, (type, detail, info) => { if (tsErr) return; tsErr = true; const code = info && info.code; const why = code === 503 || code === 429 ? T('السيرفر مشغول — جرّب بعد ثوانٍ') : T('تعذر تشغيل البث'); if (retry) retry(why); else { detach(video); toast(why); } });
}
function detach(video) { clearInterval(video._wd); const e = video._engine; if (e) { try { e.destroy(); } catch {} } video._engine = null; video.removeAttribute('src'); video.load(); if (video.id === 'video' && window.HK_stream && typeof HK_stream.detach === 'function') { try { HK_stream.detach(); } catch (err) {} } }

let ctx = {};
function play(it, opts) {
  if (S.updLock) return updateWindow(S.updLock);   // 5.12.3: forced update
  if (licBlocked()) return licMenu();   // 5.11: trial over / subscription ended
  clearTimeout(zapT); clearTimeout(seekT); seekTarget = null;
  // back returns to the screen the player was opened from (a channel from the list used to land on the last movie's details)
  const from = visible('player') ? (ctx.from || 'home') : visible('details') ? 'details' : 'home';
  show('player'); subsClear(); ctx = { item: it, live: !!opts.live, seriesId: opts.seriesId || 0, nextArmed: false, from };
  const v = $('#video'); $('#p-title').textContent = it.name; playerId(it); $('#p-epg').textContent = ctx.live ? T('جاري تحميل دليل البرامج…') : ''; $('#p-guide-panel').classList.add('hidden'); $('#p-next-ep').classList.add('hidden');
  $('#p-prev').classList.toggle('hidden', !ctx.live); $('#p-next').classList.toggle('hidden', !ctx.live); $('#p-last').classList.toggle('hidden', !ctx.live || !S.lastCh); $('#p-guide').classList.toggle('hidden', !ctx.live);
  $('#p-seek-row').classList.toggle('hidden', ctx.live); $('#p-back10').classList.toggle('hidden', ctx.live); $('#p-fwd10').classList.toggle('hidden', ctx.live);
  video.defaultPlaybackRate = 1; video.playbackRate = 1; setPlayIcon(false); video.style.objectFit = S.prefs.aspect || 'contain'; hideUpNext(); $('#p-skip').classList.add('hidden'); ctx.skipUsed = false;
  addHistory(it); ctx.t0 = Date.now(); ctx.perfKey = ctx.live ? 'zap' : null; prepVariant(it);
  attach(v, X.url(it), { live: ctx.live }).then(() => { const pr = S.progress[key(it)]; if (!ctx.live && pr && pr.position > 30000) { v.currentTime = pr.position / 1000; toast(T('استكمال المشاهدة')); } v.play().catch(() => {}); });
  if (ctx.live) loadEpg(it.id);
  if (ctx.seriesId && !S.epList.find(e => e.id === it.id)) X.episodes(ctx.seriesId).then(r => S.epList = r.episodes).catch(() => {});
  showOverlay();
}
async function loadEpg(id) {
  try { const list = await epgFor(ctx.item); if (ctx.item?.id !== id) return; const now = Date.now() / 1000; const cur = list.find(e => e.start <= now && now < e.end); const next = list.find(e => e.start > now);
    $('#p-epg').textContent = cur ? `${T('الآن:')} ${cur.title}${next ? T('   |   التالي: ') + next.title : ''}` : list.length ? T('دليل البرامج متاح') : T('لا توجد بيانات EPG');
    ctx.epgCur = cur || null; epgProgress();
    $('#p-guide-panel').textContent = list.map(e => `${t(e.start)}  ${e.title}`).join('\n') || T('لا توجد بيانات');
  } catch { $('#p-epg').textContent = T('دليل البرامج غير متاح'); }
}
// 5.14: channel logo + how far the current programme has got, in the player bar
function playerId(it) {
  const lg = $('#p-logo'), u = ctx.live && it && it.imageUrl;
  lg.classList.toggle('hidden', !u); if (u) { lg.onerror = () => lg.classList.add('hidden'); lg.dataset.hkAttached = ''; if (window.HK_img && HK_img.attach) HK_img.attach(lg, u); else lg.src = u; }
  ctx.epgCur = null; $('#p-prog').classList.add('hidden'); playerMeta(it);
}
// 7.0.6 player redesign: one quiet line under the title (kind · year · rating · duration), VOD only
function playerMeta(it) {
  const el = $('#p-meta'); if (!el) return;
  if (ctx.live || !it) { el.textContent = ''; el.classList.add('hidden'); return; }
  const kind = it.type === 'episode' ? T('حلقة') : it.type === 'series' ? T('مسلسل') : T('فيلم');
  const y = (String(it.year || it.releaseDate || '').match(/(19|20)\d\d/) || String(it.name || '').match(/\b(19|20)\d\d\b/) || [])[0];
  const parts = [kind, y, rating(it.rating) ? '★ ' + it.rating : ''].filter(Boolean);
  const d = video.duration; if (d && isFinite(d) && d > 60) { const m = Math.round(d / 60); parts.push(m >= 60 ? Math.floor(m / 60) + T('س') + ' ' + (m % 60) + T('د') : m + T('د')); }
  el.textContent = parts.join('  ·  '); el.classList.toggle('hidden', !parts.length);
}
$('#video').addEventListener('loadedmetadata', () => { if (visible('player')) playerMeta(ctx.item); });   // (video const is declared further down)
function epgProgress() {
  const c = ctx.epgCur, el = $('#p-prog'); if (!c || !(c.end > c.start)) return el.classList.add('hidden');
  const pct = Math.max(0, Math.min(100, (Date.now() / 1000 - c.start) * 100 / (c.end - c.start)));
  el.querySelector('b').style.width = pct.toFixed(1) + '%'; $('#p-prog-a').textContent = t(c.start); $('#p-prog-b').textContent = t(c.end); el.classList.remove('hidden');
}
const t = s => s ? localDate(s * 1000).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '--:--';
let zapT;
function zap(d) {
  if (S.channelQueue.length < 2) return;
  S.channelIndex = (S.channelIndex + d + S.channelQueue.length) % S.channelQueue.length; const c = S.channelQueue[S.channelIndex]; ctx.item = c;
  $('#p-title').textContent = (S.channelIndex + 1) + '  ' + c.name; playerId(c); $('#p-epg').textContent = '…'; showOverlay(); busy(true, c.name);
  clearTimeout(zapT); zapT = setTimeout(() => { if (ctx.item !== c) return; ctx.t0 = Date.now(); ctx.perfKey = 'zap'; addHistory(c); prepVariant(c); attach($('#video'), X.url(c), { live: true }).then(() => $('#video').play().catch(() => {})); loadEpg(c.id); }, 450);
}
$('#p-prev').onclick = () => zap(-1); $('#p-next').onclick = () => zap(1);
$('#p-guide').onclick = () => $('#p-guide-panel').classList.toggle('hidden');
$('#p-ext').onclick = () => openInExternal(ctx.item);
$('#p-stream-info').onclick = () => {
  const on = $('#p-stream-info').classList.toggle('on');
  let panel = $('#p-guide-panel').parentElement.querySelector('.hk-stream-panel');
  if (!on) { if (panel) panel.remove(); return; }
  if (window.HK_stream && typeof HK_stream.panel === 'function') {
    try { if (panel) panel.remove(); panel = HK_stream.panel(); panel.classList.add('hk-stream-panel'); $('#p-overlay').appendChild(panel); } catch (e) {}
  } else { $('#p-stream-info').classList.remove('on'); toast(T('معلومات البث غير متاحة')); }
};
if (window.hk && typeof window.hk.mini === 'function') {
  $('#p-mini').classList.remove('hidden');
  let miniOn = false;
  $('#p-mini').onclick = () => { miniOn = !miniOn; $('#p-mini').classList.toggle('on', miniOn); window.hk.mini(miniOn); };
}
if (window.hk && typeof window.hk.onMediaKey === 'function') {
  window.hk.onMediaKey(act => {
    if (!visible('player')) return;
    if (act === 'playpause') togglePlay();
    else if (act === 'next' && ctx.live) zap(1);
    else if (act === 'prev' && ctx.live) zap(-1);
    else if (act === 'stop') closePlayer();
  });
}
// 5.9.3: hand the stream to VLC/mpv/PotPlayer/MPC. The in-app stream is stopped first — the subscription allows ONE connection,
// so leaving it open made the external player get 503.
async function openInExternal(it) {
  if (!it || !H.externalPlayer) return;
  const url = await Promise.resolve(X.url(it)), wasPlaying = visible('player');
  if (wasPlaying) { saveProgress(); detach(video); }
  const name = await H.externalPlayer(url, it.name).catch(() => null);
  if (name) { if (wasPlaying) closePlayer(); toast(`${T('تم الفتح في')} ${name}`); return; }
  if (wasPlaying) attach(video, url, { live: ctx.live }).then(() => video.play().catch(() => {}));   // nothing installed: resume here
  const m = modal(`<h3>${T('مشغل خارجي')}</h3><p class="muted">${T('لا يوجد مشغّل فيديو مثبّت على الجهاز. ثبّت VLC (مجاني) وبعدها سيفتح هذا الزر الفيديو فيه مباشرة.')}</p>
    <button class="opt" id="x-vlc">${ic('external')} ${T('تحميل VLC')}</button><button class="opt" id="x-copy">${ic('plus')} ${T('نسخ رابط الفيديو')}</button>`);
  m.querySelector('#x-vlc').onclick = () => { H.openExternal('https://www.videolan.org/vlc/'); closeModal(); };
  m.querySelector('#x-copy').onclick = async () => { await H.copy(url); closeModal(); toast(T('تم نسخ الرابط')); };
  paintIcons();
}
$('#p-fs').onclick = async () => H.fullscreen(!(await H.isFullscreen()));
$('#p-close').onclick = closePlayer;
$('#p-tracks').onclick = () => subsMenu();
function legacyTracks() {
  const v = $('#video'); const a = v.audioTracks ? [...v.audioTracks] : []; const tt = [...v.textTracks];
  if (!a.length && !tt.length) return toast(T('لا توجد مسارات صوت أو ترجمة إضافية'));
  const m = modal(`<h3>${T('الصوت والترجمة')}</h3>${a.map((x, i) => `<button class="opt ${x.enabled ? 'on' : ''}" data-a="${i}">${ic('audio')} ${x.label || x.language || T('مسار ') + (i + 1)}</button>`).join('')}${tt.map((x, i) => `<button class="opt ${x.mode === 'showing' ? 'on' : ''}" data-t="${i}">${ic('subtitles')} ${x.label || x.language || T('ترجمة ') + (i + 1)}</button>`).join('')}<button class="opt" data-t="-1">${ic('close')} ${T('إيقاف الترجمة')}</button>`);
  m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { a.forEach((x, i) => x.enabled = i === +b.dataset.a); closeModal(); });
  m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tt.forEach((x, i) => x.mode = i === +b.dataset.t ? 'showing' : 'disabled'); closeModal(); });
};
$('#p-next-ep').onclick = nextEpisode;
function nextEpisode() { const i = S.epList.findIndex(e => e.id === ctx.item.id); if (i < 0 || i + 1 >= S.epList.length) return; S.progDone[key(ctx.item)] = Date.now(); save('progDone'); delete S.progress[key(ctx.item)]; save('progress'); play(S.epList[i + 1], { seriesId: ctx.seriesId }); toast(T('الحلقة التالية: ') + S.epList[i + 1].name); }
const video = $('#video');
video.addEventListener('timeupdate', () => { if (ctx.live || !ctx.item) return; updateSkip(); if (ctx.seriesId && video.duration && video.duration - video.currentTime < 45 && !ctx.nextArmed && S.epList.findIndex(e => e.id === ctx.item.id) + 1 < S.epList.length) { ctx.nextArmed = true; $('#p-next-ep').classList.remove('hidden'); } });
video.addEventListener('ended', () => { if (ctx.seriesId && !ctx.upShown) showUpNext(); });
// Some streams never fire 'ended' (server closes early) — also trigger in the last 1.5 s.
video.addEventListener('timeupdate', () => { if (ctx.seriesId && !ctx.upShown && video.duration > 60 && video.duration - video.currentTime < 1.5) showUpNext(); });
video.addEventListener('error', () => { if (ctx.item && !ctx.live && video._engine == null) Promise.resolve(X.url(ctx.item)).then(u => fallbackTs(video, u, false)); });
let saveTimer; video.addEventListener('timeupdate', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveProgress, 2000); });
function saveProgress() { if (ctx.live || !ctx.item || !video.duration) return; const pos = video.currentTime * 1000, dur = video.duration * 1000; const k = key(ctx.item); syncSoon(); if (pos < 30000 || dur - pos < 60000) { if (S.progress[k]) S.progDone[k] = Date.now(); delete S.progress[k]; save('progDone'); if (dur - pos < 60000 && S.later[k]) toggleLater(ctx.item, true); } else S.progress[k] = { position: pos, duration: dur, updatedAt: Date.now(), item: ctx.item, seriesId: ctx.seriesId }; save('progress'); }
function closePlayer() { subsClear(); hideUpNext(); ctrlMode = false; clearTimeout(zapT); clearTimeout(seekT); seekTarget = null; busy(false); saveProgress(); detach(video); if (!TV) H.fullscreen(false); const from = ctx.from || 'home'; ctx = {}; show(from); if (S.section === 'continue') switchSection('continue'); }
// ---- playback controls ----
const seek = $('#p-seek'), vol = $('#p-volume');
function flash(txt, html) { const el = document.createElement('div'); el.className = 'p-flash'; if (html) el.innerHTML = txt; else el.textContent = txt; $('#player').appendChild(el); setTimeout(() => el.remove(), 900); }
function togglePlay() { if (video.paused) { video.play().catch(() => {}); flash(ic('play'), true); } else { video.pause(); flash(ic('pause'), true); } showOverlay(); }
let seekTarget = null, seekT;
function seekBy(s) {
  if (ctx.live || !video.duration) return;
  const base = seekTarget == null ? video.currentTime : seekTarget;
  seekTarget = Math.max(0, Math.min(video.duration - 1, base + s));
  const delta = Math.round(seekTarget - video.currentTime), p = seekTarget / video.duration * 1000;
  seek.value = p; seek.style.setProperty('--pct', p / 10 + '%'); $('#p-cur').textContent = fmt(seekTarget * 1000);
  flashSeek((delta >= 0 ? '⟳ +' : '⟲ −') + fmtDelta(Math.abs(delta)));
  showOverlay(); clearTimeout(seekT); seekT = setTimeout(commitSeek, 650);
}
function commitSeek() { clearTimeout(seekT); if (seekTarget == null) return; video.currentTime = seekTarget; seekTarget = null; }
const fmtDelta = s => s >= 60 ? Math.floor(s / 60) + (EN_UI ? 'm ' : 'د ') + (s % 60 ? (s % 60) + (EN_UI ? 's' : 'ث') : '') : s + (EN_UI ? 's' : 'ث');
function flashSeek(txt) { let el = $('#p-seekflash'); if (!el) { el = document.createElement('div'); el.id = 'p-seekflash'; el.className = 'p-flash sticky'; $('#player').appendChild(el); } el.textContent = txt; el.classList.remove('out'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('out'), 900); }
// Held key → bigger steps: 10s, then 30s, then 60s.
let holdN = 0, holdLast = 0;
function stepFor(e) { const now = Date.now(); holdN = e && e.repeat && now - holdLast < 400 ? holdN + 1 : 0; holdLast = now; return holdN > 20 ? 60 : holdN > 5 ? 30 : 10; }
function setVolume(v) { v = Math.max(0, Math.min(1, v)); video.volume = v; video.muted = v === 0; vol.value = Math.round(v * 100); vol.style.setProperty('--pct', vol.value + '%'); $('#p-vol-val').textContent = vol.value + '%'; $('#p-mute').innerHTML = ic(video.muted || v === 0 ? 'mute' : v < .5 ? 'volume-low' : 'volume'); H.store.set('volume', v); showOverlay(); }
function toggleMute() { video.muted = !video.muted; $('#p-mute').innerHTML = ic(video.muted ? 'mute' : 'volume'); flash(video.muted ? ic('mute') : ic('volume') + ' ' + Math.round(video.volume * 100) + '%', true); showOverlay(); }
$('#p-play').onclick = togglePlay; $('#p-back10').onclick = () => seekBy(-10); $('#p-fwd10').onclick = () => seekBy(10);
$('#p-mute').onclick = toggleMute; vol.oninput = () => setVolume(vol.value / 100);

let seeking = false;
seek.addEventListener('input', () => { seeking = true; seek.style.setProperty('--pct', seek.value / 10 + '%'); $('#p-cur').textContent = fmt(seek.value / 1000 * (video.duration || 0) * 1000); });
seek.addEventListener('change', () => { if (video.duration) video.currentTime = seek.value / 1000 * video.duration; seeking = false; });
video.addEventListener('waiting', () => { if (visible('player')) busy(true); }); ['playing', 'canplay', 'seeked'].forEach(ev => video.addEventListener(ev, () => busy(false)));
video.addEventListener('play', () => setPlayIcon(false)); video.addEventListener('pause', () => setPlayIcon(true));
function setPlayIcon(paused) { $('#p-play').innerHTML = ic(paused ? 'play' : 'pause'); }
video.addEventListener('timeupdate', () => { if (seeking || seekTarget != null || !video.duration || ctx.live) return; const p = video.currentTime / video.duration * 1000; seek.value = p; seek.style.setProperty('--pct', p / 10 + '%'); $('#p-cur').textContent = fmt(video.currentTime * 1000); $('#p-dur').textContent = fmt(video.duration * 1000); });
video.addEventListener('dblclick', () => $('#p-fs').click());
video.addEventListener('click', togglePlay);
$('#player').addEventListener('wheel', e => { e.preventDefault(); setVolume(video.volume + (e.deltaY < 0 ? .05 : -.05)); flash(ic('volume') + ' ' + Math.round(video.volume * 100) + '%', true); }, { passive: false });
H.store.get('volume').then(v => { if (typeof v === 'number') setVolume(v); });

let ovT; function showOverlay() { if (ctx && ctx.epgCur) epgProgress(); $('#p-overlay').classList.remove('hide'); $('#player').style.cursor = ''; clearTimeout(ovT); ovT = setTimeout(() => { if (!video.paused) { ctrlMode = false; $('#p-overlay').classList.add('hide'); $('#player').style.cursor = 'none'; } }, 3500); }
$('#player').addEventListener('mousemove', showOverlay);
// ---------- keys: keyboard (Windows) + LG remote (webOS) ----------
const KC = { OK: 13, BACK: 461, PLAY: 415, PAUSE: 19, PLAYPAUSE: 179, STOP: 413, REW: 412, FF: 417, CHUP: 33, CHDN: 34, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };
const DIRS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
const visible = id => !$('#' + id).classList.contains('hidden');
function exitApp() { try { if (window.webOS && webOS.platformBack) return webOS.platformBack(); if (window.PalmSystem && PalmSystem.platformBack) return PalmSystem.platformBack(); } catch {} }
// 5.13.6: a short message over any screen (toast() only shows inside the player)
function hint(msg, ms = 2000) {
  let el = $('#hint'); if (!el) { el = document.createElement('div'); el.id = 'hint'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), ms);
}
function goBack() {
  if (Nav.typing()) return Nav.stopTyping();
  if (visible('modal')) return S.updLock || (S.licLock && licBlocked()) ? exitApp() : closeModal();
  if (visible('player') && !$('#p-upnext').classList.contains('hidden')) { hideUpNext(); return; }
  if (visible('player')) { if (TV && ctrlMode) { ctrlMode = false; $('#p-overlay').classList.add('hide'); return; } return closePlayer(); }
  if (visible('multi')) return $('#m-close').click();
  if (visible('details')) return show('home');
  if (visible('login')) return S.profile ? openHome() : exitApp();
  if (visible('home')) {
    // 5.13.6: same steps as Android — content → the section's tab → Home → «press again to exit» (two presses within
    // 2 s). Before, Back on any tab closed the app on the TV, even from Movies.
    if (Nav.inside('#guide') || Nav.inside('#content') || Nav.inside('#categories') || Nav.inside('.toolbar') || Nav.inside('#hero') || Nav.inside('.shelf-row')) { S.exitArm = 0; return Nav.set($('.tab.active')); }
    if (S.section !== 'home') { S.exitArm = 0; return switchSection('home').then(() => Nav.set($('.tab.active'))); }
    if (!window.PalmSystem && !window.webOS) return;   // Windows: the window has its own close button, Back does not exit
    if (S.exitArm && Date.now() - S.exitArm <= 2000) return exitApp();
    S.exitArm = Date.now(); return hint(T('اضغط رجوع مرة أخرى للخروج'));
  }
}
function desktopPlayerKey(e) {
  const k = e.key;
  if (k === 'f' || k === 'F') { $('#p-fs').click(); return true; }
  if (k === ' ' || k === 'k' || k === 'K') { togglePlay(); return true; }
  if (k === 'm' || k === 'M') { toggleMute(); return true; }
  if (k === 'ArrowRight') { ctx.live ? zap(1) : seekBy(e.shiftKey ? 60 : stepFor(e)); return true; }
  if (k === 'ArrowLeft') { ctx.live ? zap(-1) : seekBy(-(e.shiftKey ? 60 : stepFor(e))); return true; }
  if (k === 'ArrowUp') { setVolume(video.volume + .05); flash(ic('volume') + ' ' + Math.round(video.volume * 100) + '%', true); return true; }
  if (k === 'ArrowDown') { setVolume(video.volume - .05); flash(ic('volume') + ' ' + Math.round(video.volume * 100) + '%', true); return true; }
  if (k === '+' || k === '=') { video.defaultPlaybackRate = video.playbackRate = Math.min(2, +(video.playbackRate + .25).toFixed(2)); flash(video.playbackRate + '×'); return true; }
  if (k === '-') { video.defaultPlaybackRate = video.playbackRate = Math.max(.5, +(video.playbackRate - .25).toFixed(2)); flash(video.playbackRate + '×'); return true; }
  if (k === 'n' || k === 'N') { nextEpisode(); return true; }
  if (/^[0-9]$/.test(k) && !ctx.live && video.duration) { video.currentTime = video.duration * (+k / 10); showOverlay(); return true; }
  if (k === 'Enter' && document.activeElement && document.activeElement !== document.body) return false;
  showOverlay(); return false;
}
/* TV remote in the player — one rule set, whether the controls are showing or not:
 *  ◀▶  seek (VOD, accelerating when held) / change channel (live)
 *  OK  play / pause
 *  ▲▼  enter the control buttons; inside them ◀▶▲▼ move and OK presses. Leaving = controls auto-hide or BACK. */
let ctrlMode = false;
function tvPlayerKey(e) {
  const kc = e.keyCode;
  if (!DIRS[kc] && kc !== KC.OK) { showOverlay(); return false; }
  Nav.keyboardMode(true);
  const lr = kc === 37 || kc === 39, d = kc === 39 ? 1 : -1;
  if (!ctrlMode) {
    if (lr) { if (ctx.live) zap(d); else { Nav.set($('#p-seek'), { scroll: false }); seekBy(d * stepFor(e)); } return true; }
    if (kc === KC.OK) { commitSeek(); togglePlay(); return true; }
    ctrlMode = true; showOverlay(); Nav.set(ctx.live ? $('#p-play') : kc === 38 ? $('#p-seek') : $('#p-play')); return true;
  }
  showOverlay();
  const c = Nav.current() && Nav.inside('#player') ? Nav.current() : null;
  if (!c) { Nav.set($('#p-play')); return true; }
  if (c.id === 'p-seek' && lr) { seekBy(d * stepFor(e)); return true; }
  if (c.id === 'p-volume' && lr) { setVolume(video.volume + d * .05); return true; }
  if (kc === KC.OK) { if (c.id === 'p-seek') { commitSeek(); togglePlay(); } else Nav.activate(); return true; }
  Nav.move(DIRS[kc]);
  return true;
}
function playerKey(e) {
  const kc = e.keyCode;
  if (kc === KC.PLAY) { if (video.paused) togglePlay(); return true; }
  if (kc === KC.PAUSE) { if (!video.paused) togglePlay(); return true; }
  if (kc === KC.PLAYPAUSE) { togglePlay(); return true; }
  if (kc === KC.STOP) { closePlayer(); return true; }
  if (kc === KC.REW) { seekBy(-30); return true; }
  if (kc === KC.FF) { seekBy(30); return true; }
  if (kc === KC.CHUP) { zap(1); return true; }
  if (kc === KC.CHDN) { zap(-1); return true; }
  if (kc === KC.GREEN && ctx.live) { $('#p-guide').click(); showOverlay(); return true; }
  if (kc === KC.BLUE && ctx.seriesId) { nextEpisode(); return true; }
  if (ctx.live && digitOf(e) != null) { numKey(digitOf(e)); return true; }
  if (ctx.live && e.key === 'Backspace') { lastChannel(); return true; }
  if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type !== 'range')) return false;
  return TV ? tvPlayerKey(e) : desktopPlayerKey(e);
}
document.addEventListener('keydown', e => {
  const kc = e.keyCode;
  if (kc === KC.BACK || e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') { e.preventDefault(); return goBack(); }
  if (visible('player') && !visible('modal')) { if (playerKey(e)) e.preventDefault(); return; }
  if (Nav.typing()) {
    if (kc === KC.OK || kc === 38 || kc === 40) { e.preventDefault(); Nav.stopTyping(); Nav.keyboardMode(true); if (kc !== KC.OK || $('#search') !== Nav.current()) Nav.move(kc === 38 ? 'up' : 'down'); }
    return;
  }
  if (DIRS[kc]) {
    e.preventDefault(); Nav.keyboardMode(true);
    if (!Nav.move(DIRS[kc]) && DIRS[kc] === 'down' && Nav.inside('#content') && renderMore()) Nav.move('down');
    return;
  }
  if (kc === KC.OK && Nav.current()) { e.preventDefault(); Nav.keyboardMode(true); return Nav.activate(); }
  if (visible('home') && !visible('modal') && digitOf(e) != null && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) { e.preventDefault(); return numKey(digitOf(e)); }
  if (kc === KC.YELLOW || kc === KC.RED) { const c = Nav.current(); const card = c && c.closest('.card'); if (card) toggleFav(S.shown[+card.dataset.i]); }
  if (kc === KC.CHUP || kc === KC.CHDN) { const c = $('#content'); c.scrollTop += (kc === KC.CHDN ? 1 : -1) * c.clientHeight * .9; }
});
if (TV) Nav.keyboardMode(true);

// ---------- multi-screen ----------
const M = S.multi;
$('#multi-btn').onclick = () => { show('multi'); setActiveSlot(0); };
$$('.m-slot').forEach(el => { let last = 0; el.onclick = () => { const i = +el.dataset.i; const now = Date.now(); if (i === M.active && now - last < 320) return toggleFull(); last = now; if (i === M.active) pickChannel(i); else setActiveSlot(i); }; });
function setActiveSlot(i) { M.active = i; $$('.m-slot').forEach(el => { const on = +el.dataset.i === i; el.classList.toggle('active', on); el.querySelector('video').muted = !on; }); }
function toggleFull() { $('#m-grid').classList.toggle('full'); if (!$('#m-grid').classList.contains('full')) $('#m-grid').classList.add(M.mode); }
$('#m-toggle').onclick = () => { M.mode = M.mode === 'four' ? 'two' : 'four'; $('#m-grid').className = 'm-grid ' + M.mode; $('#m-toggle').textContent = M.mode === 'four' ? T('شاشتان') : T('أربع شاشات'); if (M.mode === 'two') [2, 3].forEach(clearSlot); if (M.active > 1 && M.mode === 'two') setActiveSlot(0); };
// 6.0 F18: multi-screen layout «كبيرة + 3» — one big slot (0) + three small ones; audio already follows
// the active slot via setActiveSlot()'s mute toggle, so switching layout needs no extra audio-routing code.
$('#m-big3') && ($('#m-big3').onclick = () => { M.mode = M.mode === 'big3' ? 'four' : 'big3'; $('#m-grid').className = 'm-grid ' + M.mode; $('#m-big3').classList.toggle('on', M.mode === 'big3'); $('#m-toggle').classList.toggle('hidden', M.mode === 'big3'); });
$('#m-pick').onclick = () => pickChannel(M.active);
$('#m-clear').onclick = () => clearSlot(M.active);
$('#m-close').onclick = () => { [0, 1, 2, 3].forEach(clearSlot); $('#m-grid').className = 'm-grid ' + M.mode; show('home'); };
function clearSlot(i) { const el = $(`.m-slot[data-i="${i}"]`); detach(el.querySelector('video')); el.classList.remove('has'); el.querySelector('.m-label').textContent = ''; M.channels[i] = null; }
async function pickChannel(i) {
  const m = modal(`<h3>${T('اختيار قناة')}</h3><input id="mp-q" placeholder="${T('ابحث عن قناة…')}"><div class="list" id="mp-list"><div class="muted">${T('جاري التحميل…')}</div></div>`);
  let all = favList().filter(f => f.type === 'live').map(f => ({ ...f, star: true }));
  try { const live = await X.media('live', S.section === 'live' ? S.categoryId.replace(/^__.*/, '') : ''); const ids = new Set(all.map(a => a.id)); all = all.concat(live.filter(l => !ids.has(l.id))); } catch {}
  const r = q => { const list = all.filter(c => !q || c.name.toLowerCase().includes(q)).slice(0, 300); m.querySelector('#mp-list').innerHTML = list.map(c => `<div class="ep" data-id="${c.id}">${c.star ? '★ ' : ''}${esc(c.name)}</div>`).join('') || T('<div class="muted">لا توجد نتائج</div>'); m.querySelectorAll('.ep').forEach(el => el.onclick = () => { const c = all.find(x => x.id === +el.dataset.id); closeModal(); tuneSlot(i, c); }); };
  r(''); m.querySelector('#mp-q').oninput = e => r(e.target.value.trim().toLowerCase()); m.querySelector('#mp-q').focus();
}
function tuneSlot(i, c) { const el = $(`.m-slot[data-i="${i}"]`); const v = el.querySelector('video'); attach(v, X.url(c), { live: true }).then(() => { v.muted = i !== M.active; v.play().catch(() => {}); }); el.classList.add('has'); el.querySelector('.m-label').textContent = c.name; M.channels[i] = c; }


// =====================================================================================
// 5.3 — see SPEC-5.3.md (identical behaviour on Android)
// =====================================================================================
// 5.13: helper services run on our own server (they used to be n8n workflows). Every call gives up after 12 s, so a
// hung server shows "couldn't load" instead of loading forever. Video never goes through here.
const FEED = 'https://sohbatna.com/api/v1/';   // 7.0.4: new host
const feed = (name, opts = {}) => { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
  return fetch(FEED + name, Object.assign({}, opts, { signal: ctl.signal })).finally(() => clearTimeout(t)); };
const kidsItem = i => !S.parental.kids || KIDS_RE.test(i.categoryName || '') || KIDS_RE.test((S.catNames[i.type === 'movie' ? 'movies' : i.type === 'live' ? 'live' : 'series'] || {})[i.categoryId] || '');
const hhmm = s => { const d = localDate(s * 1000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };

// ---- error log + perf ----
function logError(where, e) {
  const msg = String((e && e.message) || e || '').slice(0, 200);
  S.errors = [{ at: Date.now(), where: String(where).slice(0, 60), msg }].concat(S.errors || []).slice(0, 50); H.store.set('errors', S.errors);
}
window.addEventListener('error', e => logError('JS', e.message + (e.lineno ? ' @' + e.lineno : '')));
window.addEventListener('unhandledrejection', e => logError('Promise', e.reason));
function perfMark(k, ms) { if (!(ms > 0) || ms > 120000) return; S.perf[k] = Math.round(ms / 100) / 10; H.store.set('perf', S.perf); }
video.addEventListener('playing', () => { if (ctx.perfKey && ctx.t0) { perfMark(ctx.perfKey, Date.now() - ctx.t0); ctx.perfKey = null; } });
video.addEventListener('seeking', () => { ctx.seekT0 = Date.now(); });
video.addEventListener('seeked', () => { if (ctx.seekT0) perfMark('seek', Date.now() - ctx.seekT0); ctx.seekT0 = 0; });

// ---- 5.13 programme guide: ONLY the subscriber's own sources, in this order ----
//  1. the account's XMLTV link (added by the subscriber in the account settings), else the provider's xmltv.php
//  2. the provider's per-channel get_short_epg
// Never a third-party guide feed (5.12 and older pulled one through n8n). Same rules as Android EpgFeed.java / EpgXml.java.
const GUIDE = { g: null, at: 0, pid: '', src: '', p: null, failAt: 0 };
const guideUrl = () => { const u = (S.profile && S.profile.epgUrl || '').trim(); return u || `${X.base()}/xmltv.php?username=${encodeURIComponent(S.profile.username)}&password=${encodeURIComponent(S.profile.password)}`; };
function guideFull() {
  const pid = S.profile.id + '|' + (S.profile.epgUrl || '');
  if (GUIDE.pid === pid && GUIDE.g && Date.now() - GUIDE.at < 4 * 3600000) return Promise.resolve(GUIDE.g);
  if (GUIDE.pid === pid && GUIDE.p) return GUIDE.p;
  if (GUIDE.pid === pid && !GUIDE.g && Date.now() - GUIDE.failAt < 30 * 60000) return Promise.resolve(null);   // no guide there: don't hammer it
  GUIDE.pid = pid; GUIDE.g = null;
  const now = Date.now() / 1000, t0 = Date.now();
  GUIDE.p = H.text(guideUrl()).then(txt => {
    const g = HKEPG.parse(txt, now - 3 * 3600, now + 36 * 3600);   // a day and a half: enough, and light on old TVs
    perfMark('epg', Date.now() - t0);
    GUIDE.src = S.profile.epgUrl ? 'link' : 'provider';
    if (!g.count) { GUIDE.failAt = Date.now(); return null; }
    GUIDE.g = g; GUIDE.at = Date.now(); return g;
  }, e => { GUIDE.failAt = Date.now(); logError('EPG', e); return null; }).finally(() => { GUIDE.p = null; });
  return GUIDE.p;
}
async function feedEpg(chs) {
  const out = {}, g = await guideFull();
  if (g) { chs.forEach(c => { out[c.id] = HKEPG.lookup(g, c); }); }
  // channels the file does not cover (or no file at all): the provider's per-channel guide, a few at a time
  const now = Date.now() / 1000, need = chs.filter(c => !(out[c.id] || []).length);
  const todo = need.filter(c => { const k = S.epgCache[c.id]; if (k && now - k.at < 1800) { out[c.id] = k.list; return false; } return true; });
  // providers that answer get_short_epg with nothing for everything: stop after 12 empty channels (checked again in 30 min)
  const noShort = GUIDE.noShort && GUIDE.noShort.pid === S.profile.id && Date.now() - GUIDE.noShort.at < 30 * 60000;
  if (todo.length && !noShort) {
    let hits = 0;
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(todo.slice(i, i + 6).map(async c => { let list = []; try { list = await X.epg(c.id); } catch (e) {} if (list.length) hits++; S.epgCache[c.id] = { at: now, list }; out[c.id] = list; }));
      if (!hits && i + 6 >= 12) { GUIDE.noShort = { pid: S.profile.id, at: Date.now() }; break; }
    }
  }
  return out;
}
async function epgFor(it) {
  let list = []; try { list = await X.epg(it.id); } catch {}
  if (list.length) { if (window.HK_epg && HK_epg.save) try { HK_epg.save('epg:' + it.id, list); } catch (e) {} return list; }
  if (window.HK_epg && HK_epg.load) { try { const cached = await HK_epg.load('epg:' + it.id); if (cached && cached.length) return cached; } catch (e) {} }
  const g = await guideFull(); return g ? HKEPG.lookup(g, it) : [];
}

// ---- Guide (timeline grid) ----
const G = { cat: '', chans: [], epg: {}, start: 0, PX: 6, HOURS: 3 };
async function openGuide() {
  $('#empty').classList.add('hidden'); $('#count').textContent = '';
  setLoading(true);
  try {
    const cats = await X.categories('live');
    const favLive = favList().filter(f => f.type === 'live');
    S.categories = (favLive.length ? [{ id: '__fav', name: T('القنوات المفضلة') }] : []).concat(cats);
    const want = G.cat || S.prefs.guideCat;   // 5.9.2: remember the last guide category across restarts
    const first = want && S.categories.some(c => c.id === want) ? want : (S.categories[0] || {}).id;
    await guideCategory(first);
  } catch (e) { toast(T('تعذر تحميل دليل البرامج')); logError('Guide', e); } finally { setLoading(false); }
}
async function guideCategory(id) {
  if (id && S.prefs.guideCat !== id) { S.prefs.guideCat = id; H.store.set('prefs', S.prefs); }
  G.cat = id; S.categoryId = id; renderCategories();
  if (!G.start) guideNow();
  $('#guide').innerHTML = T('<div class="loader"><i></i><span>جاري تحميل دليل البرامج…</span></div>');
  setLoading(true);
  try {
    G.chans = id === '__fav' ? favList().filter(f => f.type === 'live') : (await X.media('live', id)).filter(i => !(S.parental.hideAdult && i.adult));
    G.chans = G.chans.slice(0, 150);
    G.epg = await feedEpg(G.chans);
    G.none = !G.chans.some(c => (G.epg[c.id] || []).length);
    renderGuide();
    const first = $('#guide .gp.now') || $('#guide .gp') || $('#g-link'); if (first && S.section === 'guide') Nav.set(first);
  } catch (e) { $('#guide').innerHTML = T('<div class="empty">تعذر تحميل القنوات</div>'); } finally { setLoading(false); }
}
function guideNow() { const n = Math.floor(Date.now() / 1000); G.start = n - (n % 1800); }
function renderGuide() {
  const W = G.HOURS * 60 * G.PX, a = G.start, b = a + G.HOURS * 3600, now = Date.now() / 1000;
  let ruler = ''; for (let t = a; t < b; t += 1800) ruler += `<span style="width:${30 * G.PX}px">${hhmm(t)}</span>`;
  const nowX = now >= a && now < b ? Math.round((now - a) / 60 * G.PX) : -1;
  let rows = '';
  // 5.13: nothing in this category has a guide → say why and where to add one, instead of a wall of empty rows
  if (G.none && G.chans.length) {
    $('#guide').innerHTML = `<div class="gnone">${ic('guide')}<b>${T('لا يتوفر دليل برامج لهذه القنوات')}</b><p class="muted">${S.profile.epgUrl ? T('رابط الدليل المضاف لا يحتوي على هذه القنوات.') : T('مزوّدك لا يرسل دليل برامج لهذه القنوات. إذا كان لديك رابط دليل (XMLTV) من مزوّدك فأضفه من إعدادات الحساب.')}</p><button class="primary" id="g-link">${T('إضافة رابط دليل')}</button></div>`;
    paintIcons(); $('#g-link').onclick = epgLinkMenu; Nav.set($('#g-link')); return;
  }
  G.chans.forEach((c, ci) => {
    const list = (G.epg[c.id] || []).filter(e => e.end > a && e.start < b);
    let cells = '';
    if (!list.length) cells = `<button class="gp empty" data-c="${ci}" data-p="-1" style="width:${W - 4}px">${T('لا توجد بيانات')}</button>`;
    else list.forEach((e, pi) => {
      const x = Math.max(e.start, a), y = Math.min(e.end, b), w = Math.max(24, Math.round((y - x) / 60 * G.PX) - 4), off = Math.round((x - a) / 60 * G.PX);
      const cur = e.start <= now && now < e.end, rem = S.reminders.some(r => r.channelId === c.id && r.start === e.start);
      cells += `<button class="gp ${cur ? 'now' : ''} ${e.end <= now ? 'past' : ''}" data-c="${ci}" data-p="${(G.epg[c.id] || []).indexOf(e)}" style="${EN_UI ? 'left' : 'right'}:${off}px;width:${w}px"><b>${rem ? ic('bell') : ''}${esc(e.title)}</b><small>${hhmm(e.start)}</small></button>`;
    });
    rows += `<div class="grow"><div class="gch"><img src="${esc(c.imageUrl || 'icon.png')}" loading="lazy"><span>${esc(c.name)}</span></div><div class="gline" style="width:${W}px">${cells}</div></div>`;
  });
  $('#guide').innerHTML = `<div class="ghead"><button class="chip" id="g-prev" data-ic="prev">${T('السابق')}</button><button class="chip" id="g-now">${T('الآن')}</button><button class="chip" id="g-next" data-ic="next">${T('التالي')}</button><span class="muted">${localDate(a * 1000).toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span></div>
    <div class="gscroll"><div class="gruler"><div class="gch"></div><div class="gline" style="width:${W}px">${ruler}${nowX >= 0 ? `<i class="gnow" style="${EN_UI ? 'left' : 'right'}:${nowX}px"></i>` : ''}</div></div>${rows || T('<div class="empty">لا توجد قنوات</div>')}</div>`;
  paintIcons();
  $('#g-prev').onclick = () => { G.start -= 7200; renderGuide(); Nav.set($('#g-prev')); };
  $('#g-next').onclick = () => { G.start += 7200; renderGuide(); Nav.set($('#g-next')); };
  $('#g-now').onclick = () => { guideNow(); renderGuide(); Nav.set($('#guide .gp.now') || $('#g-now')); };
}
$('#guide').addEventListener('click', e => {
  const b = e.target.closest('.gp'); if (!b) return;
  const c = G.chans[+b.dataset.c], p = +b.dataset.p, ev = p >= 0 ? (G.epg[c.id] || [])[p] : null, now = Date.now() / 1000;
  if (ev && ev.start > now) return reminderDialog(c, ev);
  S.channelQueue = G.chans; S.channelIndex = +b.dataset.c; play(c, { live: true });
});
$('#guide').addEventListener('error', e => { const img = e.target; if (img.tagName === 'IMG' && !img.dataset.fb) { img.dataset.fb = '1'; img.src = 'icon.png'; } }, true);

// ---- Reminders ----
function reminderDialog(c, ev) {
  const has = S.reminders.find(r => r.channelId === c.id && r.start === ev.start);
  const m = modal(`<h3>${esc(ev.title)}</h3><div class="muted">${esc(c.name)} — ${hhmm(ev.start)}</div>${ev.desc ? `<p class="muted">${esc(ev.desc)}</p>` : ''}<div class="btns"><button class="primary" id="rm-ok" data-ic="bell">${has ? T('إلغاء التذكير') : T('ذكّرني')}</button><button class="chip" id="rm-c">${T('إلغاء')}</button></div>`);
  paintIcons();
  m.querySelector('#rm-ok').onclick = () => {
    if (has) S.reminders = S.reminders.filter(r => r !== has);
    else S.reminders.push({ id: c.id + ':' + ev.start, channelId: c.id, channel: c, channelName: c.name, title: ev.title, start: ev.start });
    H.store.set('reminders', S.reminders); closeModal(); if (S.section === 'matches') renderMatches(); else if (S.section === 'guide') renderGuide(); toast(has ? T('تم إلغاء التذكير') : T('سيتم تذكيرك قبل البداية بدقيقة'));
  };
  m.querySelector('#rm-c').onclick = closeModal;
}
// "على beIN 1" for a channel (guide) reminder, the league for a match reminder (no channel).
const remWhere = r => r.channel ? T('على') + ' ' + r.channelName : r.channelName;
const matchRemId = m => 'm:' + m.id;
const matchRem = m => ({ id: matchRemId(m), channelId: 0, channelName: fxLeague(m), title: fxHome(m) + ' × ' + fxAway(m), start: m.start });
const hasMatchRem = m => S.reminders.some(r => r.id === matchRemId(m));
const canRemind = (m, now) => m.status === 'pre' && m.start > now + 60;
function reminderLoop() {
  const now = Date.now() / 1000;
  const due = S.reminders.filter(r => !r.fired && r.start - 60 <= now && now < r.start + 3600);
  S.reminders = S.reminders.filter(r => r.start + 3600 > now);
  if (!due.length) return H.store.set('reminders', S.reminders);
  const r = due[0]; r.fired = true; H.store.set('reminders', S.reminders);
  const m = modal(`<h3>${T('بدأ الآن:')} ${esc(r.title)}</h3><div class="muted">${esc(remWhere(r))}</div><div class="btns">${r.channel ? `<button class="primary" id="rn-go" data-ic="play">${T('مشاهدة')}</button><button class="chip" id="rn-later">${T('لاحقاً')}</button>` : `<button class="primary" id="rn-later">${T('تمام')}</button>`}</div>`);
  paintIcons();
  const go = m.querySelector('#rn-go'); if (go) go.onclick = () => { closeModal(); S.channelQueue = [r.channel]; S.channelIndex = 0; play(r.channel, { live: true }); };
  m.querySelector('#rn-later').onclick = closeModal;
}

// ---- History ----
function addHistory(it) {
  if (!it || !it.id) return; const k = key(it); if (it.type === 'live') noteChannel(it);
  const clean = Object.assign({}, it); delete clean._shelf; delete clean.percent;
  S.history = [{ item: clean, at: Date.now() }].concat(S.history.filter(h => key(h.item) !== k)).slice(0, 100); H.store.set('history', S.history);
}
function ago(ms) {
  const d = (Date.now() - ms) / 60000; if (d < 1) return T('الآن'); if (EN_UI) { if (d < 60) return Math.floor(d) + ' min ago'; if (d < 1440) return Math.floor(d / 60) + ' h ago'; } else { if (d < 60) return `منذ ${Math.floor(d)} د`; if (d < 1440) return `منذ ${Math.floor(d / 60)} س`; }
  if (d < 2880) return T('أمس'); return localDate(ms).toLocaleDateString(LOC, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function historyMenu() {
  const list = S.history.filter(h => kidsItem(h.item));
  const m = modal(`<h3>${T('سجل المشاهدة')}</h3>${list.length ? list.map((h, i) => `<button class="opt hist" data-i="${i}"><span>${esc(h.item.name)}</span><small class="muted">${ago(h.at)}</small></button>`).join('') : T('<div class="muted">لم تشاهد أي شيء بعد</div>')}<div class="btns">${list.length ? T('<button class="chip" id="h-clear">مسح السجل</button>') : ''}<button class="chip" id="h-close">${T('إغلاق')}</button></div>`);
  m.querySelectorAll('.hist').forEach(b => b.onclick = () => { const it = list[+b.dataset.i].item; closeModal(); if (it.type === 'live') { S.channelQueue = [it]; S.channelIndex = 0; play(it, { live: true }); } else if (it.type === 'episode') play(it, { seriesId: it.seriesId }); else openDetails(it); });
  m.querySelector('#h-clear')?.addEventListener('click', () => { S.history = []; H.store.set('history', []); closeModal(); toast(T('تم مسح السجل')); if (S.section === 'home') renderHome(); });
  m.querySelector('#h-close').onclick = closeModal;
}

// ---- Kids mode ----
function setKids(on) {
  // 6.0 F18: refuse entering kids mode once today's daily limit is used up — must wait for tomorrow's reset
  if (on && window.HK_family && HK_family.kidsLimit.expired()) { closeModal(); return toast(T('انتهى وقت اليوم المسموح به للأطفال')); }
  const apply = () => { S.parental.kids = on; save('parental'); S.catalog = {}; S.catNames = {}; closeModal(); openHome(); toast(on ? T('تم تفعيل وضع الأطفال') : T('تم إيقاف وضع الأطفال')); };
  if (on) return apply();
  S.unlocked = false; requirePin(apply);
}
// 6.0 F18: kids daily limit enforcement while playing in kids mode — ticks every second the video plays,
// shows the PIN dialog (like the other kids settings) once the budget for today runs out.
setInterval(() => { if (S.parental.kids && visible('player') && !video.paused && window.HK_family) {
  HK_family.kidsLimit.tick(1000);
  if (HK_family.kidsLimit.expired() && !S.kidsLimitDialogOpen) { S.kidsLimitDialogOpen = true; video.pause(); const m = modal(`<h3>${T('انتهى وقت اليوم')}</h3><p class="muted">${T('انتهى الوقت اليومي المسموح به للأطفال. أدخل رمز PIN لمتابعة المشاهدة.')}</p><input id="kl-pin" type="password" placeholder="${T('أدخل رمز PIN')}" inputmode="numeric"><div class="btns"><button class="primary" id="kl-ok">${T('فتح')}</button><button class="chip" id="kl-close">${T('إغلاق المشغّل')}</button></div>`);
    m.querySelector('#kl-ok').onclick = () => { if (m.querySelector('#kl-pin').value === S.parental.pin) { S.kidsLimitDialogOpen = false; closeModal(); video.play().catch(() => {}); } else toast(T('رمز PIN غير صحيح')); };
    m.querySelector('#kl-close').onclick = () => { S.kidsLimitDialogOpen = false; closeModal(); closePlayer(); };
  }
} }, 1000);

// ---- Player: options (speed / aspect / sleep / tracks), skip intro, up-next ----
let sleepT = null, sleepAt = 0, sleepMin = 0;
$('#p-more').onclick = () => {
  const sp = [0.5, 0.75, 1, 1.25, 1.5, 2], asp = [['contain', T('ملاءمة')], ['cover', T('ملء الشاشة')], ['fill', T('تمديد')]], sl = [0, 15, 30, 60, 90];
  const left = sleepAt ? Math.max(1, Math.round((sleepAt - Date.now()) / 60000)) : 0;
  const m = modal(`${playerTabs('more')}
    ${ctx.item && ctx.item.variants ? `<div class="section">${T('الجودة')}</div><div class="seg wrap"><button class="opt ${qPref(ctx.item) ? '' : 'on'}" data-q="">${T('تلقائي')}${qPref(ctx.item) ? '' : ' — ' + esc(ctx.item.variants[ctx.item.vi].label)}</button>${ctx.item.variants.map((v, i) => `<button class="opt ${qPref(ctx.item) === v.label ? 'on' : ''}" data-q="${i}">${esc(v.label)}</button>`).join('')}</div>` : ''}
    ${ctx.live ? '' : `<div class="section">${T('السرعة')}</div><div class="seg ltr">${sp.map(v => `<button class="opt ${video.playbackRate === v ? 'on' : ''}" data-sp="${v}"><bdi dir="ltr">${v}×</bdi></button>`).join('')}</div>`}
    <div class="section">${T('أبعاد الصورة')}</div><div class="seg">${asp.map(([v, l]) => `<button class="opt ${(S.prefs.aspect || 'contain') === v ? 'on' : ''}" data-as="${v}">${l}</button>`).join('')}</div>
    <div class="section">${T('مؤقت النوم')}${left ? ` ${T('— متبقٍ')} ${left} ${T('دقيقة')}` : ''}</div><div class="seg">${sl.map(v => `<button class="opt ${(sleepAt ? v === sleepMin : !v) && sleepMin !== 'eoe' ? 'on' : ''}" data-sl="${v}">${v ? v : T('إيقاف')}</button>`).join('')}${!ctx.live && window.HK_family ? `<button class="opt ${sleepMin === 'eoe' ? 'on' : ''}" data-sl="eoe">${T('لآخر الحلقة')}</button>` : ''}</div>
    <button class="opt" id="o-tracks">${ic('subtitles')} ${T('الصوت والترجمة')}</button>`);
  m.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { closeModal(); setQuality(ctx.item, b.dataset.q === '' ? null : +b.dataset.q); });
  m.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { video.defaultPlaybackRate = video.playbackRate = +b.dataset.sp; closeModal(); flash(b.dataset.sp + '×'); });
  m.querySelectorAll('[data-as]').forEach(b => b.onclick = () => { S.prefs.aspect = b.dataset.as; H.store.set('prefs', S.prefs); video.style.objectFit = b.dataset.as; closeModal(); flash(b.textContent); });
  m.querySelectorAll('[data-sl]').forEach(b => b.onclick = () => { closeModal(); if (b.dataset.sl === 'eoe') setSleepEndOfEpisode(); else setSleep(+b.dataset.sl); });
  m.querySelector('#o-tracks').onclick = () => { closeModal(); $('#p-tracks').click(); };
  wirePlayerTabs(m);
};
// 7.0.6: player menus are one side sheet with two tabs (audio & subtitles / options); the video stays visible
function playerTabs(on) {
  return `<div class="p-tabs"><button class="opt ${on === 'tracks' ? 'on' : ''}" data-ptab="tracks">${ic('subtitles')} ${T('الصوت والترجمة')}</button><button class="opt ${on === 'more' ? 'on' : ''}" data-ptab="more">${ic('filter')} ${T('خيارات')}</button></div>`;
}
function wirePlayerTabs(m) {
  if (!visible('player')) return;
  $('#modal').classList.add('p-sheet');
  m.querySelectorAll('[data-ptab]').forEach(b => b.onclick = () => { if (b.classList.contains('on')) return; b.dataset.ptab === 'tracks' ? subsMenu() : $('#p-more').click(); });
}
// 6.0 F18: sleep "to end of episode" (PLAN «لآخر الحلقة», VOD only) — HK_family.armEndOfEpisode
let sleepDisarm = null;
function setSleepEndOfEpisode() {
  clearTimeout(sleepT); sleepT = null; sleepAt = 0; if (sleepDisarm) { sleepDisarm(); sleepDisarm = null; }
  if (!window.HK_family || ctx.live) return;
  sleepMin = 'eoe';
  sleepDisarm = HK_family.armEndOfEpisode(video, () => { sleepMin = 0; sleepDisarm = null; if (visible('player')) closePlayer(); toast(T('تم إيقاف التشغيل بواسطة مؤقت النوم'), 5000); });
  toast(T('سيتوقف التشغيل في نهاية هذه الحلقة'));
}
function setSleep(min) {
  if (sleepDisarm) { sleepDisarm(); sleepDisarm = null; }
  clearTimeout(sleepT); sleepT = null; sleepAt = 0; sleepMin = min;
  if (!min) return toast(T('تم إيقاف مؤقت النوم'));
  sleepAt = Date.now() + min * 60000;
  sleepT = setTimeout(() => { sleepAt = 0; sleepMin = 0; if (visible('player')) { video.pause(); closePlayer(); } toast(T('تم إيقاف التشغيل بواسطة مؤقت النوم'), 5000); }, min * 60000);
  toast(`${T('سيتوقف التشغيل بعد')} ${min} ${T('دقيقة')}`);
}
function updateSkip() {
  const show = !!ctx.seriesId && !ctx.skipUsed && video.currentTime >= 5 && video.currentTime < 300 && (!video.duration || video.duration > 400);
  $('#p-skip').classList.toggle('hidden', !show);
}
$('#p-skip').onclick = () => { ctx.skipUsed = true; $('#p-skip').classList.add('hidden'); seekBy(85); commitSeek(); };
let upT = null;
function showUpNext() {
  const i = S.epList.findIndex(e => e.id === ctx.item.id); if (i < 0 || i + 1 >= S.epList.length) return;
  const nx = S.epList[i + 1]; let n = 10; ctx.upShown = true;
  $('#p-upnext-title').textContent = nx.name; $('#p-upnext-n').textContent = n; $('#p-upnext').classList.remove('hidden'); paintIcons();
  Nav.set($('#p-upnext-go')); ctrlMode = true;
  clearInterval(upT); upT = setInterval(() => { n--; $('#p-upnext-n').textContent = n; if (n <= 0) { hideUpNext(); nextEpisode(); } }, 1000);
}
function hideUpNext() { clearInterval(upT); upT = null; const el = $('#p-upnext'); if (el) el.classList.add('hidden'); }
$('#p-upnext-go').onclick = () => { hideUpNext(); nextEpisode(); };
$('#p-upnext-cancel').onclick = () => { hideUpNext(); ctrlMode = false; };

// ---- Settings / errors / update ----
const FX_OPTS = [['auto', 'تلقائي'], ['full', 'كاملة'], ['lite', 'خفيفة'], ['off', 'بدون']];
const fxLabel = () => { const v = S.prefs.fx || 'auto', o = FX_OPTS.find(x => x[0] === v) || FX_OPTS[0]; return T(o[1]); };
const APP_VERSION = '7.0.13'; // keep in sync with package.json (scripts/bump.js)
$('#settings-btn').onclick = () => {
  const st = [['home', T('الرئيسية')], ['live', T('مباشر')], ['movies', T('أفلام')], ['series', T('مسلسلات')]];
  const prayerS = window.HK_prayer ? HK_prayer.settings() : null;
  const kidsLim = window.HK_family ? HK_family.kidsLimit.get() : null;
  const seg = (cls, items) => `<div class="seg s-seg ${cls || ''}">${items}</div>`;
  const row = (label, ctl, icon) => `<div class="s-row"><div class="s-lbl">${icon ? ic(icon) : ''}<span>${label}</span></div><div class="s-ctl">${ctl}</div></div>`;
  const item = (id, icon, label, val) => `<button class="opt s-item" id="${id}">${ic(icon)}<span class="s-it">${label}</span>${val ? `<small class="muted s-val">${val}</small>` : ''}<span class="s-chev">${ic('chev')}</span></button>`;
  const group = (title, body) => `<section class="s-group"><div class="s-gh">${title}</div>${body}</section>`;
  const m = modal(`<h3 class="s-title">${T('الإعدادات')}</h3>
    ${group(T('العرض'),
      row(T('القسم الافتراضي'), seg('', st.map(([v, l]) => `<button class="opt ${S.prefs.start === v ? 'on' : ''}" data-st="${v}">${l}</button>`).join('')), 'home') +
      row(EN_UI ? 'App language · لغة التطبيق' : 'لغة التطبيق · App language', seg('', `<button class="opt ${EN_UI ? '' : 'on'}" data-lang="ar">العربية</button><button class="opt ${EN_UI ? 'on' : ''}" data-lang="en">English</button>`), 'lang') +
      row(T('حجم الواجهة'), seg('', [[0.85, T('صغير')], [1, T('عادي')], [1.15, T('كبير')], [1.3, T('كبير جداً')]].map(([v, l]) => `<button class="opt ${(+S.prefs.uiScale || 1) === v ? 'on' : ''}" data-ui="${v}">${l}</button>`).join('')), 'monitor') +
      row(T('المظهر: الوضع'), seg('', [['dark', T('داكن')], ['light', T('فاتح')], ['system', T('حسب الجهاز')]].map(([v, l]) => `<button class="opt ${(window.HK_theme ? HK_theme.get() : 'dark') === v ? 'on' : ''}" data-theme-mode="${v}">${l}</button>`).join('')), 'moon') +
      row(T('المظهر'), `<div class="hk6-accents">${(window.HK_accent ? HK_accent.list() : []).map(n => `<button class="hk6-accent-sw ${HK_accent.get() === n ? 'on' : ''}" data-accent="${n}" title="${n}" style="background:${{ amber: '#FFB224', teal: '#46D8D1', gold: '#E8B339', blue: '#4D9FFF', wine: '#E2566E', green: '#4CD97B' }[n]}"></button>`).join('')}</div>`, 'palette') +
      `<button class="opt s-item s-toggle ${window.HK_family && HK_family.senior() ? 'on' : ''}" id="s-senior">${ic('user')}<span class="s-it">${T('وضع كبار السن')}</span><span class="s-sw"><i></i></span></button>` +
      `<button class="opt s-item" id="s-fx">${ic('motion')}<span class="s-it">${T('الحركة')}</span><small class="s-val"><b id="s-fx-v">${fxLabel()}</b></small><span class="s-chev">${ic('chev')}</span></button>`)}
    ${group(T('التشغيل'),
      row(T('دمج نسخ القنوات'), seg('', `<button class="opt ${S.prefs.merge ? 'on' : ''}" data-mg="1">${T('تشغيل')}</button><button class="opt ${S.prefs.merge ? '' : 'on'}" data-mg="0">${T('إيقاف')}</button>`), 'live') +
      row(T('شاشة التوقف'), seg('', [[0, T('إيقاف')], [2, T('2 د')], [5, T('5 د')], [10, T('10 د')], [30, T('30 د')]].map(([v, l]) => `<button class="opt ${SAVER_MIN() === v ? 'on' : ''}" data-sv="${v}">${l}</button>`).join('')), 'clock') +
      (window.HK_remote ? `<button class="opt s-item" id="s-remote-start">${ic('phone')}<span class="s-it">${T('ريموت الموبايل')}</span><small class="muted s-val">${T('بدء الربط')}</small><span class="s-chev">${ic('chev')}</span></button>` : ''))}
    ${window.HK_family || window.HK_prayer ? group(T('العائلة والصلاة'),
      (window.HK_family ? row(T('الوقت اليومي للأطفال'), seg('s-6', [0, 30, 60, 90, 120, 180].map(v => `<button class="opt ${kidsLim.minutes === v ? 'on' : ''}" data-kids="${v}">${v ? v + T(' د') : T('إيقاف')}</button>`).join('')), 'kids') : '') +
      (window.HK_prayer ? row(T('مواعيد الصلاة'), seg('', `<button class="opt ${prayerS.on ? 'on' : ''}" id="s-prayer-on">${prayerS.on ? T('مُفعّل') : T('إيقاف')}</button><button class="opt" id="s-prayer-city">${T('المدينة')}: ${(prayerS.city && prayerS.city.name) || T('اختر')}</button><button class="opt" id="s-prayer-adhan">${T('الأذان')}: ${{ off: T('إيقاف'), beep: T('تنبيه صوتي'), voice: T('تنبيه صوتي') }[prayerS.adhan] || T('إيقاف')}</button>`), 'bell') : '')) : ''}
    ${group(T('الحساب والبيانات'),
      item('s-lic', 'card', T('الاشتراك'), licLine()) +
      item('s-sync', 'refresh', T('مزامنة الآن'), S.lastSync ? ago(S.lastSync) : '') +
      item('s-update', 'download', T('التحقق من التحديثات'), APP_VERSION) +
      item('s-history', 'history', T('سجل المشاهدة'), '') +
      item('s-cache', 'trash', T('مسح الذاكرة المؤقتة'), ''))}
    ${group(T('المساعدة'),
      (window.SOHBATNA_PLATFORM === 'electron' && !TV ? item('s-keys', 'keyboard', T('اختصارات الكيبورد'), 'F1') : '') +
      item('s-errors', 'bug', T('سجل الأخطاء'), '') +
      item('s-oss', 'doc', T('تراخيص المصادر المفتوحة'), ''))}
    <div class="muted about s-about">${S.acct ? expiryText() + '<br>' : ''}${T('عن التطبيق: صحبتنا')} ${APP_VERSION}</div>`);
  m.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { S.prefs.start = b.dataset.st; H.store.set('prefs', S.prefs); m.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b)); });
  m.querySelectorAll('[data-mg]').forEach(b => b.onclick = () => { const on = b.dataset.mg === '1'; if (on === S.prefs.merge) return; S.prefs.merge = on; H.store.set('prefs', S.prefs); S.catalog = {}; S.catNames = {}; S.rawLive = null; closeModal(); toast(on ? T('تم دمج نسخ القنوات') : T('تم إيقاف الدمج')); if (S.section === 'live' || S.section === 'guide') switchSection(S.section); });
  m.querySelector('#s-cache').onclick = () => { for (const k in APIC) delete APIC[k]; S.meta = {}; H.store.set('meta', {}); S.rawLive = null; S.catalog = {}; S.epgCache = {}; S.catNames = {}; S.hero = null; closeModal(); toast(T('تم مسح الذاكرة المؤقتة')); };
  m.classList.add('s-compact', 's-dialog');   // 7.0.6: grouped settings dialog (wider; scrolls inside)
  m.querySelector('#s-errors').onclick = errorsMenu;
  m.querySelectorAll('[data-ui]').forEach(b => b.onclick = () => { S.prefs.uiScale = +b.dataset.ui; H.store.set('prefs', S.prefs); m.querySelectorAll('[data-ui]').forEach(x => x.classList.toggle('on', x === b)); HK_applyScale(S.prefs.uiScale); setTimeout(fitHeader, 150); });
  // 5.14: one button cycles auto → full → light → none (a whole row made the dialog scroll on the TV)
  m.querySelector('#s-fx').onclick = () => { const o = FX_OPTS.map(x => x[0]), i = o.indexOf(S.prefs.fx || 'auto'); S.prefs.fx = o[(i + 1) % o.length]; H.store.set('prefs', S.prefs); HK_fx(S.prefs.fx); $('#s-fx-v').textContent = fxLabel(); };
  m.querySelectorAll('[data-sv]').forEach(b => b.onclick = () => { S.prefs.saver = +b.dataset.sv; H.store.set('prefs', S.prefs); m.querySelectorAll('[data-sv]').forEach(x => x.classList.toggle('on', x === b)); saverArm(); });
  const sk = m.querySelector('#s-keys'); if (sk) sk.onclick = shortcutsHelp;
  m.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { if ((b.dataset.lang === 'en') === EN_UI) return; I18N.setLang(b.dataset.lang); S.prefs.lang = b.dataset.lang; H.store.set('prefs', S.prefs); M6.fx = null; location.reload(); });
  m.querySelector('#s-sync').onclick = async () => { closeModal(); toast(T('جاري المزامنة…')); const ok = await syncNow(); toast(ok ? T('تمت المزامنة') : T('تعذرت المزامنة')); };
  m.querySelector('#s-update').onclick = () => { closeModal(); checkUpdate(true); };
  m.querySelector('#s-history').onclick = historyMenu;
  m.querySelector('#s-oss').onclick = ossMenu;
  m.querySelector('#s-lic').onclick = licMenu;
  // ---- 6.0 F23 appearance ----
  m.querySelectorAll('[data-accent]').forEach(b => b.onclick = () => { HK_accent.set(b.dataset.accent); m.querySelectorAll('[data-accent]').forEach(x => x.classList.toggle('on', x === b)); });
  // ---- 7.0 appearance mode (dark/light/system) ----
  m.querySelectorAll('[data-theme-mode]').forEach(b => b.onclick = () => { if (window.HK_theme) HK_theme.set(b.dataset.themeMode); m.querySelectorAll('[data-theme-mode]').forEach(x => x.classList.toggle('on', x === b)); });
  const sSenior = m.querySelector('#s-senior'); if (sSenior) sSenior.onclick = () => {
    const on = !HK_family.senior(); HK_family.senior(on); sSenior.classList.toggle('on', on);
    // F17: senior mode = existing interface-size at max + motion off, restored to the previous prefs when switched off
    if (on) { S.prefs._preSeniorUi = S.prefs.uiScale; S.prefs._preSeniorFx = S.prefs.fx; S.prefs.uiScale = 1.3; S.prefs.fx = 'off'; }
    else { S.prefs.uiScale = S.prefs._preSeniorUi || 1; S.prefs.fx = S.prefs._preSeniorFx || 'auto'; }
    H.store.set('prefs', S.prefs); HK_applyScale(S.prefs.uiScale); HK_fx(S.prefs.fx); setTimeout(fitHeader, 150);
  };
  // ---- 6.0 F21 prayer settings ----
  const sPrayerOn = m.querySelector('#s-prayer-on'); if (sPrayerOn) sPrayerOn.onclick = () => { const s = HK_prayer.settings(); const on = !s.on; if (on && !s.city) return toast(T('اختر المدينة أولاً')); HK_prayer.save({ on }); sPrayerOn.classList.toggle('on', on); sPrayerOn.textContent = on ? T('مُفعّل') : T('إيقاف'); hkPrayerBoot(); };
  const sPrayerCity = m.querySelector('#s-prayer-city'); if (sPrayerCity) sPrayerCity.onclick = () => prayerCityMenu(() => { closeModal(); $('#settings-btn').click(); });
  const sPrayerAdhan = m.querySelector('#s-prayer-adhan'); if (sPrayerAdhan) sPrayerAdhan.onclick = () => { const order = ['off', 'beep']; /* 6.0: no licensed adhan voice shipped — no 'soon' option */ const s = HK_prayer.settings(); const n = order[(order.indexOf(s.adhan) + 1) % order.length]; HK_prayer.save({ adhan: n }); sPrayerAdhan.textContent = T('الأذان') + ': ' + ({ off: T('إيقاف'), beep: T('تنبيه صوتي'), voice: T('تنبيه صوتي') }[n]); };
  // ---- 6.0 F21 phone remote ----
  const sRemote = m.querySelector('#s-remote-start'); if (sRemote) sRemote.onclick = () => phoneRemoteMenu();
  // ---- 6.0 F18 kids daily limit (PIN-protected, like the other kids settings) ----
  m.querySelectorAll('[data-kids]').forEach(b => b.onclick = () => requirePin(() => { HK_family.kidsLimit.set(+b.dataset.kids); m.querySelectorAll('[data-kids]').forEach(x => x.classList.toggle('on', x === b)); toast(T('تم الحفظ')); }));
};
// 5.13.2: open-source notices (licenses.js; full texts on the website). Same list as Android OssLicenses.java.
function ossMenu() {
  const m = modal(`<h3>${T('تراخيص المصادر المفتوحة')}</h3>
    <div class="muted">${T('يستخدم هذا التطبيق المكونات مفتوحة المصدر التالية وفق تراخيصها:')}</div>
    <div class="osslist">${(window.OSS || []).map(o => `<div><b>${esc(o.name)}</b> · <span class="accent">${esc(o.licence)}</span><br><span class="muted">${esc(o.owner)}</span></div>`).join('')}</div>
    <div class="muted">${T('النصوص الكاملة للتراخيص:')} <span dir="ltr">${esc(window.OSS_URL || '')}</span></div>
    <div class="btns"><button class="chip" id="o-close">${T('إغلاق')}</button></div>`);
  m.querySelector('#o-close').onclick = closeModal;
}
function errorsMenu() {
  const p = S.perf, f = v => v != null ? v + T(' ث') : '—';
  const m = modal(`<h3>${T('سجل الأخطاء')}</h3><div class="muted">${T('الرئيسية:')} ${f(p.home)} ${T('· تغيير القناة:')} ${f(p.zap)} ${T('· التقديم:')} ${f(p.seek)}</div>
    <div class="errlist">${S.errors.length ? S.errors.map(e => `<div><span class="muted">${localDate(e.at).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}</span>  ${esc(e.where)}: ${esc(e.msg)}</div>`).join('') : T('<div class="muted">لا توجد أخطاء</div>')}</div>
    <div class="btns"><button class="chip" id="e-clear">${T('مسح')}</button><button class="chip" id="e-close">${T('إغلاق')}</button></div>`);
  m.querySelector('#e-clear').onclick = () => { S.errors = []; H.store.set('errors', []); errorsMenu(); };
  m.querySelector('#e-close').onclick = closeModal;
}
const vcmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
// 5.12.3 forced update: minVersion from /api/v1/version (admin → Releases). Below it the update window cannot be
// closed (Back exits the app, play() is refused) until the app is updated. Same rule as Android Update.java.
const mustUpdate = j => !!(j && j.minVersion && /^\d+\.\d+\.\d+$/.test(j.minVersion) && vcmp(APP_VERSION, j.minVersion) < 0);
function updateWindow(j) {
  const forced = mustUpdate(j);
  const url = j[window.SOHBATNA_PLATFORM === 'electron' ? 'windows' : window.SOHBATNA_PLATFORM === 'webos' ? 'webos' : 'windows'] || '';
  const notes = EN_UI && j.notesEn ? j.notesEn : j.notes;
  if (forced) { S.updLock = j; if (visible('player')) closePlayer(); }
  // TVs (LG webOS, Samsung Tizen): the app is sideloaded from a PC/phone, so nothing can be downloaded on the TV itself —
  // tell the customer where the new file is and that it installs the same way as the first time
  const sideTv = window.SOHBATNA_PLATFORM === 'webos' || window.SOHBATNA_PLATFORM === 'tizen';
  const tvHost = window.SOHBATNA_PLATFORM === 'tizen' ? 'sohbatna.com/guides/samsung' : 'sohbatna.com/lg';
  const dl = url && !sideTv ? T('<button class="primary" id="u-dl">تحميل</button>')
    : sideTv ? `<span class="muted">${T('حمّل النسخة الجديدة من الموبايل أو الكمبيوتر من')} <b dir="ltr">${tvHost}</b> ${T('وثبّتها بنفس طريقة التثبيت الأولى.')}</span>`
    : `<span class="muted">${T('اطلب التحديث من المطوّر')}</span>`;
  const m = modal(`<h3>${T('نسخة جديدة')} ${esc(j.version)} ${T('متاحة')}</h3>${forced ? `<p>${T('يجب تحديث التطبيق للاستمرار في استخدامه.')}</p>` : ''}<p class="muted">${esc(notes || '')}</p><div class="btns">${dl}${forced ? (TV ? '' : `<button class="chip" id="u-x">${T('خروج')}</button>`) : `<button class="chip" id="u-c">${T('إغلاق')}</button>`}</div>`);
  m.querySelector('#u-dl')?.addEventListener('click', () => { H.openExternal(url); if (!forced) closeModal(); });
  m.querySelector('#u-c')?.addEventListener('click', closeModal);
  m.querySelector('#u-x')?.addEventListener('click', () => window.close());   // Electron: last window closed → app quits (main.js)
}
async function checkUpdate(manual, auto) {
  const daily = !auto || Date.now() - (S.prefs.lastUpdateCheck || 0) > 24 * 3600 * 1000;   // optional notice: once a day
  if (daily) { S.prefs.lastUpdateCheck = Date.now(); H.store.set('prefs', S.prefs); }
  try {
    // 5.12: the Laravel API first; n8n's hooksha-version stays as the fallback (and for apps <= 5.11)
    const j = await (await api('version')).json(); if (!j || !j.version || j.version === '0.0.0') throw new Error('no version');
    if (vcmp(j.version, APP_VERSION) <= 0) { S.updLock = null; if (manual) toast(`${T('أنت على آخر نسخة (')}${APP_VERSION})`); return; }
    if (mustUpdate(j) || daily) updateWindow(j);
  } catch (e) { logError('Update', e); if (manual) toast(T('تعذر التحقق من التحديثات')); }
}


// =====================================================================================
// 5.4 — channel merge + quality (merge.js; Android: ChannelMerge.java)
// =====================================================================================
S.bw = 4; // auto-mode bandwidth cap in Mbps; lowered after repeated buffering, reset on app start
X.rawMediaOrig = X.rawMedia;
X.rawMedia = function (sec, catId) { return sec === 'live' && !catId && S.prefs.merge ? (S.rawLive && Date.now() - S.rawLive.at < 30 * 60 * 1000 ? Promise.resolve(S.rawLive.items) : X.rawMediaOrig(sec, catId).then(items => { S.rawLive = { at: Date.now(), items }; return items; })) : X.rawMediaOrig(sec, catId); };
// Items keep their RAW server category ids in .cats, so the filter works whether or not the
// merged category list (S.liveCatMap) was loaded first; a merged category id is "421,1179,…".
function mergedLive(all, catId) {
  if (!S.mergeCache || S.mergeCache.src !== all) {
    const items = [];
    for (const e of Merge.group(all).values()) {
      const f = e.first;
      if (e.variants.length === 1) { items.push(Object.assign({}, f, { cats: [f.categoryId] })); continue; }
      items.push(Object.assign({}, f, { name: e.name, variants: e.variants, cats: [...new Set(e.variants.map(v => v.categoryId))] }));
    }
    S.mergeCache = { src: all, items };
  }
  const items = S.mergeCache.items;
  if (!catId) return items;
  const want = new Set(String(catId).split(','));
  return items.filter(i => i.cats.some(c => want.has(c)));
}
const qPref = it => (S.prefs.quality || {})[it.name] || null;
function pickVariant(it) { return Merge.pick(it.variants, qPref(it), S.bw); }
function prepVariant(it) {
  if (!it || !it.variants) { ctx.failed = null; return; }
  it.vi = pickVariant(it); ctx.failed = new Set(); ctx.waits = [];
  showQuality(it);
}
function showQuality(it) {
  const n = S.channelQueue && S.channelQueue[S.channelIndex] === it ? (S.channelIndex + 1) + '  ' : '';
  $('#p-title').innerHTML = esc(n + it.name) + (it.variants ? ` <span class="qtag">${esc(it.variants[it.vi].label)}${qPref(it) ? '' : T(' · تلقائي')}</span>` : '');
}
function setQuality(it, i) {
  if (!it || !it.variants) return;
  S.prefs.quality = S.prefs.quality || {};
  if (i == null) { delete S.prefs.quality[it.name]; it.vi = pickVariant(it); } else { S.prefs.quality[it.name] = it.variants[i].label; it.vi = i; }
  H.store.set('prefs', S.prefs); ctx.failed = new Set(); ctx.waits = [];
  showQuality(it); flash(it.variants[it.vi].label);
  attach($('#video'), X.url(it), { live: true }).then(() => $('#video').play().catch(() => {}));
}
// playback failed: move to the next copy (lower first, then higher) instead of retrying the dead one
function failover(why) {
  const it = ctx.item; if (!ctx.live || !it || !it.variants || !ctx.failed) return false;
  ctx.failed.add(it.vi);
  const n = it.variants.length, order = [];
  for (let d = 1; d < n; d++) order.push(it.vi + d);
  for (let d = 1; d < n; d++) order.push(it.vi - d);
  const next = order.find(i => i >= 0 && i < n && !ctx.failed.has(i));
  if (next == null) return false;
  it.vi = next; showQuality(it); toast(T('تم التحويل إلى ') + it.variants[next].label);
  logError('تحويل جودة ' + it.name, why + ' → ' + it.variants[next].label);
  attach($('#video'), X.url(it), { live: true }).then(() => $('#video').play().catch(() => {}));
  return true;
}
// auto mode: 3 buffering stalls within 45 s -> step down one quality and remember the lower cap for this session
video.addEventListener('waiting', () => {
  const it = ctx.item; if (!ctx.live || !it || !it.variants || qPref(it) || !visible('player')) return;
  if (Date.now() - (ctx.t0 || 0) < 8000) return;                  // start-up buffering doesn't count
  const now = Date.now(); ctx.waits = (ctx.waits || []).filter(t => now - t < 45000); ctx.waits.push(now);
  if (ctx.waits.length < 3) return;
  const cur = it.variants[it.vi], lower = it.variants.findIndex((v, i) => i > it.vi && v.rate < cur.rate && !(ctx.failed && ctx.failed.has(i)));
  if (lower < 0) return;
  ctx.waits = []; S.bw = it.variants[lower].rate; it.vi = lower; showQuality(it); ctx.t0 = Date.now();
  toast(T('الإنترنت بطيء — تم التحويل إلى ') + it.variants[lower].label);
  attach($('#video'), X.url(it), { live: true }).then(() => $('#video').play().catch(() => {}));
});


// =====================================================================================
// 5.5 — cross-device sync (favourites + resume points) and movie/series info (5.13: /api/v1/sync and /api/v1/meta)
// =====================================================================================
function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
const syncUid = () => S.profile ? fnv(String(S.profile.server).trim().toLowerCase().replace(/\/+$/, '') + '|' + S.profile.username + '|' + S.profile.password) + fnv(S.profile.username + '#hooksha') : '';
const slim = it => { const o = {}; ['id', 'name', 'type', 'extension', 'imageUrl', 'categoryId', 'rating', 'seriesId', 'description', 'addedAt'].forEach(k => { if (it && it[k] != null && it[k] !== '') o[k] = it[k]; }); return o; };
let syncT = null, syncing = false;
function syncSoon() { clearTimeout(syncT); syncT = setTimeout(syncNow, 4000); }
async function syncNow() {
  if (!S.profile || syncing) return false; syncing = true;
  try {
    const favs = Object.keys(S.favorites).map(k => ({ k, at: (S.favStamp[k] || {}).at || 1, item: slim(S.favorites[k]) }))
      .concat(Object.keys(S.favStamp).filter(k => S.favStamp[k].del && !S.favorites[k]).map(k => ({ k, at: S.favStamp[k].at, del: true })));
    const prog = Object.keys(S.progress).map(k => Object.assign({ k, item: Object.assign(slim(S.progress[k].item), S.progress[k].seriesId ? { seriesId: S.progress[k].seriesId } : {}) }, { position: S.progress[k].position, duration: S.progress[k].duration, updatedAt: S.progress[k].updatedAt || 1 }))
      .concat(Object.keys(S.progDone).filter(k => !S.progress[k]).map(k => ({ k, updatedAt: S.progDone[k], done: true })));
    const later = Object.keys(S.later).map(k => ({ k, at: (S.laterStamp[k] || {}).at || 1, item: slim(S.later[k]) }))
      .concat(Object.keys(S.laterStamp).filter(k => S.laterStamp[k].del && !S.later[k]).map(k => ({ k, at: S.laterStamp[k].at, del: true })));
    const r = await feed('sync', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ uid: syncUid(), favs, prog, later, teams: teamsPayload(), favOrder: S.favOrder.at ? S.favOrder : undefined }, (window.HK_layout && typeof HK_layout.syncPayload === 'function') ? (function () { try { return { layout: HK_layout.syncPayload() }; } catch (e) { return {}; } })() : {})) });
    const j = await r.json(); if (!j || !Array.isArray(j.favs)) throw new Error(j && j.error || 'bad reply');
    if (j.layout && window.HK_layout && typeof HK_layout.mergeSync === 'function') { try { HK_layout.mergeSync(j.layout); } catch (e) {} }
    let changed = false;
    for (const f of j.favs) {
      const mine = (S.favStamp[f.k] || {}).at || 0; if (f.at <= mine) continue;
      S.favStamp[f.k] = f.del ? { at: f.at, del: true } : { at: f.at };
      if (f.del) { if (S.favorites[f.k]) { delete S.favorites[f.k]; changed = true; } } else if (f.item && f.item.id) { S.favorites[f.k] = f.item; changed = true; }
    }
    if (mergeTeams(j.teams)) changed = true;
    if (j.favOrder && j.favOrder.at > (S.favOrder.at || 0)) { S.favOrder = j.favOrder; save('favOrder'); changed = true; }
    for (const f of (j.later || [])) {
      const mine = (S.laterStamp[f.k] || {}).at || 0; if (f.at <= mine) continue;
      S.laterStamp[f.k] = f.del ? { at: f.at, del: true } : { at: f.at };
      if (f.del) { if (S.later[f.k]) { delete S.later[f.k]; changed = true; } } else if (f.item && f.item.id) { S.later[f.k] = f.item; changed = true; }
    }
    for (const p of j.prog) {
      const mine = Math.max((S.progress[p.k] || {}).updatedAt || 0, S.progDone[p.k] || 0); if (p.updatedAt <= mine) continue;
      if (ctx.item && key(ctx.item) === p.k) continue;               // never yank the item that is playing right now
      if (p.done) { if (S.progress[p.k]) { delete S.progress[p.k]; changed = true; } S.progDone[p.k] = p.updatedAt; }
      else if (p.item && p.item.id) { S.progress[p.k] = { position: p.position, duration: p.duration, updatedAt: p.updatedAt, item: p.item }; changed = true; }
    }
    ['favorites', 'favStamp', 'progress', 'progDone', 'later', 'laterStamp'].forEach(save);
    S.lastSync = Date.now();
    if (changed && visible('home') && (S.section === 'home' || S.section === 'favorites' || S.section === 'continue' || S.section === 'later')) { const c = $('#content'), st = c.scrollTop; switchSection(S.section).then(() => c.scrollTop = st).catch(() => {}); }
    return true;
  } catch (e) { logError('Sync', e); return false; } finally { syncing = false; }
}

async function fetchMeta(it) {
  const k = it.type + ':' + it.name; const c = S.meta[k];
  // 5.12.3: only openly licensed sources now — anything cached before (TMDB / IMDb / iTunes) is dropped, hits too
  if (c && c.v3 !== 1) delete S.meta[k];
  if (S.meta[k] && Date.now() - c.at < 14 * 864e5) return c.v;
  const r = await feed('meta', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ type: it.type === 'series' ? 'series' : 'movie', name: it.name }) });
  const v = await r.json();
  S.meta[k] = { at: Date.now(), v, v3: 1 }; const ks = Object.keys(S.meta); if (ks.length > 600) ks.sort((a, b) => S.meta[a].at - S.meta[b].at).slice(0, ks.length - 600).forEach(x => delete S.meta[x]);
  H.store.set('meta', S.meta); return v;
}
// Fill only what the server left empty; the server's own data always wins.
async function enrichDetails(it, d) {
  let m; try { m = await fetchMeta(it); } catch (e) { return; }
  if (!m || !m.found || S.current !== it || !visible('details')) return;
  const empty = sel => { const t = $(sel).textContent.trim(); return !t || t === T('لا توجد قصة متاحة') || t === T('تعذر تحميل التفاصيل') || t === T('جاري التحميل…'); };
  const lst = v => { v = unent(String(v)); return EN_UI ? v.replace(/،\s*/g, ', ') : v; };
  if (empty('#d-plot') && m.plot) $('#d-plot').textContent = unent(m.plot);
  if (!(d.genre) && m.genre) $('#d-genre').textContent = lst(m.genre);
  if (!(d.cast) && m.cast) $('#d-cast').textContent = T('الممثلون: ') + lst(m.cast);
  if (!(d.director) && m.director) $('#d-director').textContent = T('الإخراج: ') + lst(m.director);
  const meta = $('#d-meta').textContent;
  const add = [!d.year && m.year ? m.year : '', !prettyDur(d.duration) && m.runtime ? m.runtime.replace(/(\d+)\s*min/, (x, n) => prettyDur(String(n))) : '', !rating(d.rating) && m.rating ? '★ ' + (+m.rating).toFixed(1) + ' IMDb' : ''].filter(Boolean);
  if (add.length) $('#d-meta').textContent = [meta, ...add].filter(Boolean).join('  •  ');
  if (m.backdrop && !(d.backdrop)) $('#d-backdrop').style.backgroundImage = `url("${m.backdrop}")`;
  if (m.poster && !it.imageUrl) $('#d-poster').src = m.poster;
  $('#d-source').textContent = T('معلومات إضافية من ') + (m.source || T('الإنترنت'));
  const tb = $('#d-trailer'); tb.classList.toggle('hidden', !m.trailer); tb.onclick = () => H.openExternal('https://www.youtube.com/watch?v=' + m.trailer);
}

// =====================================================================================
// 5.6 — channel numbers + last channel, matches page, watch later, subscription expiry
// =====================================================================================
// ---- channel numbers: position in the full live list ("جميع القنوات" order, merged when merge is on) ----
function chanList() { return ((S.catalog.live || {}).items) || []; }
function chanNo(it) {
  const l = chanList(); if (!l.length || !it || it.type !== 'live') return 0;
  if (S.chanNoSrc !== l) { S.chanNoSrc = l; S.chanNoMap = new Map(l.map((c, i) => [c.id, i + 1])); }
  return S.chanNoMap.get(it.id) || 0;
}
const digitOf = e => { const k = e.keyCode; if (k >= 48 && k <= 57) return k - 48; if (k >= 96 && k <= 105) return k - 96; return null; };
let numBuf = '', numT = null;
function numPad(txt, sub) {
  let el = $('#numpad'); if (!el) { el = document.createElement('div'); el.id = 'numpad'; el.className = 'numpad'; document.body.appendChild(el); }
  el.innerHTML = `<b>${esc(txt)}</b><small>${esc(sub || '')}</small>`; el.classList.remove('hidden');
}
function hideNumPad() { const el = $('#numpad'); if (el) el.classList.add('hidden'); }
async function numKey(d) {
  if (!numBuf && d === 0) return lastChannel();                 // 0 on its own = back to the last channel
  numBuf = (numBuf + d).slice(0, 4);
  let list = chanList(); if (!list.length) { try { list = await catalog('live'); } catch (e) { list = []; } }
  const n = +numBuf, c = list[n - 1];
  numPad(numBuf, c ? c.name : T('لا توجد قناة بهذا الرقم'));
  clearTimeout(numT);
  const go = () => { const m = numBuf; numBuf = ''; hideNumPad(); tuneNumber(+m); };
  numT = setTimeout(go, String(list.length).length <= numBuf.length ? 250 : 1600);
}
async function tuneNumber(n) {
  let list = chanList(); if (!list.length) list = await catalog('live').catch(() => []);
  const c = list[n - 1]; if (!c) return toast(T('لا توجد قناة بالرقم ') + n);
  S.channelQueue = list; S.channelIndex = n - 1; play(c, { live: true });
}
// ---- last channel ----
function noteChannel(c) {
  const cur = S.curCh; if (cur && key(cur.item) === key(c)) { cur.idx = S.channelIndex; return; }
  if (cur) { S.lastCh = cur; H.store.set('lastCh', { item: cur.item }); }
  S.curCh = { item: c, queue: S.channelQueue, idx: S.channelIndex };
  if (visible('player')) $('#p-last').classList.toggle('hidden', !S.lastCh);
}
function lastChannel() {
  const p = S.lastCh; if (!p || !p.item) return toast(T('لا توجد قناة سابقة'));
  if (p.queue && p.queue.length && p.idx >= 0 && p.queue[p.idx] && key(p.queue[p.idx]) === key(p.item)) { S.channelQueue = p.queue; S.channelIndex = p.idx; }
  else { const l = chanList(), i = l.findIndex(x => key(x) === key(p.item)); S.channelQueue = i >= 0 ? l : [p.item]; S.channelIndex = i >= 0 ? i : 0; }
  play(S.channelQueue[S.channelIndex], { live: true });
}
$('#p-last').onclick = lastChannel;

// ---- watch later (synced like favourites) ----
function toggleLater(it, silent) {
  const k = key(it);
  if (S.later[k]) { delete S.later[k]; S.laterStamp[k] = { at: Date.now(), del: true }; if (!silent) toast(T('أُزيلت من "المشاهدة لاحقاً"')); }
  else { S.later[k] = slim(it); S.laterStamp[k] = { at: Date.now() }; if (!silent) toast(T('أُضيفت إلى "المشاهدة لاحقاً"')); }
  save('later'); save('laterStamp'); syncSoon();
  if (S.section === 'home' && visible('home')) { const c = $('#content'), st = c.scrollTop; renderHome(); c.scrollTop = st; }
}

// ---- matches (5.6): FilGoal fixtures via n8n (Arabic names, leagues, status, score, TV channel) + EPG view ----
const M6 = { mode: 'today', fx: null, fxAt: 0 };
// 5.12.2: the matches feature is OFF until it has a licensed data source (API-Football, paid once there is revenue).
// Everything below stays in place; flip to true (and point loadFixtures at the licensed feed) to bring it back.
const MATCHES_ON = false;
if (!MATCHES_ON) { const t = document.querySelector('.tab[data-sec="matches"]'); if (t) t.remove(); }
const dayKey = sec => localDate(sec * 1000).toISOString().slice(0, 10);
const teamName = n => String(n || '').replace(/\s*\|.*$/, '').trim();
// 5.7: English names from the feed when both teams have one (never mix scripts inside a row)
const fxEn = m => EN_UI && m.homeEn && m.awayEn;
const fxHome = m => fxEn(m) ? m.homeEn : teamName(m.home), fxAway = m => fxEn(m) ? m.awayEn : teamName(m.away);
const fxLeague = m => EN_UI && m.leagueEn ? m.leagueEn : m.league;
const FX_STATUS = { 'الشوط الاول': '1st half', 'الشوط الأول': '1st half', 'الشوط الثاني': '2nd half', 'استراحة': 'HT', 'بين الشوطين': 'HT', 'الشوط الاضافي الاول': 'ET 1', 'الشوط الإضافي الأول': 'ET 1',
  'الشوط الاضافي الثاني': 'ET 2', 'الشوط الإضافي الثاني': 'ET 2', 'ركلات الترجيح': 'Penalties', 'ضربات الترجيح': 'Penalties', 'انتهت': 'FT', 'لم تبدأ': 'Not started', 'تأجيل': 'Postponed', 'مؤجلة': 'Postponed', 'إلغاء': 'Cancelled', 'ألغيت': 'Cancelled', 'متوقفة': 'Suspended' };
const fxStatus = t => EN_UI ? (FX_STATUS[String(t || '').trim()] || (t ? 'Live' : '')) : t;
// broadcaster name ("beIN SPORTS 2 HD", "الكأس 1 HD") -> key comparable with our channel names ("BEIN SPORT 2", "Al Kass One HD")
async function loadFixtures(force) {
  if (!MATCHES_ON) { M6.fx = []; M6.fxAt = Date.now(); return M6.fx; }   // no request at all while the feature is off
  if (!force && M6.fx && Date.now() - M6.fxAt < 60000) return M6.fx;
  const j = await (await feed('hooksha-matches')).json();
  if (!j || !Array.isArray(j.matches)) throw new Error('bad reply');
  M6.fx = j.matches; M6.fxAt = Date.now(); return M6.fx;
}
async function openMatches() {
  $('#empty').classList.add('hidden'); $('#count').textContent = '';
  const c = $('#content'); c.className = 'rows matches';
  renderMatches(true);
  setLoading(true);
  try {
    await loadFixtures();
    if (S.section === 'matches') { renderMatches(); const f = $('#content .fx, #content .match') || $('#content .mtab.on'); if (f) Nav.set(f); }
  } catch (e) { logError('Matches', e); if (S.section === 'matches') $('#m-body').innerHTML = T('<div class="empty">تعذر تحميل المباريات</div>'); } finally { setLoading(false); }
  clearInterval(M6.timer); M6.timer = setInterval(() => { if (S.section !== 'matches' || !visible('home')) return; loadFixtures(true).then(() => { const cc = $('#content'), st = cc.scrollTop, cur = Nav.current(), id = cur && cur.dataset && cur.dataset.fx; renderMatches(); cc.scrollTop = st; if (id) { const el = $(`#content .fx[data-fx="${id}"]`); if (el) Nav.set(el, { scroll: false }); } }).catch(() => {}); }, 60000);
}
function dayLabel(sec) {
  const d = localDate(sec * 1000), t = localDate(Date.now()); const day = x => Math.floor(x.getTime() / 864e5);
  const diff = day(d) - day(t); return diff === 0 ? T('اليوم') : diff === 1 ? T('غداً') : diff === -1 ? T('أمس') : d.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}
function fxRow(m, withDay) {
  const live = m.status === 'live', post = m.status === 'post', off = m.status === 'off';
  const sc = (live || post) && m.hs != null ? `${m.hs} - ${m.as}` + (m.hp != null ? ` <small>(${m.hp} - ${m.ap})</small>` : '') : hhmm(m.start);
  const st = live ? `<span class="live"><i class="dot"></i>${esc(m.minute ? m.minute + '\'' : (fxStatus(m.statusText) || T('مباشر')))}</span>` : post ? T('انتهت') : off ? esc(fxStatus(m.statusText) || T('مؤجلة')) : (withDay ? esc(dayLabel(m.start)) : '');
  const tv = m.channels.map(t => esc(t.name) + (t.commentator ? ' — ' + esc(t.commentator) : '')).join(' · ');   // broadcaster: info only
  const act = canRemind(m, Date.now() / 1000) ? `<span class="fa ${hasMatchRem(m) ? 'on' : ''}">${ic('bell')}</span>` : '';
  const star = id => isFavTeam(id) ? `<i class="tstar">★</i>` : '';
  return `<button class="fx ${live ? 'is-live' : ''} ${post ? 'is-post' : ''} ${isFavTeam(m.homeId) || isFavTeam(m.awayId) ? 'is-fav' : ''}" data-fx="${m.id}"><span class="fh">${logo(m.homeLogo)}${star(m.homeId)}<span>${esc(fxHome(m))}</span></span><span class="fs"><b>${sc}</b><small>${st}</small></span><span class="fw"><span>${esc(fxAway(m))}</span>${star(m.awayId)}${logo(m.awayLogo)}</span>${act}${tv ? `<span class="ftv">${ic('live')} ${tv}</span>` : ''}</button>`;
}
function renderMatches(loading) {
  const c = $('#content'); c.className = 'rows matches';
  const tabs = [['today', T('مباريات اليوم')], ['all', T('كل المباريات')], ['teams', T('فرقي')]];
  let head = `<div class="mseg">${tabs.map(([k, l]) => `<button class="chip mtab ${M6.mode === k ? 'on' : ''}" data-mm="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  const q = S.query, now = Date.now() / 1000;
  if (loading && !M6.fx) body = T('<div class="loader"><i></i><span>جاري تحميل المباريات…</span></div>');
  else {
    const today = dayKey(now);
    let list = (M6.fx || []).filter(m => M6.mode === 'today' ? (dayKey(m.start) === today || m.status === 'live') : (dayKey(m.start) >= today || m.status === 'live'));
    if (q) list = list.filter(m => qMatch(m.home + ' ' + m.away + ' ' + m.league + ' ' + (m.homeEn || '') + ' ' + (m.awayEn || '') + ' ' + (m.leagueEn || '') + ' ' + m.channels.map(t => t.name).join(' '), q));
    if (M6.mode === 'teams') { list = (M6.fx || []).filter(m => (isFavTeam(m.homeId) || isFavTeam(m.awayId)) && (dayKey(m.start) >= today || m.status === 'live')); if (q) list = list.filter(m => qMatch(m.home + ' ' + m.away + ' ' + (m.homeEn || '') + ' ' + (m.awayEn || ''), q)); }
    const pinned = M6.mode === 'teams' ? [] : list.filter(m => isFavTeam(m.homeId) || isFavTeam(m.awayId));
    if (pinned.length) { body += `<h3 class="mgroup fav">★ ${T('فرقي')} <small class="muted">${pinned.length}</small></h3>`; pinned.sort((a, b) => a.start - b.start).forEach(m => { body += fxRow(m, true); }); }
    if (M6.mode === 'teams') body += teamsHeader();
    const leagues = new Map();
    list.forEach(m => { const L = leagues.get(m.league) || { name: fxLeague(m), order: m.leagueOrder, live: 0, items: [] }; L.items.push(m); if (m.status === 'live') L.live++; leagues.set(m.league, L); });
    const ordered = M6.mode === 'teams' ? [] : [...leagues.values()].sort((a, b) => (b.live > 0) - (a.live > 0) || a.order - b.order || a.items[0].start - b.items[0].start);
    M6.byId = new Map(list.map(m => [String(m.id), m]));
    if (M6.mode === 'teams') { list.sort((a, b) => a.start - b.start); let dd = ''; list.forEach(m => { const d = m.status === 'live' ? T('مباشر الآن') : dayLabel(m.start); if (d !== dd) { dd = d; body += `<div class="mday">${esc(d)}</div>`; } body += fxRow(m, false); }); }
    ordered.forEach(L => {
      body += `<h3 class="mgroup">${ic('trophy')} ${esc(L.name)} <small class="muted">${L.items.length}</small>${L.live ? T(' <span class="live"><i class="dot"></i>مباشر</span>') : ''}</h3>`;
      let day = '';
      L.items.sort((a, b) => a.start - b.start).forEach(m => {
        if (M6.mode === 'all') { const d = dayLabel(m.start); if (d !== day) { day = d; body += `<div class="mday">${esc(d)}</div>`; } }
        body += fxRow(m, false);
      });
    });
    if (!list.length) body += `<div class="empty">${q ? T('لا توجد نتائج') : M6.mode === 'teams' ? (Object.keys(S.teams).length ? T('لا توجد مباريات لفرقك في الأيام القادمة') : T('لم تختر أي فريق بعد. افتح أي مباراة واختر ★ بجانب الفريق')) : M6.mode === 'today' ? T('لا توجد مباريات اليوم') : T('لا توجد مباريات')}</div>`;
    $('#count').textContent = list.length || '';
    body += T('<div class="muted msrc">المواعيد والنتائج من FilGoal · تُحدَّث كل دقيقة</div>');
  }
  c.innerHTML = head + `<div id="m-body">${body}</div>`;
  paintIcons();
  $('#empty').classList.add('hidden');
}
$('#content').addEventListener('click', e => {
  if (S.section !== 'matches') return;
  const t = e.target.closest('.mtab');
  if (t) { if (M6.mode === t.dataset.mm) return; M6.mode = t.dataset.mm; openMatches().then(() => { const b = $(`#content .mtab[data-mm="${M6.mode}"]`); if (b) Nav.set(b); }); return; }
  const tr = e.target.closest('[data-tdel]'); if (tr) { toggleTeam({ id: +tr.dataset.tdel }); return renderMatches(); }
  const f = e.target.closest('.fx');
  if (f) { const m = M6.byId && M6.byId.get(f.dataset.fx); if (m) matchDialog(m); }
});

// ---- subscription expiry ----
function expiryText() {
  const a = S.acct; if (!a) return '';
  if (!a.exp) return T('الاشتراك: غير محدد المدة');
  const days = Math.ceil((a.exp * 1000 - Date.now()) / 864e5);
  const d = localDate(a.exp * 1000).toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return days <= 0 ? `${T('الاشتراك انتهى في')} ${d}` : (EN_UI ? `Subscription ends ${d} (${days} days left)` : `الاشتراك ينتهي ${d} (باقي ${days} يوم)`);
}
async function checkExpiry(fakeExp) {
  if (!S.profile) return;
  try {
    if (fakeExp == null) { const r = await X.api(''); const u = (r && r.user_info) || {}; S.acct = { exp: parseInt(u.exp_date) || 0, status: u.status || '' }; }
    else S.acct = { exp: fakeExp, status: 'Active' };
    const a = S.acct; if (!a.exp) return;
    const days = (a.exp * 1000 - Date.now()) / 864e5, level = days <= 1 ? 1 : days <= 7 ? 7 : 0;
    const tag = S.profile.id + ':' + a.exp + ':' + level;
    if (!level || S.prefs.expWarned === tag || visible('player')) return;
    S.prefs.expWarned = tag; H.store.set('prefs', S.prefs);
    const m = modal(`<h3>${days <= 0 ? T('الاشتراك انتهى') : level === 1 ? T('ينتهي الاشتراك غداً') : T('الاشتراك على وشك الانتهاء')}</h3><p class="muted">${esc(expiryText())}</p><p class="muted">${T('جدّد الاشتراك مع مزوّد الخدمة حتى لا تتوقف المشاهدة.')}</p><div class="btns"><button class="primary" id="x-ok">${T('تمام')}</button></div>`);
    m.querySelector('#x-ok').onclick = closeModal;
  } catch (e) { logError('Expiry', e); }
}

window.addEventListener('DOMContentLoaded', boot);   // 5.11: after license.js (loaded after app.js) has run

// ---- 5.5 — wall-clock fix ----
// webOS 8 ships an old tz database (Egypt: no summer time), so the TV shows every time 1 h behind.
// n8n (current tz data) tells us the real offset for the device's zone; we render all times through it.
// localDate(ms) returns a Date whose UTC fields ARE the correct local wall clock — always read it with getUTC*/timeZone:'UTC'.
let TZ_OFFSET = (() => { try { const v = JSON.parse(localStorage.getItem('hk.tzfix') || 'null'); return v && Date.now() - v.at < 3 * 864e5 ? v.off : null; } catch (e) { return null; } })();
function localDate(ms) { const off = TZ_OFFSET == null ? -new Date(ms).getTimezoneOffset() : TZ_OFFSET; return new Date(ms + off * 60000); }
async function refreshTzFix() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (!tz) return;
    const j = await (await feed('time?tz=' + encodeURIComponent(tz))).json();
    if (typeof j.offsetMin !== 'number') return;
    const dev = -new Date().getTimezoneOffset();
    TZ_OFFSET = j.offsetMin === dev ? null : j.offsetMin;
    localStorage.setItem('hk.tzfix', JSON.stringify({ off: TZ_OFFSET, at: Date.now(), tz }));
    if (TZ_OFFSET != null && S.section === 'guide') renderGuide();
  } catch (e) { logError('Time', e); }
}
setTimeout(refreshTzFix, 1500);

// =====================================================================================
// 5.8 — favourite teams (+ auto reminders), team logos, "live now" home shelf, new-episode alerts
// =====================================================================================
const logo = u => u ? `<img class="tlogo" src="${esc(u)}" loading="lazy" onerror="this.remove()">` : '';
const teamKey = id => 't:' + id;
const isFavTeam = id => !!(id && S.teams[teamKey(id)]);
function toggleTeam(t) {
  const k = teamKey(t.id);
  if (S.teams[k]) { delete S.teams[k]; S.teamsStamp[k] = { at: Date.now(), del: true }; S.reminders = S.reminders.filter(r => !(r.auto && r.teamId === t.id)); H.store.set('reminders', S.reminders); if (t.name) toast(T('أُزيل من فرقي: ') + t.name); }
  else { S.teams[k] = { id: t.id, name: t.name, nameEn: t.nameEn || '', logo: t.logo || '' }; S.teamsStamp[k] = { at: Date.now() }; toast(T('أُضيف إلى فرقي: ') + t.name + T(' — سيتم تذكيرك قبل كل مباراة')); autoRemindTeams(); }
  save('teams'); save('teamsStamp'); syncSoon();
}
function teamsPayload() {
  return Object.keys(S.teams).map(k => ({ k, at: (S.teamsStamp[k] || {}).at || 1, item: S.teams[k] }))
    .concat(Object.keys(S.teamsStamp).filter(k => S.teamsStamp[k].del && !S.teams[k]).map(k => ({ k, at: S.teamsStamp[k].at, del: true })));
}
function mergeTeams(list) {
  let changed = false;
  for (const f of (list || [])) {
    const mine = (S.teamsStamp[f.k] || {}).at || 0; if (f.at <= mine) continue;
    S.teamsStamp[f.k] = f.del ? { at: f.at, del: true } : { at: f.at };
    if (f.del) { if (S.teams[f.k]) { delete S.teams[f.k]; changed = true; } } else if (f.item && f.item.id) { S.teams[f.k] = f.item; changed = true; }
  }
  save('teams'); save('teamsStamp'); if (changed) autoRemindTeams(); return changed;
}
const favTeamName = t => EN_UI && t.nameEn ? t.nameEn : t.name;
function teamsHeader() {
  const list = Object.values(S.teams); if (!list.length) return '';
  return `<div class="tchips">${list.map(t => `<button class="chip tchip" data-tdel="${t.id}" title="${T('إزالة')}">${logo(t.logo)}<span>${esc(favTeamName(t))}</span> ✕</button>`).join('')}</div>`;
}
// Automatic reminders for every upcoming favourite-team match (the reminder is for the match, no channel needed).
function autoRemindTeams() {
  if (!M6.fx || !Object.keys(S.teams).length) return 0;
  const now = Date.now() / 1000; let n = 0;
  for (const m of M6.fx) {
    if (!canRemind(m, now) || !(isFavTeam(m.homeId) || isFavTeam(m.awayId)) || hasMatchRem(m)) continue;
    S.reminders.push(Object.assign(matchRem(m), { auto: true, teamId: isFavTeam(m.homeId) ? m.homeId : m.awayId })); n++;
  }
  if (n) H.store.set('reminders', S.reminders);
  return n;
}
async function teamsTick() {
  if (!S.profile || !Object.keys(S.teams).length) return;
  try { await loadFixtures(true); autoRemindTeams(); } catch (e) { logError('Teams', e); }
}
function matchDialog(m) {
  const now = Date.now() / 1000, live = m.status === 'live', rem = S.reminders.find(r => r.id === matchRemId(m));
  const tv = m.channels.map(t => esc(t.name) + (t.commentator ? ' — ' + esc(t.commentator) : '')).join('<br>');
  const when = live ? `<span class="live"><i class="dot"></i>${esc(m.minute ? m.minute + '\'' : fxStatus(m.statusText) || T('مباشر'))}</span> ${m.hs != null ? m.hs + ' - ' + m.as : ''}` : m.status === 'post' ? `${T('انتهت')} ${m.hs != null ? m.hs + ' - ' + m.as : ''}` : m.status === 'off' ? esc(fxStatus(m.statusText) || T('مؤجلة')) : `${esc(dayLabel(m.start))} ${hhmm(m.start)}`;
  const teamBtn = (id, name, nameEn, lg) => id ? `<button class="opt" data-team="${id}" data-name="${esc(name)}" data-en="${esc(nameEn || '')}" data-logo="${esc(lg || '')}">${logo(lg)} ${isFavTeam(id) ? '★ ' + T('إزالة من فرقي') : '☆ ' + T('إضافة إلى فرقي')}: ${esc(EN_UI && nameEn ? nameEn : teamName(name))}</button>` : '';
  const md = modal(`<h3 class="mdlg-h">${logo(m.homeLogo)} ${esc(fxHome(m))} × ${esc(fxAway(m))} ${logo(m.awayLogo)}</h3>
    <div class="muted">${esc(fxLeague(m))}${m.round && !(EN_UI && /[\u0600-\u06FF]/.test(m.round)) ? ' · ' + esc(m.round) : ''}</div><div>${when}</div>
    ${tv ? `<div class="muted">${ic('live')} ${tv}</div>` : `<div class="muted">${T('لا توجد قناة ناقلة معروفة لهذه المباراة')}</div>`}
    ${canRemind(m, now) ? `<button class="opt" id="md-rem">${ic('bell')} ${rem ? T('إلغاء التذكير') : T('ذكّرني')}</button>` : ''}
    ${teamBtn(m.homeId, m.home, m.homeEn, m.homeLogo)}${teamBtn(m.awayId, m.away, m.awayEn, m.awayLogo)}
    <div class="btns"><button class="chip" id="md-c">${T('إغلاق')}</button></div>`);
  paintIcons();
  const r = md.querySelector('#md-rem'); if (r) r.onclick = () => {
    if (rem) { S.reminders = S.reminders.filter(x => x !== rem); toast(T('تم إلغاء التذكير')); }
    else { S.reminders.push(matchRem(m)); toast(T('سيتم تذكيرك قبل البداية بدقيقة')); }
    H.store.set('reminders', S.reminders); closeModal(); renderMatches();
  };
  md.querySelectorAll('[data-team]').forEach(b => b.onclick = () => { toggleTeam({ id: +b.dataset.team, name: teamName(b.dataset.name), nameEn: b.dataset.en, logo: b.dataset.logo }); closeModal(); if (S.section === 'matches') renderMatches(); });
  md.querySelector('#md-c').onclick = closeModal;
}
// ---- home: "live now" shelf (live or kicking off within 30 min) ----
function nowMatches() {
  if (!M6.fx) return [];
  const now = Date.now() / 1000;
  return M6.fx.filter(m => (m.status === 'live' || (m.status === 'pre' && m.start - now < 1800 && m.start > now - 600)))
    .sort((a, b) => ((isFavTeam(b.homeId) || isFavTeam(b.awayId)) - (isFavTeam(a.homeId) || isFavTeam(a.awayId))) || ((b.status === 'live') - (a.status === 'live')) || a.start - b.start).slice(0, 12);
}
function nowMatchesShelf() {
  const list = nowMatches(); if (!list.length) return '';
  M6.nowById = new Map(list.map(m => [String(m.id), m]));
  return `<section class="shelf"><h3>${ic('trophy')} ${T('مباريات الآن')} <small class="muted">${list.length}</small></h3><div class="shelf-row">${list.map(m => {
    const live = m.status === 'live';
    return `<button class="hm ${live ? 'is-live' : ''} ${isFavTeam(m.homeId) || isFavTeam(m.awayId) ? 'is-fav' : ''}" data-hm="${m.id}"><span class="hm-t">${logo(m.homeLogo)}<b>${live && m.hs != null ? m.hs + ' - ' + m.as : hhmm(m.start)}</b>${logo(m.awayLogo)}</span><span class="hm-n">${esc(fxHome(m))} × ${esc(fxAway(m))}</span><small class="muted">${live ? `<span class="live"><i class="dot"></i>${esc(m.minute ? m.minute + '\'' : fxStatus(m.statusText) || T('مباشر'))}</span> · ` : ''}${esc(m.channels.length ? m.channels[0].name : fxLeague(m))}</small></button>`;
  }).join('')}</div></section>`;
}
function openNowMatch(id) {
  const m = M6.nowById && M6.nowById.get(String(id)); if (m) matchDialog(m);   // details + remind (nothing to play)
}
// ---- new episodes for followed series (favourites + series in progress) ----
function followedSeries() {
  const out = new Map();
  Object.values(S.favorites).filter(f => f.type === 'series').forEach(f => out.set(String(f.id), f));
  Object.values(S.progress).forEach(p => { const sid = p.seriesId || (p.item && p.item.seriesId); if (!sid || out.has(String(sid))) return; const sr = (((S.catalog.series || {}).items) || []).find(x => String(x.id) === String(sid)); if (sr) out.set(String(sid), sr); });
  return [...out.values()].slice(0, 40);
}
let epChecking = false;
async function checkNewEpisodes() {
  if (!S.profile || epChecking) return; epChecking = true;
  try {
    await catalog('series').catch(() => []);
    let fresh = 0; const names = [];
    for (const sr of followedSeries()) {
      const sid = String(sr.id);
      let n; try { n = (await X.episodes(sr.id)).episodes.length; } catch (e) { continue; }
      if (S.epSeen[sid] == null) { S.epSeen[sid] = n; continue; }               // first time: just remember the count
      if (n > S.epSeen[sid]) { const add = n - S.epSeen[sid]; const prev = S.newEps[sid]; S.newEps[sid] = { n: (prev ? prev.n : 0) + add, at: Date.now(), item: slim(sr) }; S.epSeen[sid] = n; fresh += add; names.push(sr.name); }
      else if (n < S.epSeen[sid]) S.epSeen[sid] = n;
    }
    save('epSeen'); save('newEps');
    if (fresh) { toast((names.length === 1 ? T('حلقة جديدة: ') + names[0] : T('حلقات جديدة في ') + names.length + T(' مسلسلات')), 6000); if (S.section === 'home' && visible('home')) { const c = $('#content'), st = c.scrollTop; renderHome(); c.scrollTop = st; } }
  } catch (e) { logError('Episodes', e); } finally { epChecking = false; }
}
function newEpItems() { return Object.values(S.newEps).sort((a, b) => b.at - a.at).map(e => ({ ...e.item, badge: '+' + e.n + ' ' + (e.n === 1 ? T('حلقة جديدة') : T('حلقات جديدة')) })).filter(kidsItem).slice(0, 20); }
function seenEpisodes(it) { const sid = String(it.id); if (S.newEps[sid]) { delete S.newEps[sid]; save('newEps'); } }

// =====================================================================================
// 5.9 — manual favourites order, screensaver (TV + desktop), Windows shortcuts + always-on-top
// =====================================================================================
// Favourites in the user's order: keys listed in S.favOrder.list first (in that order), then the rest by when they were added.
function favList() {
  const pos = new Map((S.favOrder.list || []).map((k, i) => [k, i]));
  return Object.keys(S.favorites).map(k => [k, S.favorites[k]])
    .sort((a, b) => (pos.has(a[0]) ? pos.get(a[0]) : 1e6 + ((S.favStamp[a[0]] || {}).at || 0) / 1e13) - (pos.has(b[0]) ? pos.get(b[0]) : 1e6 + ((S.favStamp[b[0]] || {}).at || 0) / 1e13))
    .map(x => x[1]);
}
function setFavOrder(keys) { S.favOrder = { at: Date.now(), list: keys }; save('favOrder'); syncSoon(); }
// Sort mode: a list with ▲ ▼ per item (remote/keyboard friendly) + "move to top"; OK = done.
function favSortMode() {
  let keys = favList().map(key);
  const draw = (focusK, dir) => {
    const m = modal(`<h3>${T('ترتيب المفضلة')}</h3><div class="muted">${T('استخدم ▲ ▼ لتحريك العنصر، أو زر السهم فوق الخط لنقله إلى أول القائمة')}</div>
      <div class="list favsort">${keys.map((k, i) => { const it = S.favorites[k]; return `<div class="fs-row" data-k="${esc(k)}"><span class="fs-n">${i + 1}</span><img src="${esc(it.imageUrl || 'icon.png')}" onerror="this.src='icon.png'"><span class="fs-t">${esc(it.name)}</span><button class="chip small" data-mv="top" data-i="${i}" title="${T('إلى أول القائمة')}">${ic('totop')}</button><button class="chip small" data-mv="up" data-i="${i}">▲</button><button class="chip small" data-mv="down" data-i="${i}">▼</button></div>`; }).join('')}</div>
      <div class="btns"><button class="primary" id="fs-done">${T('تم')}</button><button class="chip" id="fs-reset">${T('ترتيب حسب الإضافة')}</button></div>`);
    paintIcons();
    m.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
      const i = +b.dataset.i, k = keys[i], mv = b.dataset.mv;
      const j = mv === 'top' ? 0 : mv === 'up' ? Math.max(0, i - 1) : Math.min(keys.length - 1, i + 1);
      if (j === i) return;
      keys.splice(i, 1); keys.splice(j, 0, k); setFavOrder(keys.slice()); draw(k, mv);
    });
    m.querySelector('#fs-done').onclick = () => { closeModal(); if (S.section === 'favorites') switchSection('favorites').then(() => { const c = $('#content .card'); if (c) Nav.set(c); }); };
    m.querySelector('#fs-reset').onclick = () => { keys = Object.keys(S.favorites).sort((a, b) => ((S.favStamp[a] || {}).at || 0) - ((S.favStamp[b] || {}).at || 0)); setFavOrder([]); draw(); };
    if (focusK) { const row = m.querySelector(`.fs-row[data-k="${CSS.escape(focusK)}"]`); const b = row && row.querySelector(`[data-mv="${dir === 'top' ? 'up' : dir}"]`); if (b) { row.scrollIntoView({ block: 'center' }); Nav.set(b); } }
  };
  draw();
}

// ---- screensaver: after N idle minutes on the home screens (never while playing) ----
const SAVER_MIN = () => S.prefs.saver == null ? 5 : +S.prefs.saver;   // 0 = off
let saverT = null, saverTick = null, saverBgT = null, lastInput = Date.now();
function saverArm() {
  lastInput = Date.now();
  if (!$('#saver').classList.contains('hidden')) saverOff();
  clearTimeout(saverT);
  const min = SAVER_MIN(); if (!min) return;
  saverT = setTimeout(saverMaybe, min * 60000);
}
function saverMaybe() {
  const min = SAVER_MIN(); if (!min) return;
  if (visible('player') || visible('multi') || !S.profile || Date.now() - lastInput < min * 60000 - 500) return saverArm();
  saverOn();
}
function saverBackdrops() {
  const pool = [].concat(((S.catalog.movies || {}).items || []), ((S.catalog.series || {}).items || []), favList(), Object.values(S.later || {}))
    .filter(i => i && i.imageUrl && (i.type === 'movie' || i.type === 'series') && kidsItem(i) && !i.adult);
  return pool.length ? pool : [];
}
function saverPaint() {
  const now = localDate(Date.now());   // wall clock via hooksha-time (webOS 8 has stale Egypt DST rules)
  $('#sv-time').textContent = now.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });   // 24 h: no AM/PM to reorder in RTL
  $('#sv-date').textContent = now.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const live = (M6.fx || []).filter(m => m.status === 'live').sort((a, b) => ((isFavTeam(b.homeId) || isFavTeam(b.awayId)) - (isFavTeam(a.homeId) || isFavTeam(a.awayId)))).slice(0, 5);
  $('#sv-matches').innerHTML = live.length ? `<div class="sv-h"><i class="dot"></i> ${T('مباريات الآن')}</div>` + live.map(m => `<div class="sv-m">${logo(m.homeLogo)}<span>${esc(fxHome(m))}</span><b>${m.hs != null ? m.hs + ' - ' + m.as : ''}</b><span>${esc(fxAway(m))}</span>${logo(m.awayLogo)}<small>${esc(m.minute ? m.minute + '\'' : fxStatus(m.statusText) || '')}</small></div>`).join('') : '';
}
function saverNextBg() {
  const pool = saverBackdrops(); if (!pool.length) return;
  const it = pool[Math.floor(Math.random() * pool.length)];
  const img = new Image();
  img.onload = () => { const a = $('#sv-bg'), b = $('#sv-bg2'); b.style.backgroundImage = `url("${it.imageUrl.replace(/"/g, '%22')}")`; b.classList.add('on'); a.classList.remove('on'); a.id = 'sv-bg2'; b.id = 'sv-bg'; $('#sv-title').textContent = it.name; };
  img.src = it.imageUrl;
}
function saverOn() {
  $('#saver').classList.remove('hidden'); document.body.classList.add('saver-on');
  saverPaint(); saverNextBg();
  loadFixtures().then(saverPaint).catch(() => {});
  saverTick = setInterval(() => { saverPaint(); if (new Date().getSeconds() < 10) loadFixtures().then(saverPaint).catch(() => {}); }, 10000);
  saverBgT = setInterval(saverNextBg, 20000);
  if (window.HK_fx3d && typeof HK_fx3d.particles === 'function') {
    try { S._saverFx = HK_fx3d.particles($('#sv-particles')); if (S._saverFx && S._saverFx.start) S._saverFx.start(); } catch (e) {}
  }
}
function saverOff() {
  $('#saver').classList.add('hidden'); document.body.classList.remove('saver-on');
  clearInterval(saverTick); clearInterval(saverBgT);
  if (S._saverFx && S._saverFx.stop) { try { S._saverFx.stop(); } catch (e) {} S._saverFx = null; }
}
['keydown', 'mousemove', 'mousedown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, e => {
  const wasOn = !$('#saver').classList.contains('hidden');
  saverArm();
  if (wasOn && ev !== 'mousemove') { e.preventDefault(); e.stopImmediatePropagation(); }   // the key that wakes the saver does nothing else
}, true));
saverArm();

// ---- Windows: global shortcuts + always on top ----
function winShortcut(e) {
  if (window.SOHBATNA_PLATFORM !== 'electron' || TV) return false;
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !(e.ctrlKey || e.altKey)) return false;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'f') { if (visible('player')) return false; show('home'); const s = $('#search'); s.focus(); s.select(); return true; }
  if (e.ctrlKey && k === 't') { toggleOnTop(); return true; }
  if (e.ctrlKey && k === ',') { $('#settings-btn').click(); return true; }
  if (e.ctrlKey && k === 'l') { if (visible('player') && ctx.live) { lastChannel(); return true; } return false; }
  if (e.altKey && /^[1-8]$/.test(k)) { const tabs = ['home', 'live', 'guide', 'matches', 'movies', 'series', 'favorites', 'continue'].filter(t => MATCHES_ON || t !== 'matches'); if (visible('player')) closePlayer(); show('home'); switchSection(tabs[+k - 1]); return true; }
  if (e.key === 'F1' || (e.shiftKey && k === '?')) { shortcutsHelp(); return true; }
  if (e.key === 'F11') { $('#p-fs') && visible('player') ? $('#p-fs').click() : H.fullscreen && H.isFullscreen().then(on => H.fullscreen(!on)); return true; }
  return false;
}
document.addEventListener('keydown', e => { if (winShortcut(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
async function toggleOnTop() {
  if (!H.onTop) return;
  const on = await H.onTop(!S.prefs.onTop); S.prefs.onTop = on; H.store.set('prefs', S.prefs);
  toast(on ? T('ستبقى النافذة فوق كل البرامج') : T('عادت النافذة إلى وضعها الطبيعي'));
  const b = $('#ontop-btn'); if (b) b.classList.toggle('on', on);
}
function shortcutsHelp() {
  const rows = [['Ctrl + F', T('بحث')], ['Alt + 1…' + (MATCHES_ON ? 8 : 7), T('التنقل بين الأقسام')], ['Ctrl + T', T('النافذة فوق كل البرامج')], ['Ctrl + ,', T('الإعدادات')], ['F11', T('ملء الشاشة')],
    ['Space / K', T('تشغيل / إيقاف مؤقت')], ['← →', T('تقديم وترجيع (القناة التالية في البث المباشر)')], ['↑ ↓', T('الصوت')], ['M', T('كتم الصوت')], ['F', T('ملء الشاشة في المشغّل')],
    ['N', T('الحلقة التالية')], ['G / H', T('توقيت الترجمة −/+ 0.1 ث')], ['0-9', T('رقم القناة (في البث المباشر)')], ['Ctrl + L / Backspace', T('آخر قناة')], ['+ / -', T('سرعة التشغيل')], ['Esc', T('رجوع')]];
  const m = modal(`<h3>${T('اختصارات الكيبورد')}</h3><table class="keys">${rows.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${d}</td></tr>`).join('')}</table><div class="btns"><button class="chip" id="k-c">${T('إغلاق')}</button></div>`);
  m.querySelector('#k-c').onclick = closeModal;
}
if (window.SOHBATNA_PLATFORM === 'electron' && !TV) {
  setTimeout(() => {
    const b = document.createElement('button'); b.id = 'ontop-btn'; b.className = 'chip icon' + (S.prefs.onTop ? ' on' : ''); b.dataset.ic = 'pin'; b.title = T('النافذة فوق كل البرامج') + ' (Ctrl+T)'; b.innerHTML = `<span class="lbl">${T('فوق كل البرامج')}</span>`;
    b.onclick = toggleOnTop; const s = $('#settings-btn'); s.parentNode.insertBefore(b, s); paintIcons();
    if (S.prefs.onTop && H.onTop) H.onTop(true);
  }, 0);
}

// =====================================================================================
// 5.9.1 — subtitles: online (n8n hooksha-subs → OpenSubtitles; works once a key is set on the server),
//         the file's own text tracks, and (Windows) a local .srt/.vtt. One overlay renderer for all of them,
//         so size and timing offset work the same everywhere.
// =====================================================================================
const SUB = { cues: [], offset: 0, label: '', idx: 0 };
function subsParse(text) {
  const t = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const ts = x => { const m = x.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000 : NaN; };
  const out = [];
  for (const block of t.split(/\n{2,}/)) {
    const lines = block.split('\n'); const i = lines.findIndex(l => l.includes('-->')); if (i < 0) continue;
    const [a, b] = lines[i].split('-->'); const start = ts(a), end = ts(b); if (isNaN(start) || isNaN(end)) continue;
    const txt = lines.slice(i + 1).join('\n').replace(/\{\\?an?\d[^}]*\}/g, '').replace(/<\/?(font|c|v|span)[^>]*>/gi, '').trim();
    if (txt) out.push({ start, end, text: txt });
  }
  return out.sort((x, y) => x.start - y.start);
}
function subsEl() {
  let el = $('#p-subs');
  if (!el) { el = document.createElement('div'); el.id = 'p-subs'; el.className = 'p-subs'; $('#player').appendChild(el); }
  el.style.fontSize = (S.prefs.subSize || 100) + '%';
  return el;
}
function subsClear() { SUB.cues = []; SUB.offset = 0; SUB.label = ''; SUB.idx = 0; const el = $('#p-subs'); if (el) el.innerHTML = ''; [...video.textTracks].forEach(x => x.mode = 'disabled'); }
function subsLoad(text, label) {
  const cues = subsParse(text);
  if (!cues.length) { toast(T('ملف الترجمة فارغ أو غير صالح')); return false; }
  [...video.textTracks].forEach(x => x.mode = 'disabled');
  SUB.cues = cues; SUB.offset = 0; SUB.label = label; SUB.idx = 0; subsEl(); subsTick();
  toast(T('الترجمة: ') + label); return true;
}
function subsTick() {
  if (!SUB.cues.length) return;
  const t = video.currentTime - SUB.offset, c = SUB.cues;
  let i = SUB.idx; if (i >= c.length || c[i].start > t) i = 0;
  while (i < c.length && c[i].end < t) i++;
  SUB.idx = i;
  const now = [];
  for (let j = i; j < c.length && c[j].start <= t; j++) if (c[j].end >= t) now.push(c[j].text);
  const html = now.map(x => `<span>${esc(x).replace(/\n/g, '<br>').replace(/&lt;(\/?)(i|b|u)&gt;/g, '<$1$2>')}</span>`).join('<br>');
  const el = subsEl(); if (el._h !== html) { el.innerHTML = html; el._h = html; }
}
video.addEventListener('timeupdate', subsTick);
video.addEventListener('seeked', () => { SUB.idx = 0; subsTick(); });
function subsShift(d) { if (!SUB.cues.length) return; SUB.offset = Math.round((SUB.offset + d) * 10) / 10; subsTick(); flash((SUB.offset > 0 ? '+' : '') + SUB.offset.toFixed(1) + ' ' + T('ث')); }

// what to search for: movie → its name/year; episode → the series name + SxxEyy from the episode title
function subsQuery() {
  const it = ctx.item || {};
  if (ctx.seriesId) {
    const ser = (S.current && S.current.type === 'series' && S.current.id === ctx.seriesId) ? S.current : null;
    const m = String(it.name || '').match(/S(\d+)\s*E(\d+)/i);
    return { type: 'series', name: ser ? ser.name : '', season: m ? +m[1] : 0, episode: m ? +m[2] : 0 };
  }
  const meta = S.meta && S.meta['movie:' + it.name] && S.meta['movie:' + it.name].v;
  return { type: 'movie', name: it.name, imdb: (meta && meta.imdb) || '', year: (meta && meta.year) || '' };
}
// 5.12.3: online subtitle search is OFF (OpenSubtitles' free tier is non-commercial). Files on the device still work;
// flip to true once there is a licensed subtitle source.
const SUBS_ONLINE = false;
async function subsOnline() {
  if (!SUBS_ONLINE) return;
  const q = subsQuery();
  if (!q.name) return toast(T('اسم المسلسل غير معروف — افتح الحلقة من صفحة المسلسل'));
  busy(true, T('جارٍ البحث عن ترجمة…'));
  let r;
  try { r = await (await feed('hooksha-subs', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ op: 'search', langs: S.prefs.subLang === 'en' ? 'en,ar' : 'ar,en' }, q)) })).json(); }
  catch (e) { busy(false); logError('Subs', e); return toast(T('تعذر الاتصال بخدمة الترجمة')); }
  busy(false);
  if (!r.ready) return modal(`<h3>${T('ترجمات من الإنترنت')}</h3><p class="muted">${T('خدمة الترجمات غير مفعّلة بعد، وستعمل تلقائياً فور تفعيلها على الخادم دون الحاجة إلى تحديث.')}</p><div class="btns"><button class="chip" id="sb-c">${T('إغلاق')}</button></div>`).querySelector('#sb-c').onclick = closeModal;
  const list = (r.results || []).sort((a, b) => (a.lang === S.prefs.subLang ? -1 : 0) - (b.lang === S.prefs.subLang ? -1 : 0) || b.downloads - a.downloads).slice(0, 12);
  if (!list.length) return toast(T('لا توجد ترجمة متاحة لهذا العنوان'));
  const m = modal(`<h3>${T('ترجمات من الإنترنت')}</h3><div class="list">${list.map((x, i) => `<button class="opt" data-sb="${i}"><b class="sb-l">${esc(String(x.lang || '').toUpperCase())}</b> ${esc(x.name)} <small class="muted">↓${x.downloads}${x.hi ? ' · SDH' : ''}</small></button>`).join('')}</div>`);
  m.querySelectorAll('[data-sb]').forEach(b => b.onclick = async () => {
    const x = list[+b.dataset.sb]; closeModal(); busy(true, T('جارٍ تحميل الترجمة…'));
    try {
      const g = await (await feed('hooksha-subs', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ op: 'get', id: x.id }) })).json();
      busy(false);
      if (!g.vtt) return toast(T('تعذر تحميل الترجمة') + (g.error ? ' — ' + g.error : ''));
      subsLoad(g.vtt, String(x.lang || '').toUpperCase() + ' · ' + x.name.slice(0, 40));
    } catch (e) { busy(false); logError('Subs', e); toast(T('تعذر تحميل الترجمة')); }
  });
}
function subsLocal() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.srt,.vtt,text/vtt';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const buf = await f.arrayBuffer(); let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.includes('\uFFFD')) try { txt = new TextDecoder('windows-1256').decode(buf); } catch (e) { }   // old Arabic .srt files
    subsLoad(txt, f.name);
  };
  inp.click();
}
function subsMenu() {
  const v = video, tt = [...v.textTracks], hls = v._engine && v._engine.audioTracks ? v._engine : null;
  // audio: HLS streams expose tracks through hls.js; files (mp4/mkv) through the media element
  const a = hls && hls.audioTracks.length > 1 ? hls.audioTracks.map((x, i) => ({ label: x.name, language: x.lang, enabled: i === hls.audioTrack }))
    : v.audioTracks ? [...v.audioTracks] : [];
  const m = modal(`${visible('player') ? playerTabs('tracks') : `<h3>${T('الصوت والترجمة')}</h3>`}
    ${a.length > 1 ? `<div class="section">${T('مسار الصوت')}</div>` + a.map((x, i) => `<button class="opt ${x.enabled ? 'on' : ''}" data-a="${i}">${ic('audio')} ${esc(x.label || x.language || T('مسار ') + (i + 1))}</button>`).join('') : ''}
    <div class="section">${T('الترجمة')}${SUB.label ? ` <small class="muted">— ${esc(SUB.label)}</small>` : ''}</div>
    ${ctx.live || !SUBS_ONLINE ? '' : `<button class="opt" id="sb-on">${ic('search')} ${T('ترجمات من الإنترنت')}</button>`}
    ${tt.map((x, i) => `<button class="opt ${x.mode === 'showing' ? 'on' : ''}" data-t="${i}">${ic('subtitles')} ${esc(x.label || x.language || T('ترجمة ') + (i + 1))} <small class="muted">${T('من الملف')}</small></button>`).join('')}
    ${window.SOHBATNA_PLATFORM === 'electron' && !TV && !ctx.live ? `<button class="opt" id="sb-file">${ic('plus')} ${T('ملف ترجمة من الجهاز (.srt)')}</button>` : ''}
    ${SUB.cues.length || tt.some(x => x.mode === 'showing') ? `<button class="opt" id="sb-off">${ic('close')} ${T('إيقاف الترجمة')}</button>` : ''}
    ${SUB.cues.length ? `<div class="section">${T('توقيت الترجمة')} <small class="muted" id="sb-off-v" dir="ltr">${(SUB.offset > 0 ? '+' : '') + SUB.offset.toFixed(1)} ${T('ث')}</small></div><div class="seg ltr"><button class="opt" data-sh="-0.5">−0.5</button><button class="opt" data-sh="-0.1">−0.1</button><button class="opt" data-sh="0.1">+0.1</button><button class="opt" data-sh="0.5">+0.5</button></div>` : ''}
    <div class="section">${T('حجم الخط')}</div><div class="seg">${[[80, T('صغير')], [100, T('عادي')], [130, T('كبير')], [160, T('كبير جداً')]].map(([v2, l]) => `<button class="opt ${S.prefs.subSize === v2 ? 'on' : ''}" data-sz="${v2}">${l}</button>`).join('')}</div>
    <div class="section">${T('لغة الترجمة المفضلة')}</div><div class="seg">${[['ar', 'العربية'], ['en', 'English']].map(([v2, l]) => `<button class="opt ${S.prefs.subLang === v2 ? 'on' : ''}" data-sl="${v2}">${l}</button>`).join('')}</div>`);
  m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const n = +b.dataset.a; if (hls && hls.audioTracks.length > 1) hls.audioTrack = n; else [...v.audioTracks].forEach((x, k) => x.enabled = k === n); closeModal(); toast(b.textContent.trim()); });
  m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { SUB.cues = []; SUB.label = ''; const el = $('#p-subs'); if (el) el.innerHTML = ''; tt.forEach((x, i) => x.mode = i === +b.dataset.t ? 'showing' : 'disabled'); closeModal(); });
  const on = m.querySelector('#sb-on'); if (on) on.onclick = () => { closeModal(); subsOnline(); };
  const fl = m.querySelector('#sb-file'); if (fl) fl.onclick = () => { closeModal(); subsLocal(); };
  const off = m.querySelector('#sb-off'); if (off) off.onclick = () => { subsClear(); closeModal(); toast(T('تم إيقاف الترجمة')); };
  m.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { subsShift(+b.dataset.sh); const o = m.querySelector('#sb-off-v'); if (o) o.textContent = (SUB.offset > 0 ? '+' : '') + SUB.offset.toFixed(1) + ' ' + T('ث'); });
  m.querySelectorAll('[data-sz]').forEach(b => b.onclick = () => { S.prefs.subSize = +b.dataset.sz; H.store.set('prefs', S.prefs); m.querySelectorAll('[data-sz]').forEach(x => x.classList.toggle('on', x === b)); subsEl(); });
  m.querySelectorAll('[data-sl]').forEach(b => b.onclick = () => { S.prefs.subLang = b.dataset.sl; H.store.set('prefs', S.prefs); m.querySelectorAll('[data-sl]').forEach(x => x.classList.toggle('on', x === b)); });
  wirePlayerTabs(m);
  paintIcons();
}
// keyboard (Windows) / remote: G / H = subtitle timing −/+ 0.1 s (same keys as VLC)
document.addEventListener('keydown', e => {
  if (!visible('player') || !SUB.cues.length || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
  const k = e.key.toLowerCase(); if (k === 'g') { subsShift(-0.1); e.preventDefault(); } else if (k === 'h') { subsShift(0.1); e.preventDefault(); }
});

// =====================================================================================
// 6.0 web-int7 — prayer/Ramadan runtime, phone remote, floating focus highlight + ambient tint
// =====================================================================================
// ---- F21 prayer: HK_prayer.watch() -> small top-corner banner (no focus steal), VOD pause + resume
// at the same second on OK/after 4 min, live mute for the beep. One timer to the next event (no polling). ----
let PRAYER = { pausedAt: null, muted: false };
function hkPrayerBoot() {
  if (!window.HK_prayer) return;
  HK_prayer.unwatch();
  const s = HK_prayer.settings();
  $('#prayer-banner').classList.add('hidden');
  if (!s.on || !s.city) return;
  HK_prayer.watch(ev => hkPrayerEvent(ev));
}
function hkPrayerEvent(ev) {
  const s = HK_prayer.settings();
  const names = { Fajr: T('الفجر'), Sunrise: T('الشروق'), Dhuhr: T('الظهر'), Asr: T('العصر'), Maghrib: T('المغرب'), Isha: T('العشاء') };
  const label = names[ev.name] || ev.name;
  const banner = $('#prayer-banner'); banner.textContent = T('حان الآن وقت صلاة ') + label; banner.classList.remove('hidden');
  clearTimeout(banner._t); banner._t = setTimeout(() => banner.classList.add('hidden'), 20000);
  if (ev.name === 'Sunrise') return;   // sunrise is informational only, no pause/mute/adhan
  if (visible('player')) {
    if (ctx.live) {
      if (s.adhan === 'beep') { PRAYER.muted = true; const wasMuted = video.muted; video.muted = true; setTimeout(() => { if (PRAYER.muted) { video.muted = wasMuted; PRAYER.muted = false; } }, 90000); }
    } else if (s.pauseVod && !video.paused) {
      PRAYER.pausedAt = video.currentTime; video.pause();
      const resume = () => { if (PRAYER.pausedAt != null) { video.currentTime = PRAYER.pausedAt; video.play().catch(() => {}); PRAYER.pausedAt = null; } document.removeEventListener('keydown', onOk, true); clearTimeout(t4); };
      const onOk = e => { if (e.keyCode === KC.OK || e.key === 'Enter') resume(); };
      document.addEventListener('keydown', onOk, true);
      const t4 = setTimeout(resume, 4 * 60000);
    }
  }
}
// ---- Ramadan shelf (home) + iftar/imsak line — built from the user's own library only ----
function ramadanShelfItems() {
  if (!window.HK_prayer) return [];
  const r = HK_prayer.ramadan(new Date()); if (!r.on) return [];
  const mv = ((S.catalog.movies || {}).items) || []; const KEY_RE = /رمضان|ramadan/i;
  return uniq(mv.filter(i => KEY_RE.test(i.name) || KEY_RE.test(i.categoryName || ''))).slice(0, 30);
}
function ramadanLine() {
  if (!window.HK_prayer) return '';
  const r = HK_prayer.ramadan(new Date()); if (!r.on) return '';
  const s = HK_prayer.settings(); if (!s.city) return T('رمضان كريم — يوم ') + r.day;
  const t = HK_prayer.times(new Date(), s.city); if (!t) return T('رمضان كريم — يوم ') + r.day;
  const hm = d => d.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
  return `${T('رمضان كريم — يوم')} ${r.day} · ${T('الإمساك')} ${hm(t.imsak)} · ${T('الإفطار')} ${hm(t.maghrib)}`;
}
// hooks into homeShelves()'s existing pipeline via a thin wrapper (keeps homeShelves() itself untouched)
const homeShelvesOrig = homeShelves;
homeShelves = function () {
  const list = homeShelvesOrig();
  if (!S.query) { const rm = ramadanShelfItems(); if (rm.length) list.unshift([T('رمضان'), rm]); }
  return list;
};
function prayerCityMenu(after) {
  const cities = window.HK_prayer ? HK_prayer.cities() : [];
  const cur = HK_prayer.settings().city;
  const m = modal(`<h3>${T('اختر المدينة')}</h3><input id="pc-q" placeholder="${T('ابحث…')}"><div class="list" id="pc-list"></div>`);
  const render = q => { const list = cities.filter(c => !q || c.name.includes(q) || (c.nameEn || '').toLowerCase().includes(q.toLowerCase())).slice(0, 200);
    m.querySelector('#pc-list').innerHTML = list.map(c => `<div class="ep" data-id="${esc(c.id || c.name)}">${cur && cur.name === c.name ? '✓ ' : ''}${esc(c.name)}</div>`).join('') || T('<div class="muted">لا توجد نتائج</div>');
    m.querySelectorAll('.ep').forEach(el => el.onclick = () => { const city = cities.find(c => (c.id || c.name) === el.dataset.id); HK_prayer.save({ city }); closeModal(); if (after) after(); }); };
  render(''); m.querySelector('#pc-q').oninput = e => render(e.target.value.trim());
}
// ---- F21 phone remote: start() -> code + QR (qrcode.js), stop on dialog close; commands become
// synthetic KeyboardEvents fed to the existing document keydown handler (DIRS/KC in this file). ----
function hkQrImgTag(text) {
  try {
    for (let tn = 2; tn <= 10; tn++) { try { const q = qrcode(tn, 'M'); q.addData(text); q.make(); return q.createImgTag(4, 0); } catch (e) { continue; } }
  } catch (e) {}
  return '';
}
function phoneRemoteMenu() {
  if (!window.HK_remote) return toast(T('ريموت الموبايل غير متاح'));
  HK_remote.start().then(({ code, qrUrl }) => {
    const m = modal(`<h3>${T('ريموت الموبايل')}</h3><p class="muted">${T('افتح الكاميرا أو امسح الرمز، أو أدخل الكود على')} sohbatna.com/r</p>
      <div class="hk6-remote-qr">${hkQrImgTag(qrUrl)}</div><div class="hk6-remote-code" dir="ltr">${esc(code)}</div>
      <p class="muted">${T('الريموت يفضل شغال بعد ما تقفل النافذة')}</p>
      <div class="btns"><button class="chip" id="rm-close">${T('إغلاق')}</button><button class="chip" id="rm-stop">${T('إيقاف الريموت')}</button></div>`);
    m.querySelector('#rm-close').onclick = closeModal;
    m.querySelector('#rm-stop').onclick = () => { HK_remote.stop(); closeModal(); toast(T('الريموت اتقفل')); };
  }).catch(() => toast(T('تعذر بدء الربط')));
}
// 7.0.2: closing the dialog keeps the session — 6.0 stopped it here, so the phone could never drive the app.
// It stops on «Stop remote», after 30 idle minutes (remote6.js) or when the app closes.
if (window.HK_remote) {
  HK_remote.onCommand((cmd, arg) => {
    const fire = (keyCode, key) => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode, which: keyCode, key, bubbles: true }));
    const KEY_OF = { up: 38, down: 40, left: 37, right: 39, ok: 13, back: 461, playpause: 179, home: null };
    if (cmd === 'home') { if (visible('player')) closePlayer(); show('home'); switchSection('home'); return; }
    if (cmd === 'next') return visible('player') && ctx.live ? zap(1) : fire(39, 'ArrowRight');
    if (cmd === 'prev') return visible('player') && ctx.live ? zap(-1) : fire(37, 'ArrowLeft');
    if (cmd === 'text' && typeof arg === 'string') { show('home'); switchSection('home'); const s = $('#search'); s.value = arg.slice(0, 100); s.dispatchEvent(new Event('input')); return; }
    if (cmd === 'digit' && typeof arg === 'string') cmd = 'digit:' + arg;   // server sends {cmd:'digit', arg:'5'}
    if (typeof cmd === 'string' && cmd.indexOf('digit:') === 0) { const d = +cmd.slice(6); if (!isNaN(d)) { if (visible('player') && ctx.live) numKey(d); else { show('home'); switchSection('home'); } } return; }
    if (cmd === 'vol+') return setVolume(video.volume + .05); if (cmd === 'vol-') return setVolume(video.volume - .05); if (cmd === 'mute') return toggleMute();
    const kc = KEY_OF[cmd]; if (kc != null) fire(kc, cmd);
  });
}

// ---- decision 0.33: ONE floating focus highlight that follows the focused/hovered card, plus an
// ambient background tint sampled once from the poster (fx-full only; fx-lite keeps a static hero tint,
// fx-off disables both and the per-card CSS ring takes over instead — see screens6.css). ----
const TINT_CACHE = {};
function hkSampleTint(url, cb) {
  if (!url) return;
  if (TINT_CACHE[url]) return cb(TINT_CACHE[url]);
  if (TINT_CACHE[url] === null) return;   // a previous attempt failed (tainted canvas) — don't retry every hover
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => { try {
    const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data; let best = null, bs = -1;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], b = d[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0, sc = sat * (mx / 255);
      if (mx > 60 && sc > bs) { bs = sc; best = [r, gg, b]; } }
    if (!best || bs < .18) { TINT_CACHE[url] = null; return; }
    const mx = Math.max(...best), k = 225 / mx; const rgb = best.map(v => Math.min(255, Math.round(v * k)));
    TINT_CACHE[url] = rgb; cb(rgb);
  } catch (e) { TINT_CACHE[url] = null; } };
  img.onerror = () => { TINT_CACHE[url] = null; };
  img.src = url;
}
function hkFocusTargetOf(el) { return el && el.closest ? el.closest('.card, .m-slot') : null; }   // 6.0: the floating ring is for cards only (buttons keep their own focus style)
function hkPositionFocusRing(el) {
  const ring = $('#focus-ring'); if (!ring) return;
  hkRingEl = el;
  if (!el || !el.getBoundingClientRect || !el.isConnected || !el.offsetParent || visible('player') || !el.classList.contains('nav-hl') && document.activeElement !== el && !el.matches(':hover')) { ring.classList.remove('on'); document.documentElement.classList.remove('ring-on'); return; }
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) { ring.classList.remove('on'); return; }
  // size from the untransformed box × the focus scale the card is animating to (the rect is mid-transition here)
  const sc = el.classList.contains('row') || el.classList.contains('m-slot') ? 1 : (parseFloat   // 7.0.2: multi-screen slots never scale (the ring hung 5% off the tile)
    (getComputedStyle(el).getPropertyValue('--focus-scale')) || 1);
  const w = el.offsetWidth * sc, h = el.offsetHeight * sc, mx = r.left + r.width / 2, my = r.top + r.height / 2;
  ring.style.width = w + 'px'; ring.style.height = h + 'px';
  ring.style.transform = `translate(${mx - w / 2}px, ${my - h / 2}px)`; ring.classList.add('on'); document.documentElement.classList.add('ring-on');
  if (!document.documentElement.classList.contains('fx-full')) return;
  const img = el.tagName === 'IMG' ? el : el.querySelector && el.querySelector('img');
  const glow = $('#ambient-glow'); if (!glow) return;
  const cx = (r.left + r.width / 2) / innerWidth * 100, cy = (r.top + r.height / 2) / innerHeight * 100;
  glow.style.setProperty('--glow-x', cx.toFixed(1) + '%'); glow.style.setProperty('--glow-y', cy.toFixed(1) + '%');
  if (img && img.src) hkSampleTint(img.src, rgb => glow.style.setProperty('--glow-rgb', rgb.join(',')));
  glow.classList.add('on');
}
let focusRingRaf = 0, hkRingEl = null;

let focusRingNext = null;
function hkScheduleFocusRing(el) { focusRingNext = el; if (focusRingRaf) return; focusRingRaf = requestAnimationFrame(() => { focusRingRaf = 0; hkPositionFocusRing(focusRingNext); }); }
document.addEventListener('focusin', e => hkScheduleFocusRing(hkFocusTargetOf(e.target)));
document.addEventListener('mouseover', e => { const t = hkFocusTargetOf(e.target); if (t) hkScheduleFocusRing(t); });
document.addEventListener('mouseleave', () => { const ring = $('#focus-ring'); if (ring && !document.activeElement) ring.classList.remove('on'); }, true);
// TV/remote navigation (spatial.js) marks the current item with class 'nav-hl' instead of real DOM focus;
// a MutationObserver only fires on an actual class change, so this is idle-cost-free (no polling).
new MutationObserver(muts => {
  for (const mu of muts) { if (mu.target.classList && (mu.target.classList.contains('nav-hl') || mu.oldValue && mu.oldValue.indexOf('nav-hl') >= 0)) { hkScheduleFocusRing(hkFocusTargetOf(document.querySelector('.nav-hl'))); return; } }
}).observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
window.addEventListener('resize', () => hkScheduleFocusRing(hkFocusTargetOf(document.querySelector('.nav-hl') || document.activeElement)));
document.addEventListener('scroll', () => { if (hkRingEl) hkScheduleFocusRing(hkFocusTargetOf(document.querySelector('.nav-hl') || document.activeElement)); }, { passive: true, capture: true });
// 6.0 QA: a dead poster/logo host showed the browser's broken-image icon in the channel list — fall back to our mark
document.addEventListener('error', e => { const t = e.target; if (t && t.tagName === 'IMG' && !t.dataset.dead && t.closest('.card, .ch-row, .tile, .row')) { t.dataset.dead = '1'; t.src = 'icon.png'; t.classList.add('ph'); } }, true);
