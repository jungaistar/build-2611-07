/* 오류점수 화면 — 판정은 errscore.js 가 한다. 여기서는 읽고, 고르고, 그린다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); }, E = window.ErrScore;
  var LS = { rule: 'build-2611-07.err.rule', notes: 'build-2611-07.err.notes', th: 'build-2611-07.err.th' };
  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  var state = { books: [], rule: load(LS.rule, { ulsan: E.RULE.ulsan.slice() }), notes: load(LS.notes, {}), th: load(LS.th, E.THRESHOLD), counts: { 수입: {}, 수출: {} }, summary: null, rows: [], decls: [] };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function n(v) { return v == null ? '—' : Number(v).toLocaleString('ko-KR'); }
  function pc(v) { return v == null ? '—' : v + '%'; }
  function stat(k, v) { return '<div class="stat"><b>' + v + '</b>' + esc(k) + '</div>'; }
  function table(head, rows, cls) { return '<div class="tablewrap"><table class="' + (cls || '') + '"><thead><tr>' + head.map(function (h, i) { return '<th' + (i > 1 ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'; }

  function recompute() {
    E.applyRule(state.books, state.rule);
    state.rows = [].concat.apply([], state.books.map(function (b) { return b.rows; })).filter(function (r) { return r.month; });
    state.summary = E.summarize(state.books, state.counts, { threshold: state.th });
    state.decls = E.byDecl(state.rows);
    fillMonths();
    render();
  }
  function setBooks(raw) {
    state.books = raw.map(function (b) { return E.readWorkbook(b.sheets, b.name, state.rule); });
    state.counts = E.countsFromBooks(state.books);
    var msg = state.books.map(function (b) { return esc(b.fileName) + ' — ' + esc(b.kind || '구분 모름') + ' · 정정 줄 ' + b.rows.length + ' · ' + b.months.join(',') + '월' + (b.skipped ? ' · 건너뛴 줄 ' + b.skipped : '') + (b.notes.length ? ' · ' + esc(b.notes.join(' / ')) : ''); }).join('<br>');
    var ok = state.books.some(function (b) { return b.rows.length; });
    $('e-msg').innerHTML = '<div class="' + (ok ? 'ok' : 'warn') + '">' + msg + '</div>';
    ['e-rule', 'e-view', 'e-ledger', 'e-mail'].forEach(function (id) { $(id).hidden = !ok; });
    if (ok) recompute();
  }
  function render() { renderBrokers(); renderCards(); renderTable(); renderQuarters(); renderCompare(); renderCounts(); fillScope(); renderItems(); renderLedger(); renderMail(); }
  function renderBrokers() {
    $('e-brokers').innerHTML = table(['관세사부호', '캠퍼스', '신고번호 수', '오류점수'], E.brokers(state.rows, state.rule).map(function (b) {
      return '<tr><td>' + b.broker + '</td><td><label><input type="checkbox" data-broker="' + b.broker + '"' + (b.campus === '울산' ? ' checked' : '') + '> 울산</label></td><td class="num">' + n(b.err) + '</td><td class="num">' + n(b.score) + '</td></tr>';
    }), 'brokers');
  }
  function renderCards() {
    var S = state.summary, c = S.totalCum, over = S.quarters.filter(function (q) { return q.over; }), last = S.months[S.months.length - 1];
    $('e-cards').innerHTML = '<div class="stats">' + stat(last + '월 인천 오류점수', n(S.total[last].인천.score)) + stat(last + '월 울산 오류점수', n(S.total[last].울산.score)) + stat('누적 인천', n(c.인천.score)) + stat('누적 울산', n(c.울산.score)) + stat('경계 이상 분기·범위', over.length) + '</div>';
  }
  function renderTable() {
    var S = state.summary, rows = [];
    S.months.slice().reverse().forEach(function (m) {
      [['수출입', S.total[m]], ['수입', S.kinds.수입.months[m]], ['수출', S.kinds.수출.months[m]]].forEach(function (p) {
        ['종합', '인천', '울산'].forEach(function (cp) { var x = p[1][cp]; rows.push('<tr' + (cp === '종합' ? ' class="sum"' : '') + '><td>' + m + '월 ' + p[0] + '</td><td>' + cp + '</td><td class="num">' + n(x.decl) + '</td><td class="num">' + n(x.err) + '</td><td class="num">' + n(x.score) + '</td><td class="num">' + pc(x.rate) + '</td></tr>'); });
      });
    });
    $('e-table').innerHTML = table(['월 · 구분', '캠퍼스', '신고건수', '오류건수', '오류점수', '비율'], rows, 'err-months');
  }
  function renderQuarters() {
    var qs = state.summary.quarters, hot = qs.filter(function (q) { return q.over || q.near; });
    $('e-quarters').innerHTML = (hot.length ? '<div class="warn">경계 이상 ' + qs.filter(function (q) { return q.over; }).length + '곳 · 경계의 80% 이상 ' + qs.filter(function (q) { return q.near; }).length + '곳입니다.</div>' : '<div class="ok">모든 범위가 경계의 80% 아래입니다.</div>') +
      table(['범위', '캠퍼스', '분기', '오류점수', '판정'], qs.map(function (q) { return '<tr' + (q.over ? ' class="over"' : '') + '><td>' + q.kind + '</td><td>' + q.campus + '</td><td class="num">' + q.q + '분기</td><td class="num">' + n(q.score) + '</td><td class="num">' + (q.over ? '경계 이상' : q.near ? '80% 이상' : '') + '</td></tr>'; }), 'quarters');
  }
  function renderCompare() {
    var c = E.compare(state.books, state.summary);
    if (!c.rows.length) { $('e-compare').innerHTML = '<p class="sub">요약 시트가 없어 대조하지 않았습니다.</p>'; return; }
    var diff = c.rows.filter(function (x) { return x.scoreDiff !== 0 || x.errDiff !== 0; });
    $('e-compare').innerHTML = '<div class="' + (c.scoreDiffs.length ? 'warn' : 'ok') + '">' + c.rows.length + '칸 대조: 점수가 다른 칸 ' + c.scoreDiffs.length + ' · 건수만 다른 칸 ' + (diff.length - c.scoreDiffs.length) + '. 오류건수는 메일 규칙대로 신고번호 수로 셉니다.</div>' +
      (diff.length ? table(['구분 · 월', '캠퍼스', '계산 건수', '대장 건수', '계산 점수', '대장 점수', '점수 차이'], diff.map(function (x) { return '<tr' + (x.scoreDiff ? ' class="over"' : '') + '><td>' + x.kind + ' ' + x.month + '월</td><td>' + x.campus + '</td><td class="num">' + x.calcErr + '</td><td class="num">' + x.handErr + '</td><td class="num">' + n(x.calcScore) + '</td><td class="num">' + n(x.handScore) + '</td><td class="num">' + x.scoreDiff + '</td></tr>'; }), 'compare') : '');
  }
  function renderCounts() {
    $('e-counts').innerHTML = table(['구분', '월', '인천 신고건수'], [].concat.apply([], E.KINDS.map(function (k) { return state.summary.months.map(function (m) { var v = state.counts[k][m]; return '<tr><td>' + k + '</td><td>' + m + '월</td><td class="num"><input type="text" inputmode="numeric" style="width:7em" data-count="' + k + '" data-m="' + m + '" value="' + (v == null ? '' : v) + '"></td></tr>'; }); })), 'counts');
  }
  function fillScope() { var sel = $('e-scope'); if (sel.options.length) return; sel.innerHTML = ['전체', '수입', '수출', '인천', '울산'].map(function (s) { return '<option>' + s + '</option>'; }).join(''); }
  function fillMonths() {   // 파일을 바꾸면 달 목록도 바뀐다 — 없어진 달이 선택에 남지 않게 하되, 남아 있는 달은 그대로 둔다
    ['e-lmonth', 'e-mmonth'].forEach(function (id) { var el = $(id), keep = el.value; el.innerHTML = state.summary.months.slice().reverse().map(function (m) { return '<option value="' + m + '">' + m + '월</option>'; }).join(''); if (state.summary.months.indexOf(+keep) >= 0) el.value = keep; });
  }
  function renderItems() {
    var sc = $('e-scope').value, rows = state.rows.filter(function (r) { return sc === '전체' || r.kind === sc || r.campus === sc; });
    $('e-items').innerHTML = table(['항목명', '항목코드', '정정 줄', '신고번호 수', '오류점수', '비중'], E.topItems(rows, 15).map(function (t) { return '<tr><td>' + esc(t.item) + '</td><td>' + esc(t.code) + '</td><td class="num">' + n(t.n) + '</td><td class="num">' + n(t.err) + '</td><td class="num">' + n(t.score) + '</td><td class="num">' + pc(t.share) + '</td></tr>'; }), 'items');
  }
  var NOTE = [['div', '사업부'], ['reason', '발생사유 및 정정내용'], ['blame', '귀책'], ['owner', '담당자']];
  function renderLedger() {
    var m = +$('e-lmonth').value, list = state.decls.filter(function (d) { return d.month === m && d.score > 0; });
    $('e-ltable').innerHTML = list.length ? table(['구분', '신고번호', '캠퍼스', '정정일자', '오류점수'].concat(NOTE.map(function (x) { return x[1]; })), list.map(function (d) {
      var note = state.notes[d.declNo] || {};
      return '<tr><td>' + esc(d.kind) + '</td><td>' + esc(d.declNo) + '</td><td>' + esc(d.campus) + '</td><td>' + esc(d.fixedAt) + '</td><td class="num">' + n(d.score) + '</td>' + NOTE.map(function (x) { return '<td><input type="text" data-note="' + x[0] + '" data-decl="' + esc(d.declNo) + '" value="' + esc(note[x[0]] || '') + '" placeholder="' + (x[0] === 'reason' ? esc(d.changes.slice(0, 2).join(' / ')) : '') + '"></td>'; }).join('') + '</tr>';
    }), 'ledger') : '<p class="sub">이 달은 오류점수가 있는 신고번호가 없습니다.</p>';
  }
  function renderMail() {
    var m = +$('e-mmonth').value, d = E.mailDraft(state.summary, m, { top: E.topItems(state.rows.filter(function (r) { return r.month === m; }), 5) });
    $('e-msub').value = d.subject; $('e-mbody').value = d.body;
  }
  function readFile(f) { return new Promise(function (ok, no) { var rd = new FileReader(); rd.onerror = no; rd.onload = function (ev) { var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' }); ok({ name: f.name, sheets: wb.SheetNames.map(function (n) { return { name: n, aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) }; }) }); }; rd.readAsArrayBuffer(f); }); }

  $('e-file').addEventListener('change', function (e) { var fs = [].slice.call(e.target.files); if (!fs.length) return; Promise.all(fs.map(readFile)).then(setBooks).catch(function (er) { $('e-msg').innerHTML = '<div class="warn">파일을 읽지 못했습니다: ' + esc(er.message) + '</div>'; }); e.target.value = ''; });
  $('e-sample').addEventListener('click', function () { setBooks(E.sampleBooks()); });
  $('e-clear').addEventListener('click', function () { state.books = []; ['e-rule', 'e-view', 'e-ledger', 'e-mail'].forEach(function (id) { $(id).hidden = true; }); $('e-msg').innerHTML = ''; });
  $('e-brokers').addEventListener('change', function (e) { var b = e.target.dataset.broker; if (!b) return; var l = state.rule.ulsan.filter(function (x) { return x !== b; }); if (e.target.checked) l.push(b); state.rule.ulsan = l; localStorage.setItem(LS.rule, JSON.stringify(state.rule)); recompute(); });
  $('e-th').value = state.th;
  $('e-th').addEventListener('change', function () { var v = E.toNum(this.value); if (v == null || v <= 0) { this.value = state.th; return; } state.th = v; localStorage.setItem(LS.th, JSON.stringify(v)); recompute(); });
  $('e-counts').addEventListener('change', function (e) { var k = e.target.dataset.count; if (!k) return; var v = E.toNum(e.target.value); if (v == null) delete state.counts[k][e.target.dataset.m]; else state.counts[k][e.target.dataset.m] = v; recompute(); });
  $('e-scope').addEventListener('change', renderItems);
  $('e-lmonth').addEventListener('change', renderLedger);
  $('e-mmonth').addEventListener('change', renderMail);
  $('e-ltable').addEventListener('change', function (e) { var d = e.target.dataset.decl; if (!d) return; (state.notes[d] = state.notes[d] || {})[e.target.dataset.note] = e.target.value; localStorage.setItem(LS.notes, JSON.stringify(state.notes)); });
  $('e-mcopy').addEventListener('click', function () { var b = this; (navigator.clipboard ? navigator.clipboard.writeText($('e-mbody').value) : Promise.resolve()).then(function () { b.textContent = '복사했습니다'; setTimeout(function () { b.textContent = '본문 복사'; }, 1200); }); });
  $('e-xlsx').addEventListener('click', function () { var wb = XLSX.utils.book_new(); E.exportBook({ summary: state.summary, rows: state.rows, decls: state.decls, notes: state.notes }).forEach(function (s) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name); }); XLSX.writeFile(wb, '수출입오류점수_' + new Date().toISOString().slice(0, 10) + '.xlsx'); });
  window.__err = { state: state };
  if (location.hash === '#example') $('e-sample').click();
})();
