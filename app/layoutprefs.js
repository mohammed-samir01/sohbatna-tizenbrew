/* Sohbatna 6.0 — HK_layout: hide/show + reorder categories, "my groups", storage key hk.layout.
 * Dialog: remote up/down moves focus; OK toggles hide; a 'move' mode where up/down reorders; back closes.
 * syncPayload()/mergeSync() match the additive Sync shape in CONTRACT.md (section keys: live, movies, series).
 * Contract: HK_layout.apply(section, cats, keyFn); HK_layout.open(section, cats, onChange);
 *           HK_layout.groups(); HK_layout.addToGroup(id, itemKey); HK_layout.syncPayload(); HK_layout.mergeSync(). */
(function (root) {
  'use strict';
  var KEY = 'hk.layout';
  var MAX_JSON = 64 * 1024, MAX_GROUPS = 50, MAX_KEYS = 500;
  var T = root.T || function (s) { return s; };

  function normalize(v) {
    v = v || {};
    return {
      at: v.at || 0,
      hidden: (v.hidden && typeof v.hidden === 'object') ? v.hidden : {},
      order: (v.order && typeof v.order === 'object') ? v.order : {},
      groups: Array.isArray(v.groups) ? v.groups.map(function (g) {
        return { id: g.id, name: g.name, keys: Array.isArray(g.keys) ? g.keys.slice(0, MAX_KEYS) : [] };
      }) : []
    };
  }
  function loadState() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return normalize({}); }
  }
  var STATE = loadState();

  function clampCaps(s) {
    if (s.groups.length > MAX_GROUPS) s.groups = s.groups.slice(0, MAX_GROUPS);
    s.groups.forEach(function (g) { if (g.keys.length > MAX_KEYS) g.keys = g.keys.slice(0, MAX_KEYS); });
    return s;
  }
  function persist() {
    STATE.at = Date.now();
    clampCaps(STATE);
    var str = JSON.stringify(STATE);
    while (str.length > MAX_JSON && STATE.groups.length) { STATE.groups.pop(); str = JSON.stringify(STATE); }
    try { localStorage.setItem(KEY, str); } catch (e) {}
  }

  function apply(section, cats, keyFn) {
    cats = cats || [];
    keyFn = keyFn || function (c) { return c && c.key; };
    var hidden = STATE.hidden[section] || [];
    var order = STATE.order[section] || [];
    var visible = cats.filter(function (c) { return hidden.indexOf(keyFn(c)) < 0; });
    if (!order.length) return visible;
    var map = {}, used = {};
    visible.forEach(function (c) { map[keyFn(c)] = c; });
    var out = [];
    order.forEach(function (k) { if (map[k] && !used[k]) { out.push(map[k]); used[k] = true; } });
    visible.forEach(function (c) { var k = keyFn(c); if (!used[k]) { out.push(c); used[k] = true; } });
    return out;
  }

  function groups() { return STATE.groups.map(function (g) { return { id: g.id, name: g.name, keys: g.keys.slice() }; }); }
  function addToGroup(groupId, itemKey) {
    var g = STATE.groups.filter(function (x) { return x.id === groupId; })[0];
    if (!g) {
      if (STATE.groups.length >= MAX_GROUPS) return;
      g = { id: groupId, name: groupId, keys: [] };
      STATE.groups.push(g);
    }
    if (g.keys.indexOf(itemKey) < 0) g.keys.push(itemKey);
    if (g.keys.length > MAX_KEYS) g.keys = g.keys.slice(0, MAX_KEYS);
    persist();
  }
  function createGroup(name) {
    if (STATE.groups.length >= MAX_GROUPS) return null;
    var id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    STATE.groups.push({ id: id, name: name || T('مجموعة'), keys: [] });
    persist();
    return id;
  }
  function renameGroup(id, name) {
    var g = STATE.groups.filter(function (x) { return x.id === id; })[0];
    if (g) { g.name = name; persist(); }
  }
  function deleteGroup(id) {
    STATE.groups = STATE.groups.filter(function (x) { return x.id !== id; });
    persist();
  }
  function toggleHidden(section, key) {
    var h = STATE.hidden[section] = STATE.hidden[section] || [];
    var i = h.indexOf(key);
    if (i >= 0) h.splice(i, 1); else h.push(key);
    persist();
  }
  function setOrder(section, keys) {
    STATE.order[section] = keys.slice();
    persist();
  }
  function syncPayload() {
    return { at: STATE.at, hidden: STATE.hidden, order: STATE.order, groups: STATE.groups };
  }
  function mergeSync(serverLayout) {
    if (!serverLayout) return;
    if ((serverLayout.at || 0) > (STATE.at || 0)) {
      STATE = normalize(serverLayout);
      clampCaps(STATE);
      try { localStorage.setItem(KEY, JSON.stringify(STATE)); } catch (e) {}
    }
  }

  // ---------------- dialog (reuses the existing #modal / #modal-card host elements) ----------------
  injectStyle();
  function injectStyle() {
    if (document.getElementById('hk6-layout-style')) return;
    var s = document.createElement('style'); s.id = 'hk6-layout-style';
    s.textContent =
      '.hk6-lp{min-width:300px;max-width:440px}' +
      '.hk6-lp h3{margin:0 0 var(--s-3,12px) 0;font-size:var(--fs-h3,19px);color:var(--fg,#fff)}' +
      '.hk6-lp-list{display:flex;flex-direction:column;gap:6px;max-height:44vh;overflow:auto}' +
      '.hk6-lp-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;' +
      'border-radius:var(--r-chip,10px);background:var(--surface,#16212A);border:1px solid var(--border-soft,#1A262F);' +
      'color:var(--fg-soft,#E6EEF1);cursor:pointer}' +
      '.hk6-lp-row.hk6-focus{outline:2px solid var(--accent,#46D8D1);box-shadow:var(--sh-glow,0 0 0 3px #46D8D1)}' +
      '.hk6-lp-row.hk6-move{outline:2px dashed var(--accent,#46D8D1)}' +
      '.hk6-lp-row.hk6-hidden{opacity:.5}' +
      '.hk6-lp-tag{font-size:var(--fs-tiny,11px);color:var(--muted,#8EA3AE)}' +
      '.hk6-lp-actions{display:flex;gap:8px;margin-top:var(--s-4,16px);flex-wrap:wrap}' +
      '.hk6-lp button{cursor:pointer;border-radius:var(--r-button,12px);border:1px solid var(--border,#22303A);' +
      'background:var(--surface,#16212A);color:var(--fg-soft,#E6EEF1);padding:8px 12px;font-size:var(--fs-small,13px)}' +
      '.hk6-lp button:focus{outline:2px solid var(--accent,#46D8D1)}' +
      'html.fx-off .hk6-lp *{transition:none!important;animation:none!important}';
    document.head.appendChild(s);
  }

  function open(section, cats, onChange) {
    cats = cats || [];
    var modal = document.getElementById('modal'), card = document.getElementById('modal-card');
    if (!modal || !card) return;
    var moveIndex = -1;    // index currently being reordered, -1 = browse mode
    var focusIndex = 0;
    var view = buildView();

    function buildView() {
      var hidden = (STATE.hidden[section] || []).slice();
      var ordered = apply(section, cats, function (c) { return c.key; });
      var hiddenCats = cats.filter(function (c) { return hidden.indexOf(c.key) >= 0; });
      return ordered.concat(hiddenCats);
    }
    function isHidden(key) { return (STATE.hidden[section] || []).indexOf(key) >= 0; }

    function render() {
      var rows = view.map(function (c, i) {
        var hid = isHidden(c.key);
        var cls = 'hk6-lp-row' + (i === focusIndex ? ' hk6-focus' : '') + (i === moveIndex ? ' hk6-move' : '') + (hid ? ' hk6-hidden' : '');
        var tag = hid ? T('مخفي') : (i === moveIndex ? T('اضغط موافق لتثبيت الموضع') : '');
        return '<div class="' + cls + '" data-i="' + i + '"><span>' + T(c.label || c.key) + '</span><span class="hk6-lp-tag">' + tag + '</span></div>';
      }).join('');
      var groupRows = STATE.groups.map(function (g) {
        return '<div class="hk6-lp-row" data-group="' + g.id + '"><span>' + (g.name || '') + '</span><span class="hk6-lp-tag">' + g.keys.length + '</span></div>';
      }).join('');
      card.className = 'modal-card hk6-lp';
      card.innerHTML =
        '<h3>' + T('تخصيص الأقسام') + '</h3>' +
        '<div class="hk6-lp-list" id="hk6-lp-list">' + (rows || '') + '</div>' +
        (groupRows ? ('<h3 style="margin-top:16px">' + T('مجموعاتي') + '</h3><div class="hk6-lp-list">' + groupRows + '</div>') : '') +
        '<div class="hk6-lp-actions">' +
        '<button type="button" data-act="toggle">' + T('إخفاء / إظهار (موافق)') + '</button>' +
        '<button type="button" data-act="move">' + T('نقل (ترتيب)') + '</button>' +
        '<button type="button" data-act="newgroup">' + T('مجموعة جديدة') + '</button>' +
        '<button type="button" data-act="close">' + T('إغلاق') + '</button>' +
        '</div>';
      modal.classList.remove('hidden');
      Array.prototype.forEach.call(card.querySelectorAll('.hk6-lp-row[data-i]'), function (el) {
        el.onclick = function () { focusIndex = +el.getAttribute('data-i'); render(); };
      });
      var toggleBtn = card.querySelector('[data-act="toggle"]');
      var moveBtn = card.querySelector('[data-act="move"]');
      var newGroupBtn = card.querySelector('[data-act="newgroup"]');
      var closeBtn = card.querySelector('[data-act="close"]');
      if (toggleBtn) toggleBtn.onclick = doToggle;
      if (moveBtn) moveBtn.onclick = doMoveToggle;
      if (newGroupBtn) newGroupBtn.onclick = doNewGroup;
      if (closeBtn) closeBtn.onclick = close;
    }
    function doToggle() {
      var c = view[focusIndex];
      if (!c) return;
      toggleHidden(section, c.key);
      view = buildView();
      if (focusIndex >= view.length) focusIndex = Math.max(0, view.length - 1);
      render();
      fireChange();
    }
    function doMoveToggle() {
      moveIndex = (moveIndex === focusIndex) ? -1 : focusIndex;
      render();
    }
    function moveFocus(delta) {
      if (!view.length) return;
      if (moveIndex >= 0) {
        var ni = focusIndex + delta;
        if (ni < 0 || ni >= view.length) return;
        var tmp = view[focusIndex]; view[focusIndex] = view[ni]; view[ni] = tmp;
        focusIndex = ni; moveIndex = ni;
        setOrder(section, view.filter(function (c) { return !isHidden(c.key); }).map(function (c) { return c.key; }));
        fireChange();
      } else {
        focusIndex = Math.max(0, Math.min(view.length - 1, focusIndex + delta));
      }
      render();
    }
    function doNewGroup() {
      var name = root.prompt ? root.prompt(T('اسم المجموعة')) : '';
      if (name) { createGroup(name); render(); fireChange(); }
    }
    function fireChange() { if (typeof onChange === 'function') try { onChange(); } catch (e) {} }
    function close() {
      modal.classList.add('hidden');
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (modal.classList.contains('hidden')) return;
      if (document.activeElement && document.activeElement.tagName === 'BUTTON' && e.key !== 'Escape' && e.key !== 'Backspace') return;
      if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doToggle(); }
      else if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); close(); }
    }
    document.addEventListener('keydown', onKey, true);
    render();
  }

  root.HK_layout = {
    apply: apply, open: open, groups: groups, addToGroup: addToGroup,
    createGroup: createGroup, renameGroup: renameGroup, deleteGroup: deleteGroup,
    toggleHidden: toggleHidden, setOrder: setOrder,
    syncPayload: syncPayload, mergeSync: mergeSync
  };
})(typeof window !== 'undefined' ? window : this);
