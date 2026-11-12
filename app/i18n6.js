/* Sohbatna 6.0 — English strings for every Arabic string the web-features modules show.
 * Loaded after i18n.js; merges into the same dictionary object T()/I18N.localizeDom() already read from. */
(function (root) {
  'use strict';
  if (!root.I18N || !root.I18N.dict) return; // i18n.js not loaded — nothing to merge into
  var EN = {
    // layoutprefs.js — categories dialog + groups
    'تخصيص الأقسام': 'Customise sections', 'مجموعاتي': 'My groups', 'مخفي': 'Hidden',
    'اضغط موافق لتثبيت الموضع': 'Press OK to drop it here',
    'إخفاء / إظهار (موافق)': 'Hide / show (OK)', 'نقل (ترتيب)': 'Move (reorder)',
    'مجموعة جديدة': 'New group', 'اسم المجموعة': 'Group name', 'مجموعة': 'Group',

    // streaminfo.js — quality panel labels + diagnosis sentences
    'الدقة': 'Resolution', 'معدل البت': 'Bitrate', 'سرعة النت المقدرة': 'Estimated network speed',
    'المخزن المؤقت': 'Buffer', 'إطارات ضائعة': 'Dropped frames', 'انقطاعات': 'Stalls',
    'النت عندك أبطأ من البث': 'Your connection is slower than the stream',
    'البث مستقر': 'Stream is stable',
    'الجهاز بيتعب في فك الفيديو': 'Your device is struggling to decode the video',
    'مصدر البث بطيء': 'The source feed is slow',

    // onboard.js — "what's new" 3-step tour
    'شريط تنقّل جديد': 'A new navigation bar',
    'الأقسام بقت في شريط فوق على التلفزيون والكمبيوتر، والتصنيفات على اليمين، فالمحتوى بقى له مساحة أكبر.':
      'Sections now sit in a top bar on TV and PC, with sub-categories on the right, so content gets more room.',
    'تفاصيل أسرع ومتابعة المشاهدة': 'Faster details and continue watching',
    'حدّد أي كارت علشان تشوف تفاصيله فوراً، وكمّل المشاهدة من حيث وقفت بضغطة واحدة.':
      'Focus any card to see its details instantly, and resume watching with one press.',
    'تحكم بالحركة والأقسام': 'Control motion and sections',
    'غيّر مستوى الحركة من الإعدادات، ورتّب أو اخفِ الأقسام وكوّن مجموعاتك الخاصة.':
      'Change the motion level in Settings, and hide, reorder or group your sections.',
    'تخطي': 'Skip', 'إنهاء': 'Finish',
    'إضافة حساب جديد': 'Add a new account',

    // 6.0 integration (app.js: accounts, settings sections, prayer, remote, kids limit)
    'أدخل رابط M3U أو اختر ملفاً من الجهاز': "Enter an M3U link or pick a file from this device",
    'أدخل رابط البورتال وعنوان MAC': "Enter the portal link and MAC address",
    'أعد اختيار ملف M3U — لم يتم العثور على نسخة محفوظة': "Pick the M3U file again — no saved copy was found",
    'إغلاق المشغّل': "Close player",
    'ابحث…': "Search…",
    'اختر المدينة': "Choose city",
    'اختر المدينة أولاً': "Choose a city first",
    'اشتراكات MAC غير مدعومة على شاشات LG حالياً': "MAC subscriptions are not supported on LG TVs yet",
    'افتح الكاميرا أو امسح الرمز، أو أدخل الكود على': "Open your camera and scan the code, or enter the code at",
    'المظهر': "Appearance",
    'الوقت اليومي للأطفال': "Kids' daily time",
    'انتهى الوقت اليومي المسموح به للأطفال. أدخل رمز PIN لمتابعة المشاهدة.': "Today's kids time is up. Enter the PIN to keep watching.",
    'انتهى وقت اليوم': "Today's time is up",
    'انتهى وقت اليوم المسموح به للأطفال': "Today's kids time is up",
    'بدء الربط': "Start pairing",
    'تخصيص الأقسام غير متاح': "Customising sections is unavailable",
    'تعذر الاتصال بالبورتال — تحقق من الرابط وعنوان MAC': "Couldn't reach the portal — check the link and MAC address",
    'تعذر بدء الربط': "Couldn't start pairing",
    'تم الحفظ': "Saved",
    'تنبيه صوتي': "Beep",
    'حان الآن وقت صلاة ': "It's time for ",
    'حدث خطأ': "Something went wrong",
    'رمضان كريم — يوم': "Ramadan Kareem — day",
    'رمضان كريم — يوم ': "Ramadan Kareem — day ",
    'ريموت الموبايل': "Phone remote",
    'ريموت الموبايل غير متاح': "Phone remote is unavailable",
    'سيتوقف التشغيل في نهاية هذه الحلقة': "Playback will stop at the end of this episode",
    'صوتي (قريباً)': "Voice (soon)",
    'قائمتك محفوظة على هذا الجهاز. لإعادة التحميل على جهاز آخر ستحتاج لاختيار الملف من جديد.': "Your list is saved on this device. On another device you will need to pick the file again.",
    'معلومات البث غير متاحة': "Stream info is unavailable",
    'مواعيد الصلاة': "Prayer times",
    'مُفعّل': "On",
    'نتائج في دليل البرامج': "Results in the TV guide",
    'وحدة MAC غير متاحة': "MAC module is unavailable"
  };
  Object.assign(root.I18N.dict, EN);
})(typeof window !== 'undefined' ? window : this);
