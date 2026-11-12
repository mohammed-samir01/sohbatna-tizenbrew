/* Sohbatna 6.0 — HK_onboard: "what's new" 3-step tour, shown once for every user (new or updating) at 6.0.
 * Focus-trapped modal, Skip + Next, Back/Escape closes. Reuses the .modal/.modal-card look web-ui defines.
 * Contract: HK_onboard.maybeShow(). */
(function (root) {
  'use strict';
  var T = root.T || function (s) { return s; };
  var KEY = 'hk.whatsnew', VERSION = '6.0';
  var STEPS = [
    { title: 'شريط تنقّل جديد', body: 'الأقسام بقت في شريط فوق على التلفزيون والكمبيوتر، والتصنيفات على اليمين، فالمحتوى بقى له مساحة أكبر.' },
    { title: 'تفاصيل أسرع ومتابعة المشاهدة', body: 'حدّد أي كارت علشان تشوف تفاصيله فوراً، وكمّل المشاهدة من حيث وقفت بضغطة واحدة.' },
    { title: 'تحكم بالحركة والأقسام', body: 'غيّر مستوى الحركة من الإعدادات، ورتّب أو اخفِ الأقسام وكوّن مجموعاتك الخاصة.' }
  ];
  var idx = 0, keyHandler = null;

  injectStyle();
  function injectStyle() {
    if (document.getElementById('hk6-ob-style')) return;
    var s = document.createElement('style'); s.id = 'hk6-ob-style';
    s.textContent =
      '.hk6-ob{min-width:300px;max-width:440px;text-align:center}' +
      '.hk6-ob-dots{display:flex;justify-content:center;gap:6px;margin-bottom:var(--s-3,12px)}' +
      '.hk6-dot{width:8px;height:8px;border-radius:50%;background:var(--border,#22303A)}' +
      '.hk6-dot.on{background:var(--accent,#46D8D1)}' +
      '.hk6-ob-title{margin:0 0 8px 0;font-size:var(--fs-h2,24px);color:var(--fg,#fff)}' +
      '.hk6-ob-body{margin:0 0 var(--s-4,16px) 0;color:var(--fg-2,#C3CED4);font-size:var(--fs-body,15px);line-height:1.7}' +
      '.hk6-ob-actions{display:flex;justify-content:space-between;gap:10px}' +
      '.hk6-ob-actions button{flex:1;cursor:pointer;border-radius:var(--r-button,12px);padding:10px 12px;font-size:var(--fs-body,15px);border:1px solid var(--border,#22303A);background:var(--surface,#16212A);color:var(--fg-soft,#E6EEF1)}' +
      '.hk6-ob-next{background:var(--accent,#46D8D1)!important;color:var(--on-accent,#05201F)!important;border-color:var(--accent,#46D8D1)!important;font-weight:600}' +
      '.hk6-ob-next:focus,.hk6-ob-skip:focus{outline:2px solid var(--accent,#46D8D1)}' +
      'html.fx-full .hk6-ob{animation:hk6ObIn var(--t-page,240ms) var(--ease-out,ease)}' +
      '@keyframes hk6ObIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}' +
      'html.fx-off .hk6-ob{animation:none}';
    document.head.appendChild(s);
  }

  function render() {
    var modal = document.getElementById('modal'), card = document.getElementById('modal-card');
    if (!modal || !card) return;
    var s = STEPS[idx];
    card.className = 'modal-card hk6-ob';
    card.innerHTML =
      '<div class="hk6-ob-dots">' + STEPS.map(function (_, i) { return '<span class="hk6-dot' + (i === idx ? ' on' : '') + '"></span>'; }).join('') + '</div>' +
      '<h3 class="hk6-ob-title">' + T(s.title) + '</h3>' +
      '<p class="hk6-ob-body">' + T(s.body) + '</p>' +
      '<div class="hk6-ob-actions">' +
      '<button type="button" class="hk6-ob-skip">' + T('تخطي') + '</button>' +
      '<button type="button" class="hk6-ob-next">' + (idx === STEPS.length - 1 ? T('إنهاء') : T('التالي')) + '</button>' +
      '</div>';
    modal.classList.remove('hidden');
    var next = card.querySelector('.hk6-ob-next'), skip = card.querySelector('.hk6-ob-skip');
    next.onclick = function () { if (idx < STEPS.length - 1) { idx++; render(); } else finish(); };
    skip.onclick = finish;
    next.focus();
  }

  function finish() {
    try { localStorage.setItem(KEY, VERSION); } catch (e) {}
    var modal = document.getElementById('modal');
    if (modal) modal.classList.add('hidden');
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
  }

  function focusables() {
    var card = document.getElementById('modal-card');
    return card ? Array.prototype.slice.call(card.querySelectorAll('button')) : [];
  }

  function maybeShow() {
    var seen = null;
    try { seen = localStorage.getItem(KEY); } catch (e) {}
    if (seen === VERSION) return; // already shown once — for new and existing users alike
    idx = 0;
    keyHandler = function (e) {
      var modal = document.getElementById('modal');
      if (!modal || modal.classList.contains('hidden')) return;
      if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); finish(); return; }
      var items = focusables();
      if (!items.length) return;
      if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        var cur = items.indexOf(document.activeElement);
        var dir = (e.key === 'Tab' && e.shiftKey) || e.key === 'ArrowLeft' ? -1 : 1;
        var ni = (cur + dir + items.length) % items.length;
        items[ni].focus();
      } else if (e.key === 'Enter') {
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') { e.preventDefault(); document.activeElement.click(); }
      }
    };
    document.addEventListener('keydown', keyHandler, true);
    render();
  }

  root.HK_onboard = { maybeShow: maybeShow };
})(typeof window !== 'undefined' ? window : this);
