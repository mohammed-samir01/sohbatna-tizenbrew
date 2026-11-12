/* Sohbatna 6.0 — English strings for prayer.js / Ramadan UI, owned by prayer6 (contract Wave 5).
 * Loaded after i18n.js; merges into the same dictionary object T()/I18N.localizeDom() already read from. */
(function (root) {
  'use strict';
  if (!root.I18N || !root.I18N.dict) return; // i18n.js not loaded — nothing to merge into
  var EN = {
    'مواقيت الصلاة': 'Prayer times',
    'تفعيل مواقيت الصلاة': 'Enable prayer times',
    'المدينة': 'City',
    'اختر مدينتك': 'Choose your city',
    'طريقة الحساب': 'Calculation method',
    'الأذان': 'Adhan',
    'بدون': 'Off',
    'صفارة': 'Beep',
    'صوت الأذان': 'Voice',
    'إيقاف الفيديو عند الأذان': 'Pause video at adhan time',
    'الفجر': 'Fajr', 'الإمساك': 'Imsak', 'الشروق': 'Sunrise', 'الظهر': 'Dhuhr', 'العصر': 'Asr',
    'المغرب': 'Maghrib', 'العشاء': 'Isha',
    'حان الآن وقت صلاة': 'It is now time for', // + prayer name
    'الوقت المتبقي لصلاة': 'Time left until', // + prayer name
    'رمضان': 'Ramadan', 'رمضان مبارك': 'Ramadan Kareem',
    'الإفطار': 'Iftar', 'يوم من رمضان': 'day of Ramadan',
    'تعذر تحديد مواقيت الصلاة لهذه المدينة': 'Could not get prayer times for this city',
  };
  Object.assign(root.I18N.dict, EN);
})(typeof window !== 'undefined' ? window : this);
