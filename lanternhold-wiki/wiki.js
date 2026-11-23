/* Lanternhold Wiki: instant search over search.json, and "/" to focus it. */
(function () {
  'use strict';
  var q = document.getElementById('q'), box = document.getElementById('results');
  if (!q || !box) return;
  var data = null, loading = null, hits = [], sel = 0;
  function load() {
    if (data || loading) return loading;
    loading = fetch('/wiki/search.json').then(function (r) { return r.json(); }).then(function (d) {
      data = d.map(function (e) { e.lt = e.t.toLowerCase(); e.lx = e.x.toLowerCase(); e.lk = (e.k || '').toLowerCase(); return e; });
      run();
    }).catch(function () { loading = null; });
    return loading;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mark(s, words) {
    var out = esc(s);
    words.forEach(function (w) { if (w.length > 1) out = out.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); });
    return out;
  }
  function score(e, words, full) {
    var s = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], t = e.lt.indexOf(w);
      if (t === 0) s += 12; else if (t > 0) s += (e.lt.charAt(t - 1) === ' ' ? 8 : 4);
      else if (e.lk.indexOf(w) >= 0) s += 3;
      else if (e.lx.indexOf(w) >= 0) s += 1;
      else return 0;
    }
    if (e.lt === full) s += 30;
    if (e.u.indexOf('#') < 0) s += 2;
    return s;
  }
  function run() {
    var v = q.value.trim().toLowerCase();
    if (!v) { box.hidden = true; return; }
    if (!data) { load(); return; }
    var words = v.split(/\s+/).filter(Boolean), seen = {};
    hits = data.map(function (e) { return [score(e, words, v), e]; }).filter(function (x) { return x[0] > 0; })
      .sort(function (a, b) { return b[0] - a[0]; }).map(function (x) { return x[1]; })
      .filter(function (e) { var k = e.t + '|' + e.u; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 12);
    sel = 0;
    box.innerHTML = hits.length ? hits.map(function (e, i) {
      return '<a href="' + e.u + '"' + (i === 0 ? ' class="on"' : '') + '><b>' + mark(e.t, words) + '</b>' + (e.k ? '<em>' + esc(e.k) + '</em>' : '') + '<small>' + mark(e.x, words) + '</small></a>';
    }).join('') : '<div class="none">Nothing found for “' + esc(q.value.trim()) + '”. Try a class, item, monster or region.</div>';
    box.hidden = false;
  }
  function move(d) {
    var a = box.querySelectorAll('a'); if (!a.length) return;
    a[sel] && a[sel].classList.remove('on'); sel = (sel + d + a.length) % a.length; a[sel].classList.add('on'); a[sel].scrollIntoView({ block: 'nearest' });
  }
  q.addEventListener('focus', load);
  q.addEventListener('input', run);
  q.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { var a = box.querySelectorAll('a')[sel]; if (a) { e.preventDefault(); location.href = a.href; box.hidden = true; } }
    else if (e.key === 'Escape') { box.hidden = true; q.blur(); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.search')) box.hidden = true; });
  box.addEventListener('click', function () { box.hidden = true; });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== q && !/input|textarea/i.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); q.focus(); }
  });
  var m = location.search.match(/[?&]q=([^&]+)/);
  if (m) { q.value = decodeURIComponent(m[1].replace(/\+/g, ' ')); q.focus(); run(); }
})();
