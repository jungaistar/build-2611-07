/* 자료 목록 화면 — 등록·찾기 규칙은 customs.js(lib*)가 한다. 여기서는 그리고 이 브라우저에 기억한다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var C = window.Customs, KEY = 'b2611-07.lib';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var state = { list: read(), cat: '' };
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { return []; } }
  function save() { localStorage.setItem(KEY, JSON.stringify(state.list)); }
  function msg(html, cls) { $('l-msg').innerHTML = html ? '<div class="' + (cls || 'ok') + '">' + html + '</div>' : ''; }
  function stamp() { return new Date().toISOString(); }

  function loc(x) {
    var k = C.libLocationKind(x.location);
    if (k === 'url') return '<a href="' + esc(x.location) + '" target="_blank" rel="noopener">' + esc(x.location) + '</a>';
    if (k === 'none') return '<span class="sub">—</span>';
    return esc(x.location) + ' <button class="x" data-copy="' + esc(x.id) + '" type="button">경로 복사</button>';
  }
  function render() {
    var counts = C.libCounts(state.list);
    $('l-cats').innerHTML = ['<button type="button" data-cat=""' + (state.cat ? '' : ' class="on"') + '>전체 ' + state.list.length + '</button>']
      .concat(C.LIB_CATEGORIES.map(function (c) { return '<button type="button" data-cat="' + esc(c) + '"' + (state.cat === c ? ' class="on"' : '') + '>' + esc(c) + ' ' + (counts[c] || 0) + '</button>'; })).join('');
    var rows = C.libSearch(state.list, $('l-q').value, state.cat);
    $('l-table').innerHTML = !state.list.length ? '<p class="sub">아직 등록한 자료가 없습니다.</p>' :
      '<div class="tablewrap"><table class="lib"><thead><tr><th>파일 이름</th><th>분류</th><th>설명</th><th>사내 위치</th><th>담당</th><th>등록일</th><th></th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr data-id="' + esc(x.id) + '"><td><b>' + esc(x.name) + '</b></td><td><span class="tag">' + esc(x.category) + '</span></td><td class="desc">' + esc(x.desc) + '</td><td class="loc">' + loc(x) +
          '</td><td>' + esc(x.owner) + '</td><td>' + esc(x.added) + '</td><td><button class="x" data-del="' + esc(x.id) + '" type="button">지우기</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="sub" style="margin-top:8px">' + rows.length + '건 보임 · 전체 ' + state.list.length + '건</p>';
  }
  function add() {
    var e = { name: $('l-name').value, category: $('l-cat').value, desc: $('l-desc').value, location: $('l-loc').value, owner: $('l-owner').value };
    var r = C.libAdd(state.list, e, stamp());
    if (r.errors.length) { msg(r.errors.map(esc).join('<br>'), 'warn'); return; }
    state.list = r.list; save(); $('lib-form').reset(); msg('등록했습니다: ' + esc(r.list[r.list.length - 1].name)); render();
  }

  $('l-cat').innerHTML = C.LIB_CATEGORIES.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('btn-lib-add').addEventListener('click', add);
  $('lib-form').addEventListener('submit', function (e) { e.preventDefault(); add(); });
  $('btn-lib-sample').addEventListener('click', function () {
    var n = 0; C.libSample().forEach(function (e) { var r = C.libAdd(state.list, e, stamp()); if (!r.errors.length) { state.list = r.list; n++; } });
    save(); msg(n ? '예시 ' + n + '건을 넣었습니다(실제 사내 자료가 아닙니다).' : '예시가 이미 들어 있습니다.', n ? 'ok' : 'note'); render();
  });
  $('l-import').addEventListener('change', function () {
    var f = this.files[0]; if (!f) return; var input = this;
    var rd = new FileReader();
    rd.onload = function (ev) {
      try {
        var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
        var r = C.libFromRows(rows, state.list, stamp());
        state.list = r.list; save(); render();
        msg(r.added + '건을 불러왔습니다.' + (r.errors.length ? '<br>넘긴 줄: ' + r.errors.slice(0, 5).map(esc).join(' / ') : ''), r.added ? 'ok' : 'warn');
      } catch (err) { msg('파일을 읽지 못했습니다: ' + esc(err.message), 'warn'); }
      input.value = '';
    };
    rd.readAsArrayBuffer(f);
  });
  $('l-q').addEventListener('input', render);
  $('l-cats').addEventListener('click', function (e) { var b = e.target.closest('button[data-cat]'); if (b) { state.cat = b.dataset.cat; render(); } });
  $('l-table').addEventListener('click', function (e) {
    var id = e.target.dataset.del;
    if (id) { state.list = C.libRemove(state.list, id); save(); render(); return; }
    var cp = e.target.dataset.copy;
    if (cp) {
      var x = state.list.filter(function (y) { return y.id === cp; })[0];
      if (x && navigator.clipboard) navigator.clipboard.writeText(x.location).then(function () { msg('경로를 복사했습니다. 파일 탐색기 주소창에 붙여 넣으세요.'); }, function () { msg('복사하지 못했습니다. 경로를 직접 골라 복사해 주세요.', 'warn'); });
    }
  });
  $('btn-lib-xlsx').addEventListener('click', function () {
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(C.libToAoa(state.list)), '자료목록');
    XLSX.writeFile(wb, '통관자료목록.xlsx');
  });
  render();
})();
