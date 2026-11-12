/* Sohbatna — spatial (D-pad / arrow-key) navigation.
 * Keeps one "current" element per screen, moves between visible focusables by geometry,
 * and never auto-focuses text inputs (that would pop the TV keyboard) — OK/Enter does.
 */
(function () {
  var SEL = 'button, input, select, .card, .cat, .ep, .opt, .m-slot, [data-nav]';
  var TEXT = /^(text|password|search|email|number|tel|url)$/i;
  var root = document.documentElement;
  var cur = null, curKey = null;
  var memory = {};      // screen id -> key of last element
  var defaults = {};    // screen id -> selector list for first focus

  function isText(el) { return el && ((el.tagName === 'INPUT' && TEXT.test(el.type || 'text')) || el.tagName === 'TEXTAREA'); }
  function attached(el) { return el && document.body.contains(el); }
  function shown(el) {
    if (!el || el.disabled || el.hasAttribute('data-nonav')) return false;
    if (el.closest('.hidden,[data-nonav]')) return false;
    var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  }
  function scopeEl() {
    var m = document.getElementById('modal');
    if (m && !m.classList.contains('hidden')) return document.getElementById('modal-card');
    return document.querySelector('.screen:not(.hidden)') || document.body;
  }
  function scopeId() { var s = scopeEl(); return s.id === 'modal-card' ? 'modal' : s.id; }
  function candidates() { return [].slice.call(scopeEl().querySelectorAll(SEL)).filter(shown); }

  // Stable identity so a re-rendered list keeps the same logical item focused.
  function keyOf(el) {
    if (el.id) return '#' + el.id;
    var c = (el.className || '').split(/\s+/).filter(function (x) { return x && x !== 'nav-hl' && x !== 'active' && x !== 'on'; })[0];
    // every data-* attribute that identifies the item (guide cell = data-c + data-p, match = data-fx, …);
    // before, only a few were used, so e.g. closing a guide reminder dialog sent the focus back to the tab bar.
    var d = '';
    for (var i = 0; i < el.attributes.length; i++) {
      var at = el.attributes[i];
      if (at.name.indexOf('data-') !== 0 || at.name === 'data-ic' || at.name === 'data-nav' || at.name === 'data-nonav') continue;
      d += '[' + at.name + '="' + String(at.value).replace(/["\\]/g, '\\$&') + '"]';
    }
    return c && d ? '.' + c + d : null;
  }
  function find(key) { if (!key) return null; try { var el = scopeEl().querySelector(key); return shown(el) ? el : null; } catch (e) { return null; } }

  function paint(el) {
    var old = document.querySelectorAll('.nav-hl'); for (var i = 0; i < old.length; i++) old[i].classList.remove('nav-hl');
    if (el) el.classList.add('nav-hl');
  }
  // 5.13.4: scrollIntoViewIfNeeded(false) leaves a card that is *almost* visible alone (the similar-works row stayed
  // 8 px under the window edge on the details page); after it, nudge every scrolling ancestor so the whole item shows.
  function scrollTo(el) {
    if (el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded(false); else el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    var r = el.getBoundingClientRect(), z = window.HK_ZOOM || 1, H = window.innerHeight / z, pad = 10;   // pad covers the 1.05 focus scale
    for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (!/(auto|scroll)/.test(cs.overflowY) || p.scrollHeight <= p.clientHeight + 1) continue;
      var pr = p.getBoundingClientRect(), bottom = Math.min(pr.bottom, H), top = Math.max(pr.top, 0);
      if (r.bottom > bottom && r.height < bottom - top) p.scrollTop += Math.ceil(r.bottom - bottom + pad);
      else if (r.top < top && r.height < bottom - top) p.scrollTop -= Math.ceil(top - r.top + pad);
      r = el.getBoundingClientRect();
    }
    // guide: the channel-name column is sticky over the timeline, so "visible in the scroller" can still mean hidden
    // under it — slide the timeline until the programme clears the column.
    var gs = el.classList.contains('gp') && el.closest('.gscroll'), ch = gs && el.closest('.grow') && el.closest('.grow').querySelector('.gch');
    if (gs && ch) {
      var cb = ch.getBoundingClientRect(), sb = gs.getBoundingClientRect(); r = el.getBoundingClientRect();
      var visL = cb.left > sb.left + 4 ? sb.left : cb.right, visR = cb.left > sb.left + 4 ? cb.left : sb.right;   // column on the right (RTL) or left (LTR)
      if (r.width < visR - visL) {
        if (r.right > visR) gs.scrollLeft += Math.ceil(r.right - visR + pad);
        else if (r.left < visL) gs.scrollLeft -= Math.ceil(visL - r.left + pad);
      }
    }
  }

  function set(el, opts) {
    cur = el || null; curKey = el ? keyOf(el) : null; paint(cur);
    if (!cur) return;
    // Real DOM focus only for non-text controls; a text input gets focus on OK (opens the keyboard).
    if (!isText(cur)) { if (!/^(BUTTON|INPUT|SELECT|A)$/.test(cur.tagName) && !cur.hasAttribute('tabindex')) cur.tabIndex = -1; try { cur.focus({ preventScroll: true }); } catch (e) { cur.focus(); } }
    else if (document.activeElement && document.activeElement !== cur && isText(document.activeElement)) document.activeElement.blur();
    if (!opts || opts.scroll !== false) scrollTo(cur);
  }
  function current() {
    if (cur && attached(cur) && shown(cur)) return cur;
    var re = find(curKey); if (re) { cur = re; paint(cur); return cur; }
    cur = null; return null;
  }
  function firstDefault(id) {
    var sels = defaults[id]; var list = sels ? sels.split(',') : [];
    for (var i = 0; i < list.length; i++) { var el = find(list[i].trim()); if (el) return el; }
    return null;
  }

  // #guide: coming back from the category list lands on the programme you left, not the first row
  var REGIONS = '.shelf-row, #hero, #categories, #content, #guide, header, .toolbar, .p-top, .p-bottom-wrap, #d-ep-list';
  var regionMem = {};
  function regionOf(el) { return el.closest(REGIONS); }
  // A target whose centre is covered by another element (sticky bars, overlays) is not a real destination.
  function zoomOf() { var z = window.HK_ZOOM || 1; if (z === 1) return 1; var b = document.body.getBoundingClientRect().width; return Math.abs(b * z - window.innerWidth) < 4 ? z : 1; }
  function covered(el) {
    var r = el.getBoundingClientRect(), z = zoomOf();
    var x = (r.left + r.width / 2) * z, y = (r.top + Math.min(r.height / 2, 24)) * z;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;   // off-screen: will be scrolled into view
    var hit = document.elementFromPoint(x, y);
    if (!hit || hit === el || el.contains(hit) || hit.closest('.saver')) return false;
    // 5.13.8: scrolled out of its own list (above / below the visible part of #content, #categories, …) — whatever is
    // painted there (the search bar, the header) is not "on top" of it; set() scrolls it back in. Before, going Up in
    // a long channel / film / category list jumped to the search box once the row above had scrolled under it.
    for (var sp = el.parentElement; sp && sp !== document.body; sp = sp.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(sp).overflowY) || sp.scrollHeight <= sp.clientHeight + 1) continue;
      var spr = sp.getBoundingClientRect(), cy = r.top + Math.min(r.height / 2, 24);
      if (cy < spr.top || cy > spr.bottom) return false;
      break;
    }
    if (hit.contains(el)) return false;
    // 5.13.4: under a sticky part of its own scroller (guide programmes that slid under the channel-name column on a
    // narrow window) it is still a real destination — set() scrolls it out. Before, Right from the guide jumped to the
    // category list instead of going back in time.
    var sc = el.closest('.gscroll, .shelf-row, #content, #d-similar');
    if (sc && sc.contains(hit) && getComputedStyle(hit.closest('.gch, [style*="sticky"]') || hit).position === 'sticky') return false;
    return true;
  }
  function inView(el, box) { var a = el.getBoundingClientRect(), b = box.getBoundingClientRect(); return a.bottom > b.top && a.top < b.bottom; }
  // 5.9.2: for overlapping boxes measure how far apart they really are, not their centres
  // (a wide EPG row's centre is far from the small buttons right above it, so the header used to win).
  function near(ac, bc, a1, a2, b1, b2) { var p = Math.min(Math.max(ac, b1), b2), q = Math.min(Math.max(bc, a1), a2); return Math.abs(p - q); }
  function move(dir) {
    var from = current();
    if (!from) { var d = firstDefault(scopeId()) || candidates()[0]; if (d) set(d); return !!d; }
    // 5.13.4: guide programmes — left/right go to the neighbouring programme of the same channel by order, not by
    // geometry: on a narrow window the next one can sit under the sticky channel column or past the scroller edge,
    // and the geometric search then skipped it (focus jumped to the category list).
    if ((dir === 'left' || dir === 'right') && from.classList.contains('gp') && from.parentElement) {
      var cells = [].slice.call(from.parentElement.querySelectorAll('.gp')).filter(shown);
      cells.sort(function (p, q) { return p.getBoundingClientRect().left - q.getBoundingClientRect().left; });
      var gi = cells.indexOf(from), gn = cells[gi + (dir === 'right' ? 1 : -1)];
      if (gi >= 0 && gn) { set(gn); return true; }
      if (gi >= 0) return false;   // first / last programme: stay (same rule as the end of any row)
    }
    var a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var best = null, bestScore = Infinity, list = candidates(), scored = [], side = (dir === 'left' || dir === 'right') ? [] : null;
    // 5.13.5: left/right inside the header stay in the header — a card scrolled up under the header (its box still
    // overlaps the header row) was picked as the «neighbour» of a header button.
    var fromHdr = !!(side && from.closest('header'));
    // 6.0: the header is now a vertical rail beside the page on wide screens. Left/Right from the rail must enter
    // the page (it used to stay in the header, so the remote could never leave the rail), and Left/Right at the edge
    // of the page next to the rail must enter the rail on its active tab.
    var hdrEl = document.querySelector('.screen:not(.hidden) header nav') || document.querySelector('.screen:not(.hidden) header'), hr = hdrEl && hdrEl.getBoundingClientRect();
    var railMode = !!(hr && hr.height > hr.width * 1.5 && hr.width < window.innerWidth / 2);
    if (railMode && side) {
      var rtl = getComputedStyle(hdrEl).direction === 'rtl' || document.documentElement.dir === 'rtl';
      var intoPage = rtl ? 'left' : 'right';
      if (fromHdr && dir === intoPage) {
        var pageEls = candidates().filter(function (el) { return !el.closest('header') && !covered(el); });
        var mem = find(regionMem.__page), pick = mem && pageEls.indexOf(mem) >= 0 ? mem : null;
        if (!pick) {
          var bs = Infinity;
          for (var q = 0; q < pageEls.length; q++) { var pr = pageEls[q].getBoundingClientRect(); if (pr.bottom < 0 || pr.top > window.innerHeight / zoomOf()) continue;
            var sc = Math.abs(pr.top + pr.height / 2 - ay) + (rtl ? (hr.left - pr.right) : (pr.left - hr.right)) * 0.5; if (sc < bs) { bs = sc; pick = pageEls[q]; } }
        }
        if (pick) { set(pick); return true; }
        return false;
      }
      if (fromHdr) return false;   // towards the screen edge: stay
    }
    for (var i = 0; i < list.length; i++) {
      var el = list[i]; if (el === from || from.contains(el) || el.contains(from)) continue;
      if (fromHdr && !el.closest('header')) continue;
      var b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2, gap, perp, overlap;
      if (dir === 'right') { if (bx <= ax + 1 || b.right <= a.right - 1) continue; gap = Math.max(0, b.left - a.right); overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); perp = overlap > 0 ? 0 : Math.abs(by - ay); }
      else if (dir === 'left') { if (bx >= ax - 1 || b.left >= a.left + 1) continue; gap = Math.max(0, a.left - b.right); overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); perp = overlap > 0 ? 0 : Math.abs(by - ay); }
      else if (dir === 'down') { if (by <= ay + 1 || b.bottom <= a.bottom - 1) continue; gap = Math.max(0, b.top - a.bottom); overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left); perp = overlap > 0 ? near(ax, bx, a.left, a.right, b.left, b.right) * 0.1 : Math.abs(bx - ax); }
      else { if (by >= ay - 1 || b.top >= a.top + 1) continue; gap = Math.max(0, a.top - b.bottom); overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left); perp = overlap > 0 ? near(ax, bx, a.left, a.right, b.left, b.right) * 0.1 : Math.abs(bx - ax); }
      // Left/right only move along the same row: at the end of a row the focus stays put (it used to jump to the
      // header / search box, far from where the user was looking).
      if ((dir === 'left' || dir === 'right') && !(overlap > 0)) { if (side) side.push([gap + perp * 3, el]); continue; }
      var score = gap + perp * 3;
      scored.push([score, el]);
    }
    // 5.13.5: …except between the category list and the main area beside it (both ways). With nothing level with the
    // current category (short list, «no guide» message, a category low in a long list) Left/Right did nothing at all
    // on the TV. Only side-by-side panels count: never the header, never the same region.
    if (!scored.length && railMode && side && dir === (getComputedStyle(hdrEl).direction === 'rtl' || document.documentElement.dir === 'rtl' ? 'right' : 'left')) {
      var at0 = hdrEl.querySelector('.tab.active'); regionMem.__page = keyOf(from);
      if (shown(at0)) { set(at0); return true; }
    }
    if (!scored.length && side && side.length && !from.closest('header, .toolbar')) {
      var rf = regionOf(from);
      for (var j = 0; j < side.length; j++) {
        var re = regionOf(side[j][1]);
        if (re !== rf && !side[j][1].closest('header, .toolbar') && ((rf && rf.id === 'categories') || (re && re.id === 'categories'))) scored.push(side[j]);
      }
    }
    // 6.0: the toolbar floats over the scrolled page — Up from a shelf must scroll back to what is above it in the page
    // (the hero's Play), not jump to the search box painted over it.
    if (dir === 'up' && from.closest('#content')) {
      var inPage = scored.filter(function (x) { return x[1].closest('#content'); });
      if (inPage.length) scored = inPage;
    }
    // 7.0.7: with the sections in a top bar, the toolbar (search · filter · customise) sits between the bar and the page.
    // Down from the bar and Up from the page's first row must stop there, not jump over it.
    if (!railMode && (dir === 'down' && from.closest('header') || dir === 'up' && from.closest('#content, #categories'))) {
      var tb = scored.filter(function (x) { return x[1].closest('.toolbar'); });
      if (tb.length && (dir === 'down' || !scored.some(function (x) { return x[1].closest('#content, #categories') && !x[1].closest('.toolbar'); }))) scored = tb;
    }
    scored.sort(function (p, q) { return p[0] - q[0]; });
    for (var s = 0; s < scored.length && s < 12; s++) { if (!covered(scored[s][1])) { best = scored[s][1]; break; } }
    if (!best && scored.length) best = scored[0][1];
    if (best) {
      // Entering another region (categories ↔ grid ↔ header): go back to where we were in it, or its active item.
      var ra = regionOf(from), rb = regionOf(best);
      if (rb && rb !== ra) {
        if (ra) regionMem[ra.id || ra.className] = keyOf(from);
        var back = find(regionMem[rb.id || rb.className]) || (function () { var x = rb.querySelector(rb.id === 'hero' ? '.primary' : '.active'); return shown(x) ? x : null; })();   // 6.0: entering the hero lands on Play
        // 5.13.7: Up into the header always lands on the tab of the section on screen — not on the last header button
        // used («خروج», «الإعدادات», …) nor on whatever happens to sit above. People go up to change section; landing
        // on «خروج» was confusing and one OK away from logging out. Left/Right from the tab reach the other buttons.
        if (rb.tagName === 'HEADER' && dir === 'up') { var at = rb.querySelector('.tab.active'); if (shown(at)) back = at;
          // 7.0.7: top bar — reaching it brings the page back to its top (the hero slid half under the bar otherwise)
          var scr = rb.closest('.screen'); if (scr && !railMode) [scr].concat([].slice.call(scr.querySelectorAll('main, #content'))).forEach(function (e) { if (e.scrollTop) e.scrollTop = 0; }); }
        // the category list always returns to its active item (scrolled into view); shelves only if it is visible
        if (back && rb.contains(back) && (inView(back, rb) || rb.id === 'categories' || rb.id === 'hero')) best = back;   // 6.0: shelf rows share one memory key — never jump to another row's card
      }
      set(best);
    }
    return !!best;
  }

  function activate() {
    var el = current(); if (!el) return false;
    if (isText(el)) { el.focus(); if (el.select) try { el.select(); } catch (e) {} return true; }
    if (el.tagName === 'SELECT') { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    el.click(); return true;
  }

  window.Nav = {
    set: set, move: move, activate: activate, current: current,
    clear: function () { cur = null; curKey = null; paint(null); },
    inside: function (sel) { var c = current(); return !!(c && c.closest(sel)); },
    typing: function () { return isText(document.activeElement); },
    stopTyping: function () { if (isText(document.activeElement)) { var el = document.activeElement; el.blur(); set(el, { scroll: false }); } },
    defaults: function (map) { for (var k in map) defaults[k] = map[k]; },
    remember: function (id) { if (id && cur) memory[id] = curKey; },
    restore: function (id) { var el = find(memory[id]) || firstDefault(id); if (el) set(el); else this.clear(); },
    keyboardMode: function (on) { root.classList.toggle('kbd', !!on); }
  };

  // Pointer (mouse / LG Magic Remote) hides the D-pad highlight; any arrow brings it back.
  var lastX = -1, lastY = -1;
  document.addEventListener('mousemove', function (e) { if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 3) { lastX = e.clientX; lastY = e.clientY; root.classList.remove('kbd'); } }, true);
  document.addEventListener('mousedown', function () { root.classList.remove('kbd'); }, true);
})();
