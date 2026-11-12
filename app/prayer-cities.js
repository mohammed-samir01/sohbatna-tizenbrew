// prayer-cities.js — bundled Egypt governorates + Arab capitals/major cities (contract Wave 5).
// Source data: Rattilha's database/data/cities.json (GeoNames-derived lat/lng/tz; app-internal, not
// redistributed verbatim — only name/lat/lng/tz fields for the curated subset below) + method assigned
// per country from islamic-network/prayer-times' per-region defaults (see prayer.js header for licensing).
(function (root) {
  'use strict';
  var CITIES = [
    {"country":"EG","ar":"القاهرة","en":"Cairo","lat":30.0626,"lng":31.2497,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"الإسكندرية","en":"Alexandria","lat":31.2018,"lng":29.9158,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"الجيزة","en":"Giza","lat":30.0094,"lng":31.2086,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"بورسعيد","en":"Port Said","lat":31.2653,"lng":32.3019,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"السويس","en":"Suez","lat":29.9737,"lng":32.5263,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"المنصورة","en":"Mansoura","lat":31.0364,"lng":31.3807,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"طنطا","en":"Tanta","lat":30.7885,"lng":31.0019,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"الإسماعيلية","en":"Ismailia","lat":30.6043,"lng":32.2722,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"الزقازيق","en":"Zagazig","lat":30.5877,"lng":31.502,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"دمنهور","en":"Damanhur","lat":31.0341,"lng":30.4682,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"دمياط","en":"Damietta","lat":31.4165,"lng":31.8133,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"كفر الشيخ","en":"Kafr El Sheikh","lat":31.1117,"lng":30.9399,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"الفيوم","en":"Fayoum","lat":29.31,"lng":30.8418,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"المنيا","en":"Minya","lat":28.0919,"lng":30.7581,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"سوهاج","en":"Sohag","lat":26.557,"lng":31.6948,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"قنا","en":"Qena","lat":26.1642,"lng":32.7267,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"الأقصر","en":"Luxor","lat":25.6989,"lng":32.6421,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"الغردقة","en":"Hurghada","lat":27.2574,"lng":33.8129,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"القاهرة الجديدة","en":"New Cairo","lat":30.03,"lng":31.47,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"السادس من أكتوبر","en":"6th of October City","lat":29.8167,"lng":31.05,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"أسيوط","en":"Assiut","lat":27.181,"lng":31.1837,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"أسوان","en":"Aswan","lat":24.0908,"lng":32.8994,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"بني سويف","en":"Beni Suef","lat":29.0744,"lng":31.0979,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"مرسى مطروح","en":"Marsa Matruh","lat":31.3525,"lng":27.2373,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"العريش","en":"Al Arish","lat":31.1316,"lng":33.7984,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"EG","ar":"شرم الشيخ","en":"Sharm El Sheikh","lat":27.9158,"lng":34.33,"tz":"Africa/Cairo","method":"EGYPT"},
    {"country":"SA","ar":"الرياض","en":"Riyadh","lat":24.6877,"lng":46.7219,"tz":"Asia/Riyadh","method":"MAKKAH"},
    {"country":"SA","ar":"جدة","en":"Jeddah","lat":21.4901,"lng":39.1862,"tz":"Asia/Riyadh","method":"MAKKAH"},
    {"country":"SA","ar":"مكة المكرمة","en":"Mecca","lat":21.4225,"lng":39.8262,"tz":"Asia/Riyadh","method":"MAKKAH"},
    {"country":"SA","ar":"المدينة المنورة","en":"Medina","lat":24.5247,"lng":39.5692,"tz":"Asia/Riyadh","method":"MAKKAH"},
    {"country":"SA","ar":"الدمام","en":"Dammam","lat":26.4344,"lng":50.1033,"tz":"Asia/Riyadh","method":"MAKKAH"},
    {"country":"AE","ar":"دبي","en":"Dubai","lat":25.0772,"lng":55.3093,"tz":"Asia/Dubai","method":"DUBAI"},
    {"country":"AE","ar":"أبوظبي","en":"Abu Dhabi","lat":24.4539,"lng":54.3773,"tz":"Asia/Dubai","method":"DUBAI"},
    {"country":"AE","ar":"الشارقة","en":"Sharjah","lat":25.3342,"lng":55.4122,"tz":"Asia/Dubai","method":"DUBAI"},
    {"country":"KW","ar":"مدينة الكويت","en":"Kuwait City","lat":29.367,"lng":47.9743,"tz":"Asia/Kuwait","method":"KUWAIT"},
    {"country":"QA","ar":"الدوحة","en":"Doha","lat":25.2855,"lng":51.531,"tz":"Asia/Qatar","method":"QATAR"},
    {"country":"BH","ar":"المنامة","en":"Manama","lat":26.2279,"lng":50.5857,"tz":"Asia/Bahrain","method":"GULF"},
    {"country":"OM","ar":"مسقط","en":"Muscat","lat":23.5841,"lng":58.4078,"tz":"Asia/Muscat","method":"GULF"},
    {"country":"JO","ar":"عمّان","en":"Amman","lat":31.9552,"lng":35.945,"tz":"Asia/Amman","method":"JORDAN"},
    {"country":"LB","ar":"بيروت","en":"Beirut","lat":33.8933,"lng":35.5016,"tz":"Asia/Beirut","method":"MWL"},
    {"country":"SY","ar":"دمشق","en":"Damascus","lat":33.5102,"lng":36.2913,"tz":"Asia/Damascus","method":"MWL"},
    {"country":"IQ","ar":"بغداد","en":"Baghdad","lat":33.3406,"lng":44.4009,"tz":"Asia/Baghdad","method":"MWL"},
    {"country":"YE","ar":"صنعاء","en":"Sanaa","lat":15.3545,"lng":44.2065,"tz":"Asia/Aden","method":"MAKKAH"},
    {"country":"SD","ar":"الخرطوم","en":"Khartoum","lat":15.5518,"lng":32.5324,"tz":"Africa/Khartoum","method":"MWL"},
    {"country":"LY","ar":"طرابلس","en":"Tripoli","lat":32.8874,"lng":13.1873,"tz":"Africa/Tripoli","method":"EGYPT"},
    {"country":"MA","ar":"الرباط","en":"Rabat","lat":34.0132,"lng":-6.8326,"tz":"Africa/Casablanca","method":"MOROCCO"},
    {"country":"MA","ar":"الدار البيضاء","en":"Casablanca","lat":33.5883,"lng":-7.6114,"tz":"Africa/Casablanca","method":"MOROCCO"},
    {"country":"TN","ar":"تونس","en":"Tunis","lat":36.819,"lng":10.1658,"tz":"Africa/Tunis","method":"TUNISIA"},
    {"country":"DZ","ar":"الجزائر","en":"Algiers","lat":36.7323,"lng":3.0875,"tz":"Africa/Algiers","method":"ALGERIA"},
    {"country":"SO","ar":"مقديشو","en":"Mogadishu","lat":2.0371,"lng":45.3438,"tz":"Africa/Mogadishu","method":"MWL"},
    {"country":"MR","ar":"نواكشوط","en":"Nouakchott","lat":18.0858,"lng":-15.9785,"tz":"Africa/Nouakchott","method":"MWL"},
    {"country":"DJ","ar":"جيبوتي","en":"Djibouti","lat":11.589,"lng":43.145,"tz":"Africa/Djibouti","method":"MWL"},
    {"country":"PS","ar":"غزة","en":"Gaza","lat":31.5016,"lng":34.4667,"tz":"Asia/Gaza","method":"JORDAN"},
    {"country":"PS","ar":"القدس","en":"Jerusalem","lat":31.769,"lng":35.2163,"tz":"Asia/Jerusalem","method":"JORDAN"},
    {"country":"KM","ar":"موروني","en":"Moroni","lat":-11.7022,"lng":43.2551,"tz":"Indian/Comoro","method":"MWL"}
  ];

  function list() { return CITIES; }
  function byCountry(cc) { return CITIES.filter(function (c) { return c.country === cc; }); }
  function find(en) { return CITIES.find(function (c) { return c.en === en; }) || null; }

  root.HK_prayerCities = { list: list, byCountry: byCountry, find: find };
})(typeof window !== 'undefined' ? window : this);
