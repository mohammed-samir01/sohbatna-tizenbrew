/* Loaded FIRST. Runtime gaps on older webOS Chromium (68–87); no-ops on Electron. */
(function (g) {
  if (typeof globalThis === 'undefined') g.globalThis = g;
  if (!Object.fromEntries) Object.fromEntries = function (it) { var o = {}; Array.from(it).forEach(function (kv) { o[kv[0]] = kv[1]; }); return o; };
  if (!Array.prototype.flat) Object.defineProperty(Array.prototype, 'flat', { configurable: true, writable: true, value: function (d) { d = d === undefined ? 1 : d; return d < 1 ? this.slice() : this.reduce(function (a, v) { return a.concat(Array.isArray(v) ? v.flat(d - 1) : v); }, []); } });
  if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, 'flatMap', { configurable: true, writable: true, value: function (f, t) { return this.map(f, t).flat(); } });
  if (!String.prototype.replaceAll) String.prototype.replaceAll = function (a, b) { return a instanceof RegExp ? this.replace(a, b) : this.split(a).join(b); };
  if (!Element.prototype.remove) Element.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
})(typeof window !== 'undefined' ? window : this);
