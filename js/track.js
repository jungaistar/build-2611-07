/* 화물 추적 화면 — 판정·초안은 cargo.js 가 한다. 여기서는 읽고, 그리고, 이 브라우저에 기억할 뿐이다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var G = window.Cargo;
  var LS = 'b2611-07.cargo', LS_KEY = 'b2611-07.cargo.key';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var state = load();
  var pending = { xlsx: null, xml: null };      // 반영 전 미리보기

  function load() {
    var d = null; try { d = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { d = null; }
    d = d || {};
    return { list: d.list || [], targets: d.targets || G.DEFAULT_TARGETS.slice(), templates: d.templates || {}, sender: d.sender || '', hours: d.hours || Object.assign({}, G.DEFAULT_HOURS), api: d.api || { year: '', kind: 'hbl' } };
  }
  function save() { localStorage.setItem(LS, JSON.stringify({ v: 1, list: state.list, targets: state.targets, templates: state.templates, sender: state.sender, hours: state.hours, api: state.api })); }
  function now() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function msg(id, html, cls) { $(id).innerHTML = html ? '<div class="' + (cls || 'note') + '">' + html + '</div>' : ''; }
  function copy(text, btn) {
    var done = function () { if (btn) { var o = btn.textContent; btn.textContent = '복사했습니다'; setTimeout(function () { btn.textContent = o; }, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    else { fallback(text); done(); }
  }
  function fallback(text) { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } document.body.removeChild(ta); }

  /* ---------- 등록 ---------- */
  function readForm() {
    return { bl: $('f-bl').value, ship: $('f-ship').value, eta: $('f-eta').value, memo: $('f-memo').value,
      requester: { name: $('f-req-name').value, email: $('f-req-email').value }, broker: { name: $('f-brk-name').value, email: $('f-brk-email').value } };
  }
  function clearForm() { ['f-bl', 'f-ship', 'f-eta', 'f-memo', 'f-req-name', 'f-req-email', 'f-brk-name', 'f-brk-email'].forEach(function (id) { $(id).value = ''; }); }
  function addOne() {
    var r = G.add(state.list, readForm(), now());
    if (r.errors.length) { msg('t-msg', '<b>등록하지 못했습니다</b><ul>' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>', 'warn'); return; }
    state.list = r.list; save(); clearForm(); render();
    msg('t-msg', 'BL ' + esc(r.item.bl) + ' 을(를) 등록했습니다. 아래 2 에서 진행 단계를 가져오면 현황에 보입니다.', 'ok');
  }

  /* ---------- 단계 가져오기 ---------- */
  function applyEvents(events, label, target) {
    var m = G.merge(state.list, events, now(), { autoAdd: true });
    state.list = m.list; save(); render();
    var h = '<b>' + esc(label) + '</b> — 새 단계 ' + m.added.length + '건' + (m.created.length ? ', 새로 등록한 BL ' + m.created.length + '건(' + esc(m.created.join(', ')) + ')' : '') +
      (events.length - m.added.length - m.skipped.length > 0 ? ', 이미 있던 단계 ' + (events.length - m.added.length - m.skipped.length) + '건은 넘김' : '');
    if (m.skipped.length) h += '<ul>' + m.skipped.slice(0, 8).map(function (s) { return '<li>' + s.row + '행: ' + esc(s.reason) + '</li>'; }).join('') + (m.skipped.length > 8 ? '<li>외 ' + (m.skipped.length - 8) + '건</li>' : '') + '</ul>';
    var al = G.alerts(state.list, state.targets, state.hours).filter(function (a) { return m.added.some(function (x) { return x.id === a.id && x.key === a.key && x.at === a.at; }); });
    if (al.length) h += '<p style="margin:6px 0 0"><b>알림 대상 ' + al.length + '건</b>이 생겼습니다 — 아래 4 에서 메일 초안을 확인하세요.</p>';
    msg(target, h, m.skipped.length ? 'warn' : 'ok');
  }
  // (a) ERP 엑셀
  function readXlsx(file) {
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
        useAoa(aoa, file.name);
      } catch (err) { msg('t-xlsx-msg', '파일을 읽지 못했습니다: ' + esc(err.message), 'warn'); }
    };
    rd.readAsArrayBuffer(file);
  }
  // 머리글 줄 찾기: 처음 10줄 중 BL·처리단계 열이 가장 많이 맞는 줄
  function useAoa(aoa, name) {
    var best = 0, bestN = -1;
    aoa.slice(0, 10).forEach(function (row, i) { var n = Object.keys(G.mapHeaders(row.map(String)).map).length; if (n > bestN) { bestN = n; best = i; } });
    var headers = aoa[best].map(function (h, i) { return String(h).trim() || ('열' + (i + 1)); });
    var rows = aoa.slice(best + 1).map(function (r) { var o = {}; headers.forEach(function (h, i) { o[h] = r[i] == null ? '' : r[i]; }); return o; });
    pending.xlsx = { name: name, headers: headers, rows: rows, map: G.mapHeaders(headers).map };
    renderXlsxMap();
  }
  function renderXlsxMap() {
    var p = pending.xlsx; if (!p) { $('t-xlsx-map').innerHTML = ''; return; }
    var missing = G.EFIELDS.filter(function (f) { return f.req && !p.map[f.key]; }).map(function (f) { return f.label; });
    var h = '<p class="sub" style="margin:10px 0 4px"><b>' + esc(p.name) + '</b> · ' + p.rows.length + '줄 · 열: ' + esc(p.headers.join(', ')) + '</p>';
    if (missing.length) h += '<div class="warn">이 열을 찾지 못했습니다: <b>' + esc(missing.join(', ')) + '</b>. 엑셀의 어느 열인지 골라 주세요.</div>';
    h += '<table class="map"><thead><tr><th>필요한 항목</th><th>엑셀 열</th></tr></thead><tbody>' + G.EFIELDS.map(function (f) {
      return '<tr' + (f.req && !p.map[f.key] ? ' class="flag"' : '') + '><td>' + esc(f.label) + (f.req ? ' <small class="req">필수</small>' : ' <small class="sub">선택</small>') + '</td><td><select data-xmap="' + f.key + '"><option value="">(없음)</option>' +
        p.headers.map(function (hd) { return '<option' + (hd === p.map[f.key] ? ' selected' : '') + '>' + esc(hd) + '</option>'; }).join('') + '</select></td></tr>';
    }).join('') + '</tbody></table><div class="btnrow"><button class="btn primary" id="btn-xlsx-apply" type="button"' + (missing.length ? ' disabled' : '') + '>이 엑셀의 단계를 반영</button></div>';
    $('t-xlsx-map').innerHTML = h;
    $('btn-xlsx-apply').addEventListener('click', function () { var ev = G.eventsFromRows(p.rows, p.map); pending.xlsx = null; renderXlsxMap(); applyEvents(ev, 'ERP 엑셀 ' + p.name, 't-xlsx-msg'); });
  }
  // (b) 유니패스 XML
  function readXML() {
    var r = G.parseUnipassXML($('t-xml').value);
    pending.xml = r.events.length ? r : null;
    if (!r.events.length) { $('t-xml-out').innerHTML = ''; msg('t-xml-msg', esc(r.error || '읽을 단계가 없습니다.'), 'warn'); return; }
    msg('t-xml-msg', '');
    $('t-xml-out').innerHTML = '<p class="sub" style="margin:10px 0 4px">BL <b>' + esc(r.bl || '(응답에 BL 없음)') + '</b>' + (r.ship ? ' · ' + esc(r.ship) : '') + (r.status ? ' · 진행상태 ' + esc(r.status) : '') + ' · 단계 ' + r.events.length + '건</p>' +
      '<div class="tablewrap"><table><thead><tr><th>처리일시</th><th>처리구분(원문)</th><th>읽은 단계</th><th>장치장</th></tr></thead><tbody>' + r.events.map(function (e) {
        var st = G.classifyStage(e.stage), at = G.parseDateTime(e.at);
        return '<tr' + (!at ? ' class="flag"' : '') + '><td>' + esc(at || ('읽지 못함: ' + e.at)) + '</td><td>' + esc(e.stage) + '</td><td>' + (st.key === 'other' ? '<span class="tag">그 밖</span>' : '<span class="tag ok-t">' + esc(st.label) + '</span>') + '</td><td>' + esc(e.place) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (!r.bl ? '<label class="ctrl" style="margin-top:8px">이 단계를 붙일 BL <select id="t-xml-bl">' + state.list.map(function (x) { return '<option value="' + esc(x.bl) + '">' + esc(x.bl) + '</option>'; }).join('') + '</select></label>' : '') +
      '<div class="btnrow"><button class="btn primary" id="btn-xml-apply" type="button">이 단계를 반영</button></div>';
    $('btn-xml-apply').addEventListener('click', function () {
      var bl = r.bl || ($('t-xml-bl') && $('t-xml-bl').value); if (!bl) { msg('t-xml-msg', '붙일 BL 이 없습니다. 먼저 1 에서 등록해 주세요.', 'warn'); return; }
      var ev = r.events.map(function (e) { return Object.assign({}, e, { bl: bl }); });
      pending.xml = null; $('t-xml-out').innerHTML = ''; $('t-xml').value = '';
      applyEvents(ev, '유니패스 조회 결과', 't-xml-msg');
    });
  }
  // (c) OpenAPI 직접 조회 — 키를 넣고 단추를 눌렀을 때만 부른다
  function callAPI() {
    var key = $('api-key').value.trim(), bl = $('api-bl').value;
    if (!key) { msg('api-msg', '인증키를 넣어 주세요. 키는 이 브라우저에만 저장됩니다.', 'warn'); return; }
    if (!bl) { msg('api-msg', '조회할 BL 을 먼저 1 에서 등록해 주세요.', 'warn'); return; }
    localStorage.setItem(LS_KEY, key); state.api = { year: $('api-year').value.trim(), kind: $('api-kind').value }; save();
    var url = G.apiUrl({ key: key, bl: bl, year: state.api.year, kind: state.api.kind });
    msg('api-msg', '조회하는 중입니다… ' + esc(G.maskKey(url)), 'note');
    $('btn-api').disabled = true;
    fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (xml) {
        var p = G.parseUnipassXML(xml);
        if (!p.events.length) { msg('api-msg', '응답은 받았지만 단계가 없습니다: ' + esc(p.error || ''), 'warn'); return; }
        applyEvents(p.events.map(function (e) { return Object.assign({}, e, { bl: bl }); }), 'OpenAPI 조회 ' + bl, 'api-msg');
      })
      .catch(function (err) {
        msg('api-msg', '<b>브라우저에서 직접 조회하지 못했습니다</b>(' + esc(err.message) + '). 관세청 서버가 다른 사이트의 브라우저 요청을 막거나(CORS) 사내망 제한일 수 있습니다.<br>' +
          '아래 주소를 복사해 새 탭에 붙여 넣어 열고, 나온 XML 전체를 위 (b) 칸에 붙여 넣어 주세요.<br><code>' + esc(G.maskKey(url)) + '</code> <button class="x" id="btn-api-copy" type="button">조회 주소 복사(키 포함)</button>', 'warn');
        $('btn-api-copy').addEventListener('click', function () { copy(url, this); });
      })
      .then(function () { $('btn-api').disabled = false; });
  }

  /* ---------- 현황 ---------- */
  function chips(item) {
    var p = G.progress(item);
    return '<span class="chips">' + G.STAGES.map(function (s, i) { return '<span class="chip' + (p.done[i] ? ' done' : '') + '" title="' + esc(s.label) + '">' + (i + 1) + '</span>'; }).join('') + '</span>';
  }
  function renderList() {
    var al = G.alerts(state.list, state.targets, state.hours);
    $('api-bl').innerHTML = state.list.map(function (x) { return '<option value="' + esc(x.bl) + '">' + esc(x.bl) + (x.ship ? ' · ' + esc(x.ship) : '') + '</option>'; }).join('');
    if (!state.list.length) { $('t-list').innerHTML = '<p class="sub">등록한 BL 이 없습니다. 위 1 에서 등록하거나 「예제 넣기」를 눌러 보세요.</p>'; return; }
    var h = '<div class="tablewrap"><table class="ships"><thead><tr><th>BL 번호</th><th>선명 · 입항예정</th><th>최신 단계</th><th>진행</th><th>요청자 · 관세사</th><th>알림</th><th></th></tr></thead><tbody>';
    state.list.forEach(function (it) {
      var l = G.latest(it), ah = l ? G.isAfterHours(l.at, state.hours) : null, n = al.filter(function (a) { return a.id === it.id; }).length;
      h += '<tr data-bl="' + esc(it.bl) + '"' + (n ? ' class="flag"' : '') + '><td class="mono"><b>' + esc(it.bl) + '</b>' + (it.memo ? '<br><small class="sub">' + esc(it.memo) + '</small>' : '') + '</td>' +
        '<td class="wrapcell">' + esc(it.ship || '—') + (it.eta ? '<br><small class="sub">입항예정 ' + esc(it.eta) + '</small>' : '') + '</td>' +
        '<td class="wrapcell">' + (l ? '<b>' + esc(l.label) + '</b> <small class="sub">' + esc(l.at) + '</small>' + (ah ? ' <span class="tag ah-t">시간 외</span>' : '') + (l.place ? '<br><small class="sub">' + esc(l.place) + '</small>' : '') : '<span class="sub">아직 단계 없음</span>') + '</td>' +
        '<td>' + chips(it) + '</td>' +
        '<td class="wrapcell"><small>' + esc(it.requester.name || '—') + (it.requester.email ? ' · ' + esc(it.requester.email) : '') + '<br>' + esc(it.broker.name || '—') + (it.broker.email ? ' · ' + esc(it.broker.email) : '') + '</small></td>' +
        '<td>' + (n ? '<span class="tag bad-t">미통보 ' + n + '</span>' : '<span class="tag ok-t">통보 ' + G.notifiedCount(it) + '</span>') + '</td>' +
        '<td><button class="x" data-del="' + esc(it.id) + '" type="button">지우기</button></td></tr>';
    });
    $('t-list').innerHTML = h + '</tbody></table></div><p class="sub" style="margin-top:8px">진행: 1 입항보고 제출 · 2 하선신고 · 3 반입신고 · 4 수입신고 · 5 수입신고 수리 · 6 반출신고. 「시간 외」는 ' + esc(state.hours.start) + ' 전 · ' + esc(state.hours.end) + ' 이후 · 토·일 처리 건입니다(공휴일은 모릅니다).</p>';
  }

  /* ---------- 알림 ---------- */
  function renderTargets() {
    $('t-targets').innerHTML = G.STAGES.map(function (s) { return '<label class="chk" style="margin:0"><input type="checkbox" data-target="' + s.key + '"' + (state.targets.indexOf(s.key) >= 0 ? ' checked' : '') + '> ' + esc(s.label) + '</label>'; }).join('');
    $('t-sender').value = state.sender; $('h-start').value = state.hours.start; $('h-end').value = state.hours.end;
  }
  function renderAlerts() {
    var al = G.alerts(state.list, state.targets, state.hours);
    $('t-alert-count').textContent = al.length ? '미통보 ' + al.length + '건' : '미통보 없음';
    if (!al.length) { $('t-alerts').innerHTML = '<p class="sub">알릴 단계가 없습니다. 알림 대상 단계가 새로 생기면 여기에 메일 초안이 나옵니다.</p>'; return; }
    $('t-alerts').innerHTML = al.map(function (a, i) {
      var it = state.list.filter(function (x) { return x.id === a.id; })[0], ev = it.events.filter(function (e) { return G.evKey(e) === a.evKey; })[0];
      var d = G.mailDraft(it, ev, state.templates, state.sender);
      return '<div class="alert-box" data-alert="' + i + '"><div class="sec-h"><h3>BL ' + esc(a.bl) + ' · ' + esc(a.label) + '</h3><span class="tag">' + esc(a.at) + '</span>' + (a.afterHours ? '<span class="tag ah-t">시간 외</span>' : '') + (a.place ? '<span class="sub">' + esc(a.place) + '</span>' : '') + '</div>' +
        (d.to.length ? '<p class="sub">받는 사람: ' + esc(d.to.join(', ')) + '</p>' : '<div class="warn">관세사·요청자 메일 주소가 없습니다. 1 에서 지우고 다시 등록하거나, 아래 본문을 복사해 직접 보내 주세요.</div>') +
        (d.missing.length ? '<p class="sub">비어 있는 자리: ' + esc(d.missing.join(', ')) + ' — 초안에서 빠진 채로 들어갑니다.</p>' : '') +
        '<label class="sub">제목<input type="text" class="al-subject" value="' + esc(d.subject) + '"></label>' +
        '<textarea class="al-body" rows="' + Math.min(14, d.body.split('\n').length + 1) + '">' + esc(d.body) + '</textarea>' +
        '<div class="btnrow"><a class="btn primary al-mailto" href="' + esc(d.mailto) + '"' + (d.to.length ? '' : ' aria-disabled="true"') + '>메일 앱으로 열기</a>' +
        '<button class="btn al-copy" type="button">본문 복사</button><button class="btn al-kakao" type="button" data-text="' + esc(G.kakaoText(it, ev)) + '">카톡용 한 줄 복사</button>' +
        '<button class="btn green al-done" type="button" data-id="' + esc(a.id) + '" data-evk="' + esc(a.evKey) + '">통보함으로 표시</button></div></div>';
    }).join('');
  }
  function renderTemplates() {
    var T = G.mergeTemplates(state.templates);
    $('t-tpl').innerHTML = Object.keys(T).map(function (k) {
      var name = k === 'arrival' ? '입항보고 제출' : k === 'declared' ? '수입신고' : '그 밖의 단계';
      return '<div class="sec"><h3>' + esc(name) + '</h3><label class="sub">제목<input type="text" data-tpl="' + k + '" data-part="subject" value="' + esc(T[k].subject) + '"></label><textarea data-tpl="' + k + '" data-part="body" rows="7">' + esc(T[k].body) + '</textarea></div>';
    }).join('') + '<p class="sub">쓸 수 있는 자리: ' + G.VARS.map(function (v) { return '{' + v + '}'; }).join(' ') + '</p>';
  }
  function render() { renderList(); renderAlerts(); }

  /* ---------- 엑셀 ---------- */
  function exportXlsx() {
    var wb = XLSX.utils.book_new();
    G.exportBook(state.list, state.targets, state.hours).forEach(function (sh) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.aoa), sh.name); });
    XLSX.writeFile(wb, '수입보세화물_추적_' + now().slice(0, 10) + '.xlsx');
  }

  /* ---------- 이벤트 ---------- */
  $('btn-add').addEventListener('click', addOne);
  $('btn-sample').addEventListener('click', function () { state.list = G.sample(new Date()); save(); render(); msg('t-msg', '예제 BL 3건(가짜 화물)을 넣었습니다. 2번 BL 의 입항보고는 이미 통보한 것으로 두었습니다. 예제는 실제 화물이 아닙니다.', 'ok'); });
  $('btn-clear').addEventListener('click', function () { state.list = []; save(); render(); msg('t-msg', '등록한 BL 과 단계를 모두 지웠습니다.', 'ok'); });
  $('t-list').addEventListener('click', function (e) { var id = e.target.dataset.del; if (!id) return; state.list = G.remove(state.list, id); save(); render(); });
  var drop = $('t-drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) readXlsx(e.dataTransfer.files[0]); });
  $('t-file').addEventListener('change', function () { if (this.files[0]) readXlsx(this.files[0]); this.value = ''; });
  $('btn-xlsx-sample').addEventListener('click', function () { useAoa(G.sampleRows(new Date()), '예제_수입화물진행현황(가짜).xlsx'); });
  $('t-xlsx-map').addEventListener('change', function (e) { var k = e.target.dataset.xmap; if (!k || !pending.xlsx) return; pending.xlsx.map[k] = e.target.value; renderXlsxMap(); });
  $('btn-xml-read').addEventListener('click', readXML);
  $('btn-xml-sample').addEventListener('click', function () { $('t-xml').value = G.sampleXML(new Date()); readXML(); });
  $('btn-api').addEventListener('click', callAPI);
  $('api-key').value = localStorage.getItem(LS_KEY) || ''; $('api-year').value = state.api.year || ''; $('api-kind').value = state.api.kind || 'hbl';
  $('t-targets').addEventListener('change', function (e) { var k = e.target.dataset.target; if (!k) return; state.targets = G.STAGES.map(function (s) { return s.key; }).filter(function (s) { var el = document.querySelector('[data-target="' + s + '"]'); return el && el.checked; }); save(); render(); });
  $('t-sender').addEventListener('change', function () { state.sender = this.value.trim(); save(); renderAlerts(); });
  ['h-start', 'h-end'].forEach(function (id) { $(id).addEventListener('change', function () { var v = this.value; if (/^\d{2}:\d{2}$/.test(v)) { state.hours[id === 'h-start' ? 'start' : 'end'] = v; save(); render(); } }); });
  $('t-alerts').addEventListener('click', function (e) {
    var t = e.target, box = t.closest('.alert-box'); if (!box) return;
    if (t.classList.contains('al-copy')) copy(box.querySelector('.al-subject').value + '\n\n' + box.querySelector('.al-body').value, t);
    else if (t.classList.contains('al-kakao')) copy(t.dataset.text, t);
    else if (t.classList.contains('al-done')) { state.list = G.markNotified(state.list, t.dataset.id, t.dataset.evk, now()); save(); render(); }
    else if (t.classList.contains('al-mailto')) {
      // 고친 제목·본문으로 mailto 를 다시 만든다. 메일은 메일 앱에서 사람이 보낸다.
      var to = t.getAttribute('href').replace(/^mailto:/, '').split('?')[0];
      t.setAttribute('href', 'mailto:' + to + '?subject=' + encodeURIComponent(box.querySelector('.al-subject').value) + '&body=' + encodeURIComponent(box.querySelector('.al-body').value));
      if (t.getAttribute('aria-disabled') === 'true') e.preventDefault();
    }
  });
  $('t-tpl').addEventListener('change', function (e) { var k = e.target.dataset.tpl, p = e.target.dataset.part; if (!k) return; (state.templates[k] = state.templates[k] || {})[p] = e.target.value; save(); renderAlerts(); });
  $('btn-tpl-reset').addEventListener('click', function () { state.templates = {}; save(); renderTemplates(); renderAlerts(); });
  $('btn-track-xlsx').addEventListener('click', exportXlsx);
  renderTargets(); renderTemplates(); render();
  if (location.hash === '#example' && !state.list.length) $('btn-sample').click();
})();
