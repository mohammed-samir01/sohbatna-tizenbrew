/* Sohbatna licence (5.12.0) — 14-day trial, then a monthly/yearly subscription.
 * 5.15: one subscription comes in device tiers (server `plans`): Personal (2 devices) and Family (5 devices), each monthly
 * or yearly. Payment is a manual InstaPay transfer on the website: the app only opens payUrl (buy / renew) and upgradeUrl
 * (personal → family, more devices); support is email only (`support.email`). The server always sends
 * `support.whatsapp` = '' now; no UI in this file reads it any more. New fields are optional (old server works).
 * Server (5.12): the Laravel app at https://sohbatna.com (server/, API_BASE below):
 *   POST lic {dev, plat, v} → {state:'trial'|'active'|'expired', trialEnd, exp, plan, code, devs, maxDevices, prices, payUrl, accountUrl, enforce, banned?, now}
 *     5.15 optional: plans[{key, tier, period, egp, days, devices}], tier, upgradeUrl, support{whatsapp, email}
 *   POST lic/activate {dev, code} → same + error ('bad_code' | 'expired_code' | 'max_devices' | 'banned')
 * Apps <= 5.11 still call n8n's hooksha-lic*, which is now a thin proxy to the same API (n8n/build_license_wf.js buildProxy).
 * Payment pages (payUrl / upgradeUrl) open in the browser; the TV shows them as QR codes for the phone.
 * Identical behaviour on Android: Licence.java. Loaded after app.js (uses S, H, feed, modal, T, TV, …). */
const API_BASE = 'https://sohbatna.com/api/v1/';   // 7.0.4: new host
const SUPPORT_EMAIL = 'support@sohbatna.com';
const MAX_DEVICES_MSG = 'الكود مفعّل على كل الأجهزة المسموحة. أزل جهازاً قديماً من «صفحة اشتراكي» أو زوّد عدد الأجهزة.';
const api = (name, opts = {}) => { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  return fetch(API_BASE + name, Object.assign({}, opts, { signal: ctl.signal })).finally(() => clearTimeout(t)); };
const LIC_PLAT = TV ? 'l' : 'w';                        // device id prefix: l = LG webOS, w = Windows, a = Android
const LIC_GRACE = 3 * 864e5;                            // offline: trust the last answer for 3 days past its end
let LIC = null;                                         // last server answer (+ at = local time it arrived)

async function licDev() {
  let d = await H.store.get('licDev');
  if (!/^[a-z]-[0-9a-f]{16}$/.test(d || '')) {
    const b = new Uint8Array(8); crypto.getRandomValues(b);
    d = LIC_PLAT + '-' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    await H.store.set('licDev', d);
  }
  return d;
}
const DEMO_RE = /\/webhook\/hooksha-demo\b|^(https?:\/\/)?(www\.)?(sohbatna\.com|sohbatna\.mirqaa\.com|hooksha\.mirqaa\.com)(:\d+)?\/demo-server\b/i;   // 7.0.10: any of our hosts
const licDemo = () => !!(S.profile && DEMO_RE.test(String(S.profile.server).trim()));   // Play review account: never locked
function licState() {
  if (!LIC) return 'unknown';
  // exp / trialEnd are already on the local clock (licCall); offline answers get a 3-day grace
  const now = Date.now(), g = LIC.offline ? LIC_GRACE : 0;
  if (LIC.exp && LIC.exp + g > now) return 'active';
  if (LIC.trialEnd + g > now) return 'trial';
  return 'expired';
}
const licBlocked = () => !licDemo() && !!S.profile && licState() === 'expired';
const licDays = ms => Math.max(0, Math.ceil((ms - Date.now()) / 864e5));

async function licCall(path, body) {
  const r = await api(path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ dev: await licDev(), plat: LIC_PLAT, v: APP_VERSION }, body || {})) });
  const j = await r.json();
  if (!j || !j.state) throw new Error(j && j.error || 'bad reply');
  j.at = Date.now(); j.trialEnd = j.trialEnd - j.now + j.at; if (j.exp) j.exp = j.exp - j.now + j.at;   // to local clock
  return j;
}
async function licCheck(manual) {
  if (!LIC) { LIC = await H.store.get('lic'); if (LIC) LIC.offline = true; }
  try { LIC = await licCall('lic'); H.store.set('lic', LIC); }
  catch (e) { logError('Licence', e); if (LIC) LIC.offline = true; if (manual) toast(T('تعذر الاتصال بخادم الاشتراك')); }
  licApply();
  return LIC;
}
function licApply() {
  if (licBlocked()) { if (visible('player')) closePlayer(); if (!S.licLock) licMenu(); }
  else if (S.licLock) { S.licLock = false; closeModal(); toast(T('تم تفعيل الاشتراك')); }
  else if (LIC && licState() === 'trial' && !licDemo()) {   // once a day in the last 3 days of the trial
    const left = licDays(LIC.trialEnd), today = new Date().toDateString();
    if (LIC.enforce !== false && left <= 3 && S.prefs.licNag !== today) { S.prefs.licNag = today; H.store.set('prefs', S.prefs); toast(T('الفترة التجريبية تنتهي خلال') + ' ' + left + ' ' + T('يوم'), 5000); }
  }
}
// 5.15 device tiers — same rules as Licence.java (devicesText, tierOf, planLabel, maxDevices, priceLines, upgradeHint)
function licDevices(n) {                                 // ar: جهاز واحد · جهازان · 3-10 أجهزة · 11+ جهازاً; en: 1 device / N devices
  if (I18N.lang === 'en') return n === 1 ? '1 device' : n + ' devices';
  return n === 1 ? 'جهاز واحد' : n === 2 ? 'جهازان' : n + (n >= 3 && n <= 10 ? ' أجهزة' : ' جهازاً');
}
const licYearly = k => /yearly$/.test(k || '');
function licTier(j) {
  if (j.tier === 'personal' || j.tier === 'family') return j.tier;
  const p = String(j.plan || '');
  return /^family/.test(p) ? 'family' : (p === 'monthly' || p === 'yearly') ? 'personal' : '';
}
const licTierName = t => t === 'family' ? T('عائلي') : t === 'personal' ? T('شخصي') : '';
function licPlanLabel(j) { const t = licTierName(licTier(j)), per = T(licYearly(j.plan) ? 'سنوي' : 'شهري'); return t ? t + ' · ' + per : per; }
function licMax(j) {                                     // never assume 5: maxDevices, else the plan's devices, else unknown (0)
  if (j.maxDevices > 0) return j.maxDevices;
  const p = (Array.isArray(j.plans) ? j.plans : []).find(x => x && x.key === j.plan && x.devices > 0);
  return p ? p.devices : 0;
}
function licPriceLines(j) {
  const tiers = [], v = {};
  (j && Array.isArray(j.plans) ? j.plans : []).forEach(p => {
    if (!p) return;
    const key = String(p.key || ''), tier = p.tier || (/^family/.test(key) ? 'family' : 'personal');
    if (!v[tier]) { tiers.push(tier); v[tier] = { dev: 0, m: 0, y: 0 }; }
    if (!v[tier].dev) v[tier].dev = p.devices || 0;
    v[tier][(p.period || (licYearly(key) ? 'yearly' : 'monthly')) === 'yearly' ? 'y' : 'm'] = p.egp || 0;
  });
  const out = [];
  tiers.forEach(t => {
    const x = v[t]; if (!x.m && !x.y) return;
    out.push((licTierName(t) || t) + (x.dev ? ' · ' + licDevices(x.dev) : '') + ':' + (x.m ? ' ' + T('شهري') + ' ' + x.m + ' ' + T('جنيه') : '') + (x.m && x.y ? ' ·' : '') + (x.y ? ' ' + T('سنوي') + ' ' + x.y + ' ' + T('جنيه') : ''));
  });
  if (!out.length) {                                     // old server: monthly/yearly from prices, no device count
    const p = (j && j.prices) || {}, m = (p.monthly && p.monthly.egp) || 29, y = (p.yearly && p.yearly.egp) || 199;
    out.push(T('شهري') + ' ' + m + ' ' + T('جنيه') + ' · ' + T('سنوي') + ' ' + y + ' ' + T('جنيه'));
  }
  return out;
}
function licUpgradeHint(j) {
  const f = (Array.isArray(j.plans) ? j.plans : []).find(p => p && (p.tier === 'family' || /^family/.test(p.key || '')));
  return f && f.devices ? T('الباقة العائلية: حتى') + ' ' + licDevices(f.devices) + ' ' + T('بنفس الكود') : T('الباقة العائلية: أجهزة أكثر بنفس الكود');
}
function licLine() {
  const st = licState();
  if (licDemo()) return T('حساب تجريبي — كل الميزات متاحة');
  if (LIC && LIC.banned) return T('تم إيقاف هذا الجهاز. تواصل مع الدعم:') + ' ' + SUPPORT_EMAIL;
  if (st === 'active') { const mx = licMax(LIC); return (LIC.plan === 'owner' ? T('مفعّل') : T('مشترك') + ' (' + licPlanLabel(LIC) + ')') + (LIC.plan === 'owner' ? '' : ' ' + T('حتى') + ' ' + new Date(LIC.exp).toLocaleDateString(LOC)) + (LIC.devs ? ' · ' + T('الأجهزة:') + ' ' + LIC.devs + (mx ? '/' + mx : '') : ''); }
  if (st === 'trial' && LIC.enforce === false && licDays(LIC.trialEnd) <= 1) return T('الفترة التجريبية');   // not live yet
  if (st === 'trial') return T('الفترة التجريبية: متبقٍ') + ' ' + licDays(LIC.trialEnd) + ' ' + T('يوم');
  if (st === 'expired') return T(LIC.exp ? 'انتهى الاشتراك' : 'انتهت الفترة التجريبية');
  return T('جارٍ التحقق من الاشتراك…');
}
function licQr(url, alt) {
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createImgTag(TV ? 5 : 4, 8, T(alt || 'رمز الدفع')); } catch (e) { return ''; }
}
async function licMenu() {
  if (!LIC) await licCheck();
  const st = licState(), locked = licBlocked();
  S.licLock = locked;
  const pay = LIC && LIC.payUrl, acc = LIC && LIC.accountUrl, banned = !!(LIC && LIC.banned), up = LIC && LIC.upgradeUrl;
  const showBuy = !banned && !licDemo() && (st !== 'active' || LIC.plan !== 'owner');   // same rule as Licence.java (minus the Play check)
  const payOpen = !(LIC && LIC.payOpen === false);   // 5.12.1: server can close payments (missing = open)
  const showUp = !!up && payOpen && !banned && !licDemo();   // 5.15: more devices (personal → family) on an active paid licence
  const m = modal(`<h3>${ic('gauge')} ${T('الاشتراك')}</h3>
    ${locked && !banned ? `<div class="lic-warn">${T('انتهت الفترة التجريبية. اشترك للاستمرار في استخدام التطبيق، أو أدخل كود التفعيل إن كان لديك اشتراك.')}</div>` : ''}
    <div class="lic-state ${st}">${licLine()}</div>
    ${LIC && LIC.code && st === 'active' ? `<div class="muted">${T('كود التفعيل لأجهزتك الأخرى:')} <b class="lic-code">${esc(LIC.code)}</b></div>` : ''}
    ${showBuy && pay && !payOpen ? `<div class="muted lic-soon">${T('الاشتراك المدفوع يُفتح قريباً. استمتع بالفترة التجريبية المجانية.')}</div>` : ''}
    ${showBuy && pay && payOpen ? `<div class="section">${T('الباقات')}</div>
      ${licPriceLines(LIC).map(l => `<div class="muted">${esc(l)}</div>`).join('')}
      ${TV ? `<div class="lic-qr">${licQr(pay)}<div class="muted">${T('امسح الرمز بكاميرا هاتفك لإتمام الدفع، ثم اضغط «تحديث الحالة».')}</div></div>`
           : `<button class="opt primary-opt" id="lic-buy">${ic('play')} ${st === 'active' ? T('تجديد الاشتراك') : T('اشترك الآن')}</button>`}` : ''}
    ${showUp ? `<div class="section">${T('زيادة عدد الأجهزة')}</div>
      <div class="muted">${esc(licUpgradeHint(LIC))}</div>
      ${TV ? `<div class="lic-qr">${licQr(up)}<div class="muted">${T('امسح الرمز بكاميرا هاتفك لزيادة عدد الأجهزة، ثم اضغط «تحديث الحالة».')}</div></div>`
           : `<button class="opt" id="lic-up">${ic('gauge')} ${T('زيادة عدد الأجهزة')}</button>`}` : ''}
    ${acc && !banned ? `<div class="section">${T('اشتراكي')}</div>
      <div class="muted">${T('اعرف تاريخ الانتهاء والأجهزة المفعّلة، أو أرسل الكود إلى بريدك.')}</div>
      ${TV ? `<div class="lic-qr">${licQr(acc)}<div class="muted">${esc(acc.replace(/^https?:\/\//, ''))}</div></div>`
           : `<button class="opt" id="lic-acc">${ic('gauge')} ${T('صفحة اشتراكي')}</button>`}` : ''}
    <div class="section">${T('لديك كود تفعيل؟')}</div>
    <div class="lic-row"><input id="lic-in" maxlength="16" placeholder="XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false"><button class="opt" id="lic-go">${T('تفعيل')}</button></div>
    <div class="muted" id="lic-msg"></div>
    <div class="btns"><button class="chip" id="lic-ref">${T('تحديث الحالة')}</button>${locked ? '' : `<button class="chip" id="lic-close">${T('إغلاق')}</button>`}</div>
    <div class="muted lic-dev">${T('رقم الجهاز:')} ${esc(await licDev())}</div>`);
  const buy = m.querySelector('#lic-buy'); if (buy) buy.onclick = () => H.openExternal(pay);
  const accB = m.querySelector('#lic-acc'); if (accB) accB.onclick = () => H.openExternal(acc);
  const upB = m.querySelector('#lic-up'); if (upB) upB.onclick = () => H.openExternal(up);
  m.querySelector('#lic-ref').onclick = async () => { $('#lic-msg').textContent = T('جارٍ التحقق…'); await licCheck(true); if (!S.licLock || licBlocked()) licMenu(); };
  const c = m.querySelector('#lic-close'); if (c) c.onclick = closeModal;
  m.querySelector('#lic-go').onclick = async () => {
    const code = $('#lic-in').value.trim(); const msg = $('#lic-msg');
    if (code.replace(/[^A-Za-z0-9]/g, '').length !== 12) { msg.textContent = T('الكود يتكون من 12 حرفاً ورقماً'); return; }
    msg.textContent = T('جارٍ التفعيل…');
    try {
      const j = await licCall('lic/activate', { code });
      LIC = j; H.store.set('lic', LIC);
      if (j.error) {
        const info = window.HK_loginErrors ? HK_loginErrors.forLicenseKey(j.error) : null;
        const line = (info ? info.line() : (T({ bad_code: 'الكود غير صحيح', expired_code: 'انتهت صلاحية هذا الكود', max_devices: MAX_DEVICES_MSG, banned: 'تم إيقاف هذا الجهاز. تواصل مع الدعم:', rate_limited: 'محاولات كثيرة، حاول بعد دقيقة' }[j.error] || 'تعذر التفعيل'))) + (j.error === 'banned' ? ' ' + SUPPORT_EMAIL : '');
        if (info && info.helpUrl && TV) {   // LG/TV cannot easily open a browser: show the URL text + a QR (same pattern as payUrl/upgradeUrl)
          msg.innerHTML = `${esc(line)}<div class="lic-qr">${licQr(info.helpUrl, 'شوف الشرح')}<div class="muted">${esc(info.helpUrl)}</div></div>`;
        } else if (info && info.helpUrl) {   // Windows/desktop: a clickable action line
          msg.innerHTML = `${esc(line)}<div><a href="#" class="lic-help-link">${esc(T('شوف الشرح'))}</a></div>`;
          const link = msg.querySelector('.lic-help-link'); if (link) link.onclick = ev => { ev.preventDefault(); H.openExternal(info.helpUrl); };
        } else {
          msg.textContent = line;
        }
        return;
      }
      S.licLock = false; closeModal(); toast(T('تم تفعيل الاشتراك')); licMenu();
    } catch (e) { logError('Licence', e); msg.textContent = T(e.message === 'rate_limited' ? 'محاولات كثيرة، حاول بعد دقيقة' : 'تعذر الاتصال بخادم الاشتراك'); }
  };
}
