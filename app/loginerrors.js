/* Sohbatna 7.1 validation pass — classifies sign-in (Xtream/M3U/MAC) and licence-activation failures
 * into a small, stable vocabulary of (Arabic, English, guide anchor) triples, so every error the app
 * can actually detect gets a specific cause + next-step message instead of a generic "could not
 * connect". Pure functions, no DOM — testable with plain node (see scripts/test-loginerrors.mjs).
 * Mirrors android/.../LoginErrors.java key-for-key; keep the two in sync.
 * Loaded after i18n.js (uses T / I18N.lang).
 */
(function (root) {
  'use strict';

  var GUIDE_BASE = 'https://sohbatna.com/guides/';

  function info(key, ar, en, anchor) {
    var helpUrl = anchor ? GUIDE_BASE + anchor : '';
    return {
      key: key, ar: ar, en: en, anchor: anchor || '', helpUrl: helpUrl,
      // bilingual short line only. 7.1 fix: read I18N.lang directly instead of looking `ar` up in the
      // T() dictionary (i18n.js) — that lookup silently falls back to the raw Arabic string for any
      // English user whenever the two didn't share the exact same punctuation (confirmed for 'banned'
      // and 'rate_limited'). `en`/`ar` are already known here; no dictionary round-trip is needed.
      line: function () { return (typeof I18N !== 'undefined' && I18N.lang === 'en') ? en : ar; },
      // short line + a "شوف الشرح" / "See the guide" action with the URL (caller renders it as a link)
      lineWithAction: function () {
        var msg = this.line();
        if (!helpUrl) return msg;
        var en2 = typeof I18N !== 'undefined' && I18N.lang === 'en';
        var action = en2 ? 'See the guide' : 'شوف الشرح';
        return msg + '\n' + action + ' \u2192 ' + helpUrl;
      }
    };
  }

  // ---- network-level classification from a caught Error's name/message ----
  function forException(err) {
    var name = (err && err.name) || '';
    var msg = String((err && err.message) || err || '');
    var m = msg.toLowerCase();
    if (/failed to fetch|networkerror|net::err_internet_disconnected|net::err_name_not_resolved|getaddrinfo|enotfound/.test(m))
      return info('dns', 'تعذر العثور على السيرفر — تأكد من كتابة الرابط صحيحاً أو أن مزوّدك لم يغيّره.',
        'Could not find the server — check the address is typed correctly, or ask your provider if it changed.', 'troubleshooting#no-internet');
    if (name === 'AbortError' || /timed? ?out|etimedout/.test(m))
      return info('timeout', 'السيرفر لا يستجيب (انتهت مهلة الاتصال) — جرّب مرة أخرى أو تأكد من اتصالك بالإنترنت.',
        'The server is not responding (connection timed out) — try again, or check your internet.', 'troubleshooting#no-internet');
    if (/ssl|certificate|cert_|handshake/.test(m))
      return info('ssl', 'تعذر تأمين الاتصال بالسيرفر (مشكلة SSL/الشهادة) — تحقق من الرابط (http:// أو https://).',
        'Could not secure the connection to the server (SSL/certificate problem) — check the link (http:// or https://).', 'troubleshooting#bad-url');
    if (/invalid url|failed to construct.*url|failed to parse url|no protocol/.test(m))
      return info('bad_url', 'رابط السيرفر غير صحيح — تأكد أنه يبدأ بـ http:// أو https:// وبدون مسافات.',
        'The server URL is not valid — make sure it starts with http:// or https:// and has no spaces.', 'troubleshooting#bad-url');
    if (/connection refused|net::err_connection_refused|network is unreachable|econnrefused|enetunreach/.test(m))
      return info('no_internet', 'تعذر الوصول إلى الإنترنت أو السيرفر — تحقق من اتصال الجهاز بالإنترنت.',
        'Could not reach the internet or the server — check your device\u2019s internet connection.', 'troubleshooting#no-internet');
    return info('net', 'تعذر الاتصال بالسيرفر.', 'Could not reach the server.', 'troubleshooting#no-internet');
  }

  // ---- HTTP status classification ----
  function forHttpStatus(code) {
    if (code === 401 || code === 403)
      return info('wrong_login', 'اسم المستخدم أو كلمة المرور غير صحيحة.', 'Wrong username or password.', 'troubleshooting#wrong-login');
    if (code === 404)
      return info('not_found', 'رابط السيرفر غير موجود (404) — تأكد من الرابط مع مزوّدك.', 'The server URL was not found (404) — confirm the address with your provider.', 'troubleshooting#bad-url');
    if (code >= 500)
      return info('server_error', 'السيرفر لا يستجيب الآن (خطأ من جهة السيرفر) — جرّب بعد قليل.', 'The server is not responding right now (a server-side error) — try again shortly.', 'troubleshooting#no-internet');
    return info('http_' + code, 'خطأ من السيرفر: HTTP ' + code, 'Server error: HTTP ' + code, 'troubleshooting#no-internet');
  }

  // ---- Xtream user_info classification: auth flag, status, active_cons/max_connections ----
  function forXtreamUserInfo(userInfo) {
    var u = userInfo || {};
    var validAuth = String(u.auth) === '1' || u.auth === true;
    if (!validAuth)
      return info('wrong_login', 'بيانات الدخول غير صحيحة — تأكد من اسم المستخدم وكلمة المرور كما أرسلها المزوّد.',
        'Wrong login details — check the username and password exactly as your provider sent them.', 'troubleshooting#wrong-login');
    var st = String(u.status || '').trim().toLowerCase();
    if (st === 'expired' || st === 'disabled' || st === 'banned')
      return info('provider_expired', 'اشتراكك عند المزوّد منتهي أو موقوف — تواصل مع مزوّد الاشتراك (نحن لا نبيع محتوى).',
        'Your subscription with the provider has expired or is disabled — contact your subscription provider (we do not sell content).', 'troubleshooting#provider-expired');
    var active = parseInt(u.active_cons, 10) || 0, max = parseInt(u.max_connections, 10) || 0;
    if (max > 0 && active >= max)
      return info('max_connections', 'عدد الاتصالات المسموح بها عند مزوّدك مستخدم بالكامل — أغلق جهازاً آخر يستخدم نفس الاشتراك ثم أعد المحاولة.',
        'Your provider\u2019s allowed connections are all in use — close another device using the same subscription, then try again.', 'troubleshooting#max-connections');
    return null;   // valid
  }

  // ---- M3U/HTML-content and empty-playlist classification ----
  function forPlaylist(totalChannels, looksLikeHtml) {
    if (looksLikeHtml)
      return info('invalid_content', 'الرابط لا يرجع قائمة M3U (رجع صفحة ويب) — تأكد من الرابط مع مزوّدك.',
        'The link did not return an M3U playlist (it returned a web page) — confirm the link with your provider.', 'troubleshooting#bad-url');
    if (!totalChannels || totalChannels <= 0)
      return info('empty_playlist', 'القائمة فارغة ولا تحتوي على أي قناة — تأكد من الرابط مع مزوّدك.',
        'The playlist is empty — it has no channels. Confirm the link with your provider.', 'troubleshooting#empty-playlist');
    return null;
  }

  // ---- licence/activation error key -> bilingual message + guide anchor ----
  var MAX_DEVICES_MSG_AR = 'الكود مفعّل على كل الأجهزة المسموحة. أزل جهازاً قديماً من «صفحة اشتراكي» أو زوّد عدد الأجهزة.';
  function forLicenseKey(key) {
    switch (key) {
      case 'bad_code': return info(key, 'الكود غير صحيح — تأكد من كتابته كما استلمته (12 حرفاً ورقماً).',
        'The code is not correct — check it matches exactly what you received (12 letters/digits).', 'family#bad-code');
      case 'expired_code': return info(key, 'انتهت صلاحية هذا الكود.', 'This code has expired.', 'family#code-expired');
      case 'code_redeem_expired': return info(key, 'انتهت فترة تفعيل هذا الكود قبل استخدامه لأول مرة — اطلب كوداً جديداً.',
        'This code\u2019s activation window ended before it was ever used — request a new code.', 'family#code-redeem-expired');
      case 'max_devices': return info(key, MAX_DEVICES_MSG_AR,
        'The code is already active on every device it allows. Remove an old device from "My subscription", or increase the device count.', 'family#device-limit');
      case 'banned': return info(key, 'تم إيقاف هذا الجهاز. تواصل مع الدعم.', 'This device has been suspended. Contact support.', '');
      case 'rate_limited': return info(key, 'محاولات كثيرة، حاول بعد دقيقة.', 'Too many attempts, try again in a minute.', '');
      case 'net': return info(key, 'تعذر الاتصال بخادم الاشتراك.', 'Could not reach the licence server.', 'troubleshooting#no-internet');
      default: return info(key || 'unknown', 'تعذر التفعيل.', 'Could not activate.', '');
    }
  }

  root.HK_loginErrors = {
    forException: forException,
    forHttpStatus: forHttpStatus,
    forXtreamUserInfo: forXtreamUserInfo,
    forPlaylist: forPlaylist,
    forLicenseKey: forLicenseKey,
    MAX_DEVICES_MSG_AR: MAX_DEVICES_MSG_AR
  };
})(typeof window !== 'undefined' ? window : this);
