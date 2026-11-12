/* Sohbatna 6.0 — Prayer / Ramadan module (window.HK_prayer), contract: docs/redesign-6.0/CONTRACT.md "Wave 5".
 *
 * Astronomy core (clean-room, see docs/redesign-6.0/PRAYER-SOURCES.md for full detail): solar
 * declination and the equation of time are computed from the NOAA Solar Calculator's published
 * formulas (NOAA/ESRL, a U.S. government work, public domain — https://gml.noaa.gov/grad/solcalc/
 * and https://gml.noaa.gov/grad/solcalc/solareqns.PDF), via the SolarCalc helper below
 * (declination()/eqOfTime()/hourAngle()). Per-prayer parameters are published facts, not expression:
 * Fajr/Isha twilight angles and the Isha-minutes variants are the standard method table (MWL/ISNA/
 * Egypt/Umm al-Qura/... — see e.g. Wikipedia "Islamic hadith on time" / any muwaqqit reference); the
 * Asr shadow-length formula (altitude = arccot(factor + tan(|lat-decl|)), factor 1 or 2) is the
 * textbook Shafi'i/Hanafi Asr definition (Wikipedia "Asr prayer" / "Salah times"); the Morocco +5 min
 * Dhuhr/Maghrib offset reflects habous.gov.ma's official published times; the Umm al-Qura Ramadan
 * Isha override (+120 min instead of +90) is the Saudi Umm al-Qura calendar's published Ramadan rule.
 * Hijri (Umm al-Qura) date: public-domain arithmetic ("Kuwaiti") civil calendar formula, accurate to
 * ±1 day versus the official Umm al-Qura table (good enough for a Ramadan/holiday banner), unrelated
 * to the astronomy core above.
 */
(function (root) {
  'use strict';

  var METHODS = {
    MWL: { fajr: 18, isha: 17 },
    ISNA: { fajr: 15, isha: 15 },
    EGYPT: { fajr: 19.5, isha: 17.5 },
    MAKKAH: { fajr: 18.5, ishaMin: 90 },
    KARACHI: { fajr: 18, isha: 18 },
    TEHRAN: { fajr: 17.7, isha: 14, maghrib: 4.5, jafari: true },
    JAFARI: { fajr: 16, isha: 14, maghrib: 4, jafari: true },
    GULF: { fajr: 19.5, ishaMin: 90 },
    KUWAIT: { fajr: 18, isha: 17.5 },
    QATAR: { fajr: 18, ishaMin: 90 },
    SINGAPORE: { fajr: 20, isha: 18 },
    FRANCE: { fajr: 12, isha: 12 },
    TURKEY: { fajr: 18, isha: 17 },
    RUSSIA: { fajr: 16, isha: 15 },
    DUBAI: { fajr: 18.2, isha: 18.2 },
    JAKIM: { fajr: 20, isha: 18 },
    TUNISIA: { fajr: 18, isha: 18 },
    ALGERIA: { fajr: 18, isha: 17 },
    KEMENAG: { fajr: 20, isha: 18 },
    MOROCCO: { fajr: 19, isha: 17, dhuhrOffsetMin: 5, maghribOffsetMin: 5 },
    PORTUGAL: { fajr: 18, maghribMin: 3, ishaMin: 77 },
    JORDAN: { fajr: 18, maghribMin: 5, isha: 18 },
  };

  var UMM_AL_QURA_RAMADAN_ISHA_MIN = 120; // Official Umm al-Qura: +120 min in Ramadan instead of +90

  function dtr(d) { return (d * Math.PI) / 180; }
  function rtd(r) { return (r * 180) / Math.PI; }
  function fix(a, b) { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; }
  function fixHour(a) { return fix(a, 24); }

  // ---- SolarCalc: clean-room NOAA solar-position implementation (docs/redesign-6.0/PRAYER-SOURCES.md).
  // Equations transcribed from the NOAA Solar Calculator formula set (NOAA/ESRL, public domain):
  // https://gml.noaa.gov/grad/solcalc/calcdetails.html, https://gml.noaa.gov/grad/solcalc/solareqns.PDF.
  var SolarCalc = {
    // Julian Day Number at 00:00 UT of the given proleptic-Gregorian civil date.
    _julianDayNumber: function (year, month, day) {
      if (month <= 2) { year -= 1; month += 12; }
      var a = Math.floor(year / 100);
      var b = 2 - a + Math.floor(a / 4);
      return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
    },

    // Sun's apparent declination (deg) and the equation of time (minutes), near local noon of (y,m,d).
    of: function (year, month, day) {
      var jd = this._julianDayNumber(year, month, day) + 0.5; // noon UT reference instant
      var jc = (jd - 2451545.0) / 36525.0; // Julian century since J2000.0

      var geomMeanLongDeg = ((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360 + 360) % 360;
      var geomMeanAnomDeg = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
      var eccentricity = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

      var mRad = dtr(geomMeanAnomDeg);
      var sunEqOfCtr = Math.sin(mRad) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
        Math.sin(2 * mRad) * (0.019993 - 0.000101 * jc) +
        Math.sin(3 * mRad) * 0.000289;

      var sunTrueLongDeg = geomMeanLongDeg + sunEqOfCtr;
      var omegaDeg = 125.04 - 1934.136 * jc;
      var sunAppLongDeg = sunTrueLongDeg - 0.00569 - 0.00478 * Math.sin(dtr(omegaDeg));

      var meanObliqDeg = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
      var obliqCorrDeg = meanObliqDeg + 0.00256 * Math.cos(dtr(omegaDeg));

      var declRad = Math.asin(Math.sin(dtr(obliqCorrDeg)) * Math.sin(dtr(sunAppLongDeg)));

      var varY = Math.pow(Math.tan(dtr(obliqCorrDeg / 2)), 2);
      var glRad = dtr(geomMeanLongDeg);
      var eqTimeMinutes = 4 * rtd(
        varY * Math.sin(2 * glRad) -
        2 * eccentricity * Math.sin(mRad) +
        4 * eccentricity * varY * Math.sin(mRad) * Math.cos(2 * glRad) -
        0.5 * varY * varY * Math.sin(4 * glRad) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * mRad));

      return { declination: rtd(declRad), equation: eqTimeMinutes };
    },

    // Hour angle (deg) at which the sun reaches the given zenith angle (90 + altitude-below-horizon).
    hourAngle: function (latDeg, declDeg, zenithDeg) {
      var latRad = dtr(latDeg);
      var declRad = dtr(declDeg);
      var cosH = Math.cos(dtr(zenithDeg)) / (Math.cos(latRad) * Math.cos(declRad)) - Math.tan(latRad) * Math.tan(declRad);
      if (cosH > 1) cosH = 1;   // polar night: sun never reaches this zenith — clamp
      if (cosH < -1) cosH = -1; // polar day: sun never leaves this zenith — clamp
      return rtd(Math.acos(cosH));
    },
  };

  // ---- Calculator: builds all eight raw times from SolarCalc + the method/city parameters ----
  function Calculator(lat, lng, y, m, d, tzOffsetHours, cfg, school, ramadan) {
    var asrFactor = school === 'HANAFI' ? 2 : 1;

    this.compute = function () {
      var sun = SolarCalc.of(y, m, d);
      var decl = sun.declination;

      // Apparent solar noon, in minutes from local-clock midnight (NOAA solareqns.PDF solar-noon eq).
      var solarNoonMin = 720 - 4 * lng - sun.equation + tzOffsetHours * 60;

      var standardHorizonZenith = 90.833; // 90 + atmospheric refraction/solar-radius dip

      var haSunriseSet = SolarCalc.hourAngle(lat, decl, standardHorizonZenith);
      var sunriseMin = solarNoonMin - 4 * haSunriseSet;
      var sunsetMin = solarNoonMin + 4 * haSunriseSet;

      var haFajr = SolarCalc.hourAngle(lat, decl, 90 + cfg.fajr);
      var fajrMin = solarNoonMin - 4 * haFajr;

      var dhuhrMin = solarNoonMin + (cfg.dhuhrOffsetMin || 0);

      // Asr altitude: arccot(shadowFactor + tan(|lat - decl|)) — standard Shafi'i(1)/Hanafi(2) shadow definition.
      var asrAltitudeDeg = rtd(Math.atan(1 / (asrFactor + Math.tan(dtr(Math.abs(lat - decl))))));
      var haAsr = SolarCalc.hourAngle(lat, decl, 90 - asrAltitudeDeg);
      var asrMin = solarNoonMin + 4 * haAsr;

      var maghribMin;
      if (cfg.maghribMin != null) {
        maghribMin = sunsetMin + (cfg.maghribOffsetMin || 0) + cfg.maghribMin;
      } else {
        var maghribZenith = cfg.maghrib > 0 ? 90 + cfg.maghrib : standardHorizonZenith;
        var haMaghrib = SolarCalc.hourAngle(lat, decl, maghribZenith);
        maghribMin = solarNoonMin + 4 * haMaghrib + (cfg.maghribOffsetMin || 0);
      }

      var ishaMin;
      if (cfg.ishaMin != null) {
        var afterMaghribMin = ramadan ? UMM_AL_QURA_RAMADAN_ISHA_MIN : cfg.ishaMin;
        ishaMin = maghribMin + afterMaghribMin;
      } else {
        var ishaAngle = cfg.isha != null ? cfg.isha : 18;
        var haIsha = SolarCalc.hourAngle(lat, decl, 90 + ishaAngle);
        ishaMin = solarNoonMin + 4 * haIsha;
      }

      var imsakMin = fajrMin - 10; // method default here: Imsak = Fajr - 10 min (fact, not an angle)

      return {
        Imsak: fixHour(imsakMin / 60),
        Fajr: fixHour(fajrMin / 60),
        Sunrise: fixHour(sunriseMin / 60),
        Dhuhr: fixHour(dhuhrMin / 60),
        Asr: fixHour(asrMin / 60),
        Sunset: fixHour(sunsetMin / 60),
        Maghrib: fixHour(maghribMin / 60),
        Isha: fixHour(ishaMin / 60),
      };
    };
  }

  function fmtHM(hoursFloat) {
    hoursFloat = fixHour(hoursFloat + 0.5 / 60);
    var h = Math.floor(hoursFloat);
    var mi = Math.floor((hoursFloat - h) * 60);
    return { h: h, m: mi };
  }

  /** Build a local Date for a given (y,m,d) + fractional hours, in the city's own calendar day. */
  function hmToDate(baseDate, hoursFloat) {
    var hm = fmtHM(((hoursFloat % 24) + 24) % 24);
    var dayOffset = Math.floor(hoursFloat / 24);
    var dt = new Date(baseDate.getTime());
    dt.setHours(hm.h, hm.m, 0, 0);
    if (dayOffset) dt.setDate(dt.getDate() + dayOffset);
    return dt;
  }

  // ---- ZoneFix: ported from app/Support/ZoneFix.php — the JS engine's bundled tz database can be as
  // stale as the PHP one was; Morocco abolished DST permanently from 2026-09-20 (tzdb 2026.5), and an
  // older Intl/ICU build still reports +1 after that date. Self-check against a known-good probe instant
  // before trusting the runtime's own Casablanca offset; falls back to the runtime's normal answer
  // everywhere else and automatically stops correcting once the runtime's tz data catches up.
  var ZONE_FIX_RULES = {
    'Africa/Casablanca': { since: '2026-09-20T01:00:00Z', replacement: 'UTC', probe: '2026-10-15T12:00:00Z', correctOffsetHours: 0 },
    'Africa/El_Aaiun': { since: '2026-09-20T01:00:00Z', replacement: 'UTC', probe: '2026-10-15T12:00:00Z', correctOffsetHours: 0 },
  };
  var _zoneStaleCache = {};
  function rawTzOffsetHours(date, tz) {
    try {
      var dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      var parts = {};
      dtf.formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
      var asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
      return (asUTC - date.getTime()) / 3600000;
    } catch (e) {
      return -date.getTimezoneOffset() / 60;
    }
  }
  function zoneIsStale(tz) {
    if (_zoneStaleCache[tz] !== undefined) return _zoneStaleCache[tz];
    var rule = ZONE_FIX_RULES[tz];
    var stale = Math.round(rawTzOffsetHours(new Date(rule.probe), tz) * 60) !== Math.round(rule.correctOffsetHours * 60);
    _zoneStaleCache[tz] = stale;
    return stale;
  }
  function effectiveTz(tz, atDate) {
    var rule = ZONE_FIX_RULES[tz];
    if (!rule) return tz;
    if (atDate.getTime() < Date.parse(rule.since)) return tz;
    return zoneIsStale(tz) ? rule.replacement : tz;
  }

  /** tz offset in hours for an IANA zone at a given instant, without external libraries. */
  function tzOffsetHours(date, tz) {
    tz = effectiveTz(tz, date);
    try {
      var dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      var parts = {};
      dtf.formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
      var asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
      return (asUTC - date.getTime()) / 3600000;
    } catch (e) {
      return -date.getTimezoneOffset() / 60;
    }
  }

  // ---- Hijri (Umm al-Qura arithmetic / "Kuwaiti" civil algorithm) ----
  function gregorianToJd(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100);
    var B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5 + 0.5; // integer JD (noon-based)
  }

  function hijriFromGregorian(y, m, d) {
    var jd = Math.floor(gregorianToJd(y, m, d));
    var l = jd - 1948440 + 10632;
    var n = Math.floor((l - 1) / 10631);
    l = l - 10631 * n + 354;
    var j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
    l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
    var month = Math.floor((24 * l) / 709);
    var day = l - Math.floor((709 * month) / 24);
    var year = 30 * n + j - 30;
    return { year: year, month: month, day: day };
  }

  var HIJRI_MONTHS_AR = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
  var HIJRI_MONTHS_EN = ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Akhir', 'Jumada al-Ula', 'Jumada al-Akhirah', 'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah'];

  function hijri(date) {
    var h = hijriFromGregorian(date.getFullYear(), date.getMonth() + 1, date.getDate());
    var lang = (root.I18N && root.I18N.lang) || 'ar';
    return { year: h.year, month: h.month, day: h.day, monthName: lang === 'en' ? HIJRI_MONTHS_EN[h.month - 1] : HIJRI_MONTHS_AR[h.month - 1] };
  }

  // ---- settings persistence ----
  var STORAGE_KEY = 'hk.prayer';
  var DEFAULTS = { on: false, city: null, method: 'MWL', adhan: 'off', pauseVod: true };

  function settings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      var s = JSON.parse(raw);
      return Object.assign({}, DEFAULTS, s);
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function save(s) {
    var merged = Object.assign({}, settings(), s || {});
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch (e) {}
    return merged;
  }

  function cities() {
    return (root.HK_prayerCities && root.HK_prayerCities.list()) || [];
  }

  var PRAYER_ORDER = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

  /** times(date, city) -> {fajr, sunrise, dhuhr, asr, maghrib, isha} as Date objects (city's own calendar day). */
  function times(date, city) {
    if (!city) return null;
    date = date || new Date();
    var method = (city.method && METHODS[city.method]) ? city.method : (settings().method || 'MWL');
    var cfg = METHODS[method] || METHODS.MWL;
    var school = settings().school === 'HANAFI' ? 'HANAFI' : 'STANDARD';

    // local calendar date in the city's own timezone, so "today" means the city's today
    var tzNow = new Date(date.getTime() + tzOffsetHours(date, city.tz) * 3600000);
    var y = tzNow.getUTCFullYear(), m = tzNow.getUTCMonth() + 1, d = tzNow.getUTCDate();

    var isRamadan = method === 'MAKKAH' && hijriFromGregorian(y, m, d).month === 9;

    var calc = new Calculator(city.lat, city.lng, y, m, d, tzOffsetHours(date, city.tz), cfg, school, isRamadan);
    var raw = calc.compute();

    var base = new Date(date.getTime());
    base.setHours(0, 0, 0, 0);
    // anchor base to the city's calendar day expressed in local-device time, so hmToDate lands correctly
    var anchor = new Date(date.getTime() + tzOffsetHours(date, city.tz) * 3600000 - date.getTimezoneOffset() * -60000);
    anchor = new Date(y, m - 1, d, 0, 0, 0, 0); // device-local midnight stamped with the city's Y-M-D; good enough for a same-device clock display

    return {
      imsak: hmToDate(anchor, raw.Imsak),
      fajr: hmToDate(anchor, raw.Fajr),
      sunrise: hmToDate(anchor, raw.Sunrise),
      dhuhr: hmToDate(anchor, raw.Dhuhr),
      asr: hmToDate(anchor, raw.Asr),
      maghrib: hmToDate(anchor, raw.Maghrib),
      isha: hmToDate(anchor, raw.Isha),
    };
  }

  function next(now, city) {
    now = now || new Date();
    var t = times(now, city);
    if (!t) return null;
    var order = [['Fajr', t.fajr], ['Sunrise', t.sunrise], ['Dhuhr', t.dhuhr], ['Asr', t.asr], ['Maghrib', t.maghrib], ['Isha', t.isha]];
    for (var i = 0; i < order.length; i++) {
      if (order[i][1] > now) return { name: order[i][0], at: order[i][1] };
    }
    var tomorrow = new Date(now.getTime() + 86400000);
    var t2 = times(tomorrow, city);
    return { name: 'Fajr', at: t2.fajr, tomorrow: true };
  }

  /** ramadan(date) -> {on, imsak, iftar, day} using the Umm al-Qura hijri calendar (SA/Gulf-oriented calendar). */
  function ramadan(date) {
    date = date || new Date();
    var h = hijriFromGregorian(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return { on: h.month === 9, day: h.month === 9 ? h.day : null, year: h.year };
  }

  // ---- watch(): single timer to the next event, no polling ----
  var _timer = null;
  function watch(onEvent) {
    unwatch();
    function tick() {
      var s = settings();
      if (!s.on || !s.city) return;
      var n = next(new Date(), s.city);
      if (!n) return;
      var delay = Math.max(250, n.at.getTime() - Date.now());
      _timer = setTimeout(function () {
        try { onEvent({ name: n.name, at: n.at }); } catch (e) {}
        tick();
      }, delay);
    }
    tick();
  }

  function unwatch() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
  }

  root.HK_prayer = {
    times: times,
    cities: cities,
    next: next,
    hijri: hijri,
    ramadan: ramadan,
    settings: settings,
    save: save,
    watch: watch,
    unwatch: unwatch,
    METHODS: Object.keys(METHODS),
  };
})(typeof window !== 'undefined' ? window : this);
