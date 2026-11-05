/* 대시보드 화면 — 판정·계산은 customs.js 가 한다. 여기서는 파일을 읽고, 고른 열을 기억하고, 그린다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var C = window.Customs;
  var LS = { data: 'b2611-07.dash', unit: 'b2611-07.dash.unit' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  // sets[kind] = { file, uploadedAt, headers, aoa(머리글 포함), offset, override } — 계산 결과는 build() 가 붙인다
  var state = { sets: {}, pending: [], filter: {}, range: null, tab: 'trade', unit: localStorage.getItem(LS.unit) || '원', open: {} };

  function now() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function msg(html, cls) { $('d-msg').innerHTML = html ? '<div class="' + (cls || 'note') + '">' + html + '</div>' : ''; }

  /* ---------- 읽기 ---------- */
  function sheetsOf(wb) {
    return wb.SheetNames.map(function (n) {
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
      var hr = C.findHeaderRow(aoa);
      return { name: n, aoa: aoa.slice(hr), offset: hr };
    }).filter(function (s) { return s.aoa.length > 1; });
  }
  // 파일 묶음 → 종류별로 넣는다. 같은 묶음에서 같은 종류·같은 열 이름이면 이어 붙이고, 그 밖에는 새 파일로 바꾼다(갱신).
  function addFiles(list) {
    var batch = {}, notes = [];
    list.forEach(function (f) {
      var sheets = sheetsOf(f.wb);
      if (!sheets.length) { notes.push(esc(f.name) + ' — 읽을 표가 없습니다.'); return; }
      var best = null;
      sheets.forEach(function (s) { var d = C.detectKind(s.aoa[0].map(String), f.name + ' ' + s.name); if (!best || d.ratio > best.d.ratio) best = { s: s, d: d }; });
      var item = { file: f.name + (sheets.length > 1 ? ' · ' + best.s.name : ''), uploadedAt: now(), headers: best.s.aoa[0].map(function (h, i) { return String(h).trim() || ('열' + (i + 1)); }), aoa: best.s.aoa, offset: best.s.offset, override: {} };
      if (!best.d.kind) { state.pending.push(item); notes.push(esc(f.name) + ' — 어떤 자료인지 알아보지 못했습니다. 아래에서 종류를 골라 주세요.'); return; }
      var k = best.d.kind, prev = batch[k];
      if (prev && prev.headers.join('|') === item.headers.join('|')) { prev.aoa = prev.aoa.concat(item.aoa.slice(1)); prev.file += ' + ' + item.file; prev.parts = (prev.parts || 1) + 1; }
      else { batch[k] = item; notes.push(esc(f.name) + ' → ' + esc(C.DATASETS[k].label) + (state.sets[k] ? ' (이전 파일을 새 파일로 바꿈)' : '')); }
    });
    Object.keys(batch).forEach(function (k) {
      var keep = state.sets[k] && state.sets[k].headers.join('|') === batch[k].headers.join('|') ? state.sets[k].override : {};
      batch[k].override = keep; state.sets[k] = batch[k];
    });
    rebuild(true);
    msg(notes.join('<br>'), state.pending.length ? 'warn' : 'ok');
  }
  function readFiles(files) {
    var list = [], left = files.length;
    if (!left) return;
    Array.prototype.forEach.call(files, function (f) {
      var rd = new FileReader();
      rd.onload = function (e) {
        try { list.push({ name: f.name, wb: XLSX.read(new Uint8Array(e.target.result), { type: 'array' }) }); }
        catch (err) { msg('파일을 읽지 못했습니다: ' + esc(f.name) + ' — ' + esc(err.message), 'warn'); }
        if (--left === 0) addFiles(list);
      };
      rd.readAsArrayBuffer(f);
    });
  }
  function loadSample() {
    state.sets = {}; state.pending = []; state.open = {};
    addFiles(C.sampleFiles().map(function (f) {
      var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f.aoa), '데이터');
      return { name: f.name, wb: wb };
    }));
    msg('예제 엑셀 5종(가짜 데이터)을 올렸습니다. 예제 데이터는 실제 사내 데이터가 아닙니다.', 'ok');
  }

  /* ---------- 계산 묶기(엔진 호출) ---------- */
  function build(k) {
    var s = state.sets[k];
    s.res = C.mapColumns(s.headers, k, s.override);
    s.rows = C.aoaToRows(s.aoa);
    s.norm = s.res.missing.length ? null : C.normalize(s.rows, k, s.res.map, s.offset);
  }
  function ready(k) { return state.sets[k] && state.sets[k].norm ? state.sets[k] : null; }
  function rebuild(resetRange) {
    Object.keys(state.sets).forEach(build);
    var period = C.unionPeriod(C.KINDS.map(function (k) { return ready(k) ? ready(k).norm.period : null; }));
    state.period = period;
    if (period && (resetRange || !state.range || state.range.from < period.from || state.range.to > period.to)) state.range = C.defaultRange(period);
    if (!period) state.range = null;
    save();
    renderSets(); renderFilter(); renderTab();
  }
  function save() {
    if (!$('d-remember').checked) return;
    var keep = {};
    Object.keys(state.sets).forEach(function (k) { var s = state.sets[k]; keep[k] = { file: s.file, uploadedAt: s.uploadedAt, headers: s.headers, aoa: s.aoa, offset: s.offset, override: s.override }; });
    try { localStorage.setItem(LS.data, JSON.stringify({ v: 1, sets: keep })); }
    catch (e) { msg('데이터가 커서 이 브라우저에 기억하지 못했습니다. 다음에 열 때 다시 올려 주세요.', 'warn'); }
  }
  function restore() {
    try {
      var j = JSON.parse(localStorage.getItem(LS.data) || 'null');
      if (!j || !j.sets) return false;
      Object.keys(j.sets).forEach(function (k) { if (C.DATASETS[k]) state.sets[k] = j.sets[k]; });
      return Object.keys(state.sets).length > 0;
    } catch (e) { return false; }
  }

  /* ---------- 올린 데이터 표 · 열 짝짓기 ---------- */
  var REASON = function (sc) { return sc === 'user' ? '직접 고름' : sc === 'user-none' ? '없음으로 고름' : sc === 1 ? '같은 이름' : sc >= 0.95 ? '같은 뜻 낱말' : sc ? '이름 일부 포함' : ''; };
  function example(s, h) { for (var i = 0; i < s.rows.length && i < 50; i++) { var v = s.rows[i][h]; if (String(v).trim()) return String(v); } return ''; }
  function renderSets() {
    var ks = C.KINDS.filter(function (k) { return state.sets[k]; });
    var h = '';
    if (state.pending.length) {
      h += '<div class="warn"><b>종류를 골라 주세요</b><ul>' + state.pending.map(function (p, i) {
        return '<li>' + esc(p.file) + ' — 열: ' + esc(p.headers.slice(0, 8).join(', ')) + ' <select data-pending="' + i + '"><option value="">종류 고르기</option>' +
          C.KINDS.map(function (k) { return '<option value="' + k + '">' + esc(C.DATASETS[k].label) + '</option>'; }).join('') + '</select> <button class="x" data-drop-pending="' + i + '">빼기</button></li>';
      }).join('') + '</ul></div>';
    }
    if (ks.length) {
      h += '<div class="tablewrap" style="margin-top:12px"><table class="sets"><thead><tr><th>자료</th><th>파일</th><th>올린 날짜</th><th>데이터 기간</th><th>읽은 줄</th><th>건너뛴 줄</th><th>열 짝짓기</th></tr></thead><tbody>';
      ks.forEach(function (k) {
        var s = state.sets[k], n = s.norm, miss = s.res.missing;
        h += '<tr data-kind="' + k + '"' + (miss.length ? ' class="flag"' : '') + '><td><b>' + esc(C.DATASETS[k].label) + '</b><br><small class="sub">' + esc(C.DATASETS[k].source) + ' · ' + esc(C.DATASETS[k].cycle) + '</small></td>' +
          '<td class="wrapcell">' + esc(s.file) + '</td><td>' + esc(s.uploadedAt) + '</td>' +
          '<td>' + (n && n.period ? C.monthLabel(n.period.from) + ' ~ ' + C.monthLabel(n.period.to) : '—') + '</td>' +
          '<td class="num">' + (n ? C.fmtNum(n.records.length) : '—') + '</td><td class="num">' + (n ? C.fmtNum(n.skipped.length) : '—') + '</td>' +
          '<td>' + (miss.length ? '<span class="tag bad-t">못 찾은 열 ' + miss.length + '</span>' : '<span class="tag ok-t">필수 열 모두 찾음</span>') +
          ' <button class="x" data-toggle="' + k + '">' + (state.open[k] || miss.length ? '접기' : '열 확인') + '</button></td></tr>';
        if (state.open[k] || miss.length) h += '<tr class="maprow"><td colspan="7">' + mapTable(k) + '</td></tr>';
      });
      h += '</tbody></table></div><p class="sub" style="margin-top:8px">같은 종류의 엑셀을 다시 올리면 새 파일로 바꿉니다(갱신). 한 번에 여러 파일을 올리면 열 이름이 같은 것끼리 이어 붙입니다.</p>';
    }
    $('d-sets').innerHTML = h;
    $('d-view').hidden = !state.range;
  }
  function mapTable(k) {
    var s = state.sets[k], res = s.res;
    var h = (res.missing.length ? '<div class="warn">이 열을 찾지 못했습니다: <b>' + esc(res.missing.join(', ')) + '</b>. 아래에서 엑셀의 어느 열인지 골라 주세요.</div>' : '') +
      '<table class="map"><thead><tr><th>필요한 항목</th><th>엑셀 열</th><th>근거</th><th>예시 값</th></tr></thead><tbody>';
    C.DATASETS[k].fields.forEach(function (f) {
      var cur = res.map[f.key] || '';
      h += '<tr' + (f.req && !cur ? ' class="flag"' : '') + '><td>' + esc(f.label) + (f.req ? ' <small class="req">필수</small>' : ' <small class="sub">선택</small>') + '</td>' +
        '<td><select data-map="' + k + '" data-f="' + f.key + '"><option value="">(없음)</option>' + s.headers.map(function (hd) { return '<option' + (hd === cur ? ' selected' : '') + '>' + esc(hd) + '</option>'; }).join('') + '</select></td>' +
        '<td>' + esc(REASON(res.score[f.key])) + '</td><td class="wrapcell">' + esc(cur ? example(s, cur) : '') + '</td></tr>';
    });
    h += '</tbody></table>';
    if (res.unused.length) h += '<p class="sub">쓰지 않은 열: ' + esc(res.unused.join(', ')) + '</p>';
    if (s.norm && s.norm.issues.length) h += '<div class="note"><b>읽으며 확인한 것</b><ul>' + s.norm.issues.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      (s.norm.skipped.length ? '<p class="sub" style="margin:6px 0 0">건너뛴 줄: ' + s.norm.skipped.slice(0, 8).map(function (x) { return x.row + '행(' + esc(x.reason) + ')'; }).join(', ') + (s.norm.skipped.length > 8 ? ' 외' : '') + '</p>' : '') + '</div>';
    return h;
  }

  /* ---------- 거르기 ---------- */
  function renderFilter() {
    if (!state.range) return;
    var ms = C.monthsBetween(state.period.from, state.period.to);
    var opt = function (v, sel, lab) { return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(lab == null ? v : lab) + '</option>'; };
    $('f-from').innerHTML = ms.map(function (m) { return opt(m, state.range.from, C.monthLabel(m)); }).join('');
    $('f-to').innerHTML = ms.map(function (m) { return opt(m, state.range.to, C.monthLabel(m)); }).join('');
    var hqs = {}, cos = {};
    C.KINDS.forEach(function (k) { var s = ready(k); if (!s) return; C.valuesOf(s.norm.records, 'hq').forEach(function (v) { hqs[v] = 1; }); if (C.hasField(k, 'country')) C.valuesOf(s.norm.records, 'country').forEach(function (v) { cos[v] = 1; }); });
    $('f-hq').innerHTML = opt('', state.filter.hq || '', '전체') + Object.keys(hqs).sort().map(function (v) { return opt(v, state.filter.hq); }).join('');
    $('f-country').innerHTML = opt('', state.filter.country || '', '전체') + Object.keys(cos).sort().map(function (v) { return opt(v, state.filter.country); }).join('');
    $('f-unit').value = state.unit;
    var pr = C.prevRange(state.range);
    $('f-note').innerHTML = '조회 기간 <b>' + C.monthLabel(state.range.from) + ' ~ ' + C.monthLabel(state.range.to) + '</b> · 전년 동기 ' + C.monthLabel(pr.from) + ' ~ ' + C.monthLabel(pr.to) +
      (pr.overlap ? ' <span class="tag bad-t">12개월을 넘게 골라 전년 동기와 겹칩니다</span>' : '') + ' · 금액 단위는 올린 파일 그대로입니다(' + esc(state.unit) + ').';
  }
  function filtered(k) {
    var s = ready(k); if (!s) return null;
    var f = C.applyFilter(s.norm.records, k, { hq: state.filter.hq, country: state.filter.country });
    return { recs: f.records, ignored: f.ignored, set: s };
  }

  /* ---------- 그림(SVG) ---------- */
  var COL = ['#154b6e', '#0b6e99', '#0a6045', '#b07a12', '#6b4fa0'], PREV = '#9fb2c4';
  function niceMax(v) { if (!(v > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function axisFmt(kind) { return kind === 'pct' ? function (v) { return C.fmtPct(v, 0); } : kind === 'count' ? function (v) { return C.fmtNum(v); } : function (v) { return C.fmtShort(v, state.unit).replace(/원$/, '').replace(' ' + state.unit, ''); }; }
  function legend(series, x0) { var x = x0; return series.map(function (s, i) { var t = '<rect x="' + x + '" y="8" width="11" height="11" rx="2" fill="' + s.color + '"/><text x="' + (x + 15) + '" y="18" class="lg">' + esc(s.name) + '</text>'; x += 30 + s.name.length * 12; return t; }).join(''); }
  function frame(title, svg) { return '<figure class="chart-box"><figcaption>' + esc(title) + '</figcaption>' + svg + '</figure>'; }
  // 월별 막대(묶음) 또는 선. type: 'bar' | 'line'
  function monthChart(title, months, series, type, fmtKind) {
    var W = 640, H = 250, L = 62, R = 12, T = 30, B = 30, iw = W - L - R, ih = H - T - B;
    var max = niceMax(Math.max.apply(null, [0].concat.apply([], series.map(function (s) { return s.values.filter(function (v) { return v != null; }); }))));
    var fmt = axisFmt(fmtKind), step = iw / Math.max(1, months.length), y = function (v) { return T + ih - (v / max) * ih; };
    var b = legend(series, L);
    for (var g = 0; g <= 4; g++) { var gv = max * g / 4; b += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(gv) + '" y2="' + y(gv) + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y(gv) + 4) + '" class="ax" text-anchor="end">' + esc(fmt(gv)) + '</text>'; }
    var every = Math.ceil(months.length / 12);
    months.forEach(function (m, i) { if (i % every === 0) b += '<text x="' + (L + step * i + step / 2) + '" y="' + (H - 10) + '" class="ax" text-anchor="middle">' + esc(m.slice(2, 4) + '.' + m.slice(5, 7)) + '</text>'; });
    if (type === 'bar') {
      var bw = Math.max(2, (step * 0.72) / series.length);
      series.forEach(function (s, si) { s.values.forEach(function (v, i) { if (v == null || v <= 0) return; var x = L + step * i + step * 0.14 + bw * si; b += '<rect x="' + x.toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (T + ih - y(v)).toFixed(1) + '" fill="' + s.color + '"><title>' + esc(C.monthLabel(months[i]) + ' ' + s.name + ' ' + s.fmt(v)) + '</title></rect>'; }); });
    } else {
      series.forEach(function (s) {
        var seg = [], segs = [];
        s.values.forEach(function (v, i) { if (v == null) { if (seg.length) segs.push(seg); seg = []; } else seg.push([L + step * i + step / 2, y(v), v, i]); });
        if (seg.length) segs.push(seg);
        segs.forEach(function (sg) { b += '<polyline fill="none" stroke="' + s.color + '" stroke-width="2.4"' + (s.dash ? ' stroke-dasharray="6 4"' : '') + ' points="' + sg.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>'; });
        segs.forEach(function (sg) { sg.forEach(function (p) { b += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="' + s.color + '"><title>' + esc(C.monthLabel(months[p[3]]) + ' ' + s.name + ' ' + s.fmt(p[2])) + '</title></circle>'; }); });
      });
    }
    return frame(title, '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '">' + b + '</svg>');
  }
  // 가로 막대 — 상위 N
  function hbar(title, rows, fmt, color) {
    var W = 640, rowH = 26, L = 170, R = 110, T = 8, H = T + rows.length * rowH + 8;
    var max = niceMax(Math.max.apply(null, [0].concat(rows.map(function (r) { return r.value || 0; }))));
    var b = '';
    rows.forEach(function (r, i) {
      var yy = T + i * rowH, w = r.value > 0 ? (r.value / max) * (W - L - R) : 0, lab = String(r.label);
      if (lab.length > 13) lab = lab.slice(0, 12) + '…';
      b += '<text x="' + (L - 8) + '" y="' + (yy + 17) + '" class="ax lab" text-anchor="end"><title>' + esc(r.label) + '</title>' + esc(lab) + '</text>' +
        '<rect x="' + L + '" y="' + (yy + 5) + '" width="' + w.toFixed(1) + '" height="16" rx="3" fill="' + (color || COL[0]) + '"/>' +
        '<text x="' + (L + w + 6).toFixed(1) + '" y="' + (yy + 17) + '" class="ax">' + esc(fmt(r.value)) + '</text>';
    });
    if (!rows.length) b = '<text x="20" y="24" class="ax">데이터 없음</text>';
    return frame(title, '<svg class="chart" viewBox="0 0 ' + W + ' ' + Math.max(H, 40) + '" role="img" aria-label="' + esc(title) + '">' + b + '</svg>');
  }

  /* ---------- 카드·표 ---------- */
  function money(v) { return C.fmtShort(v, state.unit); }
  function kpi(label, value, sub, how, key) {
    return '<div class="kpi"' + (key ? ' data-k="' + key + '"' : '') + '><span class="kpi-l">' + esc(label) + '</span><b class="kpi-v">' + esc(value) + '</b>' +
      (sub ? '<small>' + sub + '</small>' : '') + (how ? '<span class="kpi-how">' + esc(how) + '</span>' : '') + '</div>';
  }
  function empty(k) { return '<div class="kpi empty"><span class="kpi-l">' + esc(C.DATASETS[k].label) + '</span><b class="kpi-v">자료 없음</b><small>' + esc(C.DATASETS[k].source) + '를 올리면 보입니다' + (state.sets[k] ? ' — 못 찾은 열을 먼저 골라 주세요' : '') + '</small></div>'; }
  function ignoredNote(list) { return list && list.length ? '<p class="sub">이 자료에는 ' + esc(list.join('·')) + ' 열이 없어 ' + esc(list.join('·')) + ' 조건을 걸지 않았습니다.</p>' : ''; }
  function table(head, rows, foot, cls) {
    return '<div class="tablewrap"><table class="' + (cls || '') + '"><thead><tr>' + head.map(function (h, i) { return '<th' + (i ? ' class="num"' : '') + '>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr' + (r.cls ? ' class="' + r.cls + '"' : '') + '>' + r.cells.map(function (c, i) { return '<td' + (i ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      (foot ? '<tr class="sum">' + foot.map(function (c, i) { return '<td' + (i ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>' : '') + '</tbody></table></div>';
  }
  function n0(v) { return esc(C.fmtNum(v)); }
  function signCls(v) { return v == null ? '' : v < 0 ? ' class="neg"' : v > 0 ? ' class="pos"' : ''; }
  function sp(v, txt) { return '<span' + signCls(v) + '>' + esc(txt) + '</span>'; }

  function renderTrade() {
    var by = $('by-trade').value, top = +$('top-trade').value, BYL = C.BY[by], k = '', ch = '', tb = '';
    var fi = filtered('import'), fe = filtered('export'), months = C.monthsBetween(state.range.from, state.range.to);
    if (fi) {
      var s = C.importStats(fi.recs, state.range, by);
      k += kpi('수입 물자대', money(s.goods), C.fmtNum(s.n) + '건', '합계', 'imp-goods') + kpi('관세', money(s.duty), '', '합계', 'imp-duty') +
        kpi('관세부담율', C.fmtPct(s.burden, 2), '', '계산: 관세 ÷ 물자대', 'imp-burden');
      ch += monthChart('월별 수입 물자대 · 관세', months, [{ name: '물자대', color: COL[0], values: s.monthly.map(function (m) { return m.goods; }), fmt: money }, { name: '관세', color: COL[3], values: s.monthly.map(function (m) { return m.duty; }), fmt: money }], 'bar');
      var t = C.topN(s.groups, top);
      ch += hbar(BYL + '별 수입 물자대 상위 ' + top, t.rows.map(function (g) { return { label: g.key, value: g.goods }; }), money, COL[0]);
      tb += '<h3 class="tb-h">수입 — ' + esc(BYL) + '별 물자대 · 관세 · 관세부담율</h3>' + ignoredNote(fi.ignored) +
        table([esc(BYL), '건수', '물자대', '관세', '관세부담율'], t.rows.concat(t.rest ? [t.rest] : []).map(function (g) { return { cls: g === t.rest ? 'rest' : '', cells: [esc(g.key), n0(g.n), n0(g.goods), n0(g.duty), esc(C.fmtPct(g.burden, 2))] }; }),
          ['합계', n0(s.n), n0(s.goods), n0(s.duty), esc(C.fmtPct(s.burden, 2))], 'trade-imp');
    } else k += empty('import');
    if (fe) {
      var e = C.exportStats(fe.recs, state.range, by);
      k += kpi('수출금액', money(e.amount), '전년 동기 ' + esc(money(e.prev)), '합계', 'exp-amount') +
        kpi('수출 전년 동기 대비', C.fmtSignedPct(e.rate), sp(e.diff, (e.diff > 0 ? '+' : '') + money(e.diff)) + (e.hasPrev ? '' : ' · 전년 데이터 없음'), '계산: (올해 − 전년) ÷ 전년', 'exp-rate');
      ch += monthChart('월별 수출금액 — 올해와 전년 동기', months, [{ name: '올해', color: COL[2], values: e.monthly.map(function (m) { return m.amount; }), fmt: money }, { name: '전년 동기', color: PREV, dash: true, values: e.monthly.map(function (m) { return m.prev; }), fmt: money }], 'line');
      var te = C.topN(e.groups, top);
      ch += hbar(BYL + '별 수출금액 상위 ' + top, te.rows.map(function (g) { return { label: g.key, value: g.amount }; }), money, COL[2]);
      tb += '<h3 class="tb-h">수출 — ' + esc(BYL) + '별 수출금액 전년 동기 대비</h3>' + ignoredNote(fe.ignored) +
        table([esc(BYL), '건수', '수출금액', '전년 동기', '증감', '증감률'], te.rows.concat(te.rest ? [te.rest] : []).map(function (g) {
          return { cls: g === te.rest ? 'rest' : '', cells: [esc(g.key), n0(g.n), n0(g.amount), n0(g.prev), sp(g.diff, C.fmtSigned(g.diff)), sp(g.rate, C.fmtSignedPct(g.rate))] };
        }), ['합계', n0(e.n), n0(e.amount), n0(e.prev), sp(e.diff, C.fmtSigned(e.diff)), sp(e.rate, C.fmtSignedPct(e.rate))], 'trade-exp');
    } else k += empty('export');
    $('kpi-trade').innerHTML = k; $('ch-trade').innerHTML = ch; $('tb-trade').innerHTML = tb;
  }
  function renderFta() {
    var by = $('by-fta').value, BYL = C.BY[by], k = '', ch = '', tb = '', months = C.monthsBetween(state.range.from, state.range.to), monthly = [];
    ['import', 'export'].forEach(function (kind, i) {
      var f = filtered(kind), nm = kind === 'import' ? '수입' : '수출';
      if (!f) { k += empty(kind); return; }
      var s = C.ftaStats(f.recs, kind, state.range, by, f.set.res.map);
      if (!s.available) { k += kpi(nm + ' FTA 활용률', '열 없음', '물자대_FTA 열을 골라 주세요', '', kind + '-util'); return; }
      k += kpi(nm + ' FTA 활용률', C.fmtPct(s.util), money(s.ftaGoods) + ' / ' + esc(money(s.goods)), '계산: 물자대_FTA ÷ 물자대', kind + '-util') +
        kpi(nm + ' FTA 절감액', s.hasSaving ? money(s.saving) : '열 없음', '', s.hasSaving ? '합계' : '', kind + '-saving');
      ch += hbar(nm + ' ' + BYL + '별 FTA 활용률', s.groups.slice(0, 10).map(function (g) { return { label: g.key, value: g.util }; }), function (v) { return C.fmtPct(v); }, COL[i ? 2 : 0]);
      monthly.push({ name: nm + ' 절감액', color: COL[i ? 2 : 0], values: s.monthly.map(function (m) { return m.saving; }), fmt: money });
      tb += '<h3 class="tb-h">' + nm + ' FTA — ' + esc(BYL) + '별 물자대 · 물자대_FTA · 절감액</h3>' + ignoredNote(f.ignored) +
        table([esc(BYL), '물자대', '물자대_FTA', 'FTA 활용률', '절감액'], s.groups.map(function (g) { return { cells: [esc(g.key), n0(g.goods), n0(g.ftaGoods), esc(C.fmtPct(g.util)), n0(g.saving)] }; }),
          ['합계', n0(s.goods), n0(s.ftaGoods), esc(C.fmtPct(s.util)), n0(s.saving)], 'fta-' + kind);
    });
    if (monthly.length) ch = monthChart('월별 FTA 절감액', months, monthly, 'bar') + ch;
    $('kpi-fta').innerHTML = k; $('ch-fta').innerHTML = ch; $('tb-fta').innerHTML = tb;
  }
  function renderRefund() {
    var f = filtered('refund'), k = '', ch = '', tb = '';
    if (!f) { $('kpi-refund').innerHTML = empty('refund'); $('ch-refund').innerHTML = ''; $('tb-refund').innerHTML = ''; return; }
    var s = C.refundStats(f.recs, state.range);
    k += kpi('관세환급 합계', money(s.amount), s.count != null ? C.fmtNum(s.count) + '건' : '', '합계', 'ref-amount') +
      kpi('월 평균', money(s.monthAvg), '데이터 있는 ' + s.monthsWithData + '개월', '계산: 합계 ÷ 데이터 있는 달 수', 'ref-avg') +
      kpi('최근 달 환급액', s.last ? money(s.last.amount) : '—', s.last ? C.monthLabel(s.last.month) : '', '', 'ref-last');
    ch += monthChart('월별 관세환급액', s.months, [{ name: '환급액', color: COL[1], values: s.monthly.map(function (m) { return m.amount; }), fmt: money }], 'bar');
    ch += hbar('본부별 관세환급액', s.pivot.map(function (p) { return { label: p.hq, value: p.total }; }), money, COL[1]);
    tb += '<h3 class="tb-h">본부별 월별 관세환급 실적</h3>' + ignoredNote(f.ignored) +
      table(['본부'].concat(s.months.map(C.monthLabel), ['합계']), s.pivot.map(function (p) { return { cells: [esc(p.hq)].concat(p.months.map(n0), [n0(p.total)]) }; }),
        ['합계'].concat(s.monthly.map(function (m) { return n0(m.amount); }), [n0(s.amount)]), 'refund-pivot');
    $('kpi-refund').innerHTML = k; $('ch-refund').innerHTML = ch; $('tb-refund').innerHTML = tb;
  }
  function renderErrors() {
    var f = filtered('errors'), k = '', ch = '', tb = '';
    if (!f) { $('kpi-errors').innerHTML = empty('errors'); $('ch-errors').innerHTML = ''; $('tb-errors').innerHTML = ''; return; }
    var s = C.errorStats(f.recs, state.range, 'kind');
    k += kpi('신고건수', C.fmtNum(s.decl), '', '합계', 'err-decl') + kpi('오류건수', C.fmtNum(s.err), '', '합계', 'err-err') +
      kpi('오류 비율', C.fmtPct(s.rate, 2), '', '계산: 오류건수 ÷ 신고건수', 'err-rate') + kpi('오류점수', C.fmtNum(s.score), '', '합계', 'err-score');
    var months = C.monthsBetween(state.range.from, state.range.to), byKind = C.valuesOf(f.recs, 'kind');
    var lines = byKind.length > 1 && byKind.length <= 4 ? byKind.map(function (kd, i) {
      var st = C.errorStats(f.recs.filter(function (r) { return r.kind === kd; }), state.range, 'kind');
      return { name: kd, color: COL[i], values: st.monthly.map(function (m) { return m.rate; }), fmt: function (v) { return C.fmtPct(v, 2); } };
    }) : [{ name: '오류 비율', color: COL[4], values: s.monthly.map(function (m) { return m.rate; }), fmt: function (v) { return C.fmtPct(v, 2); } }];
    ch += monthChart('월별 오류 비율', months, lines, 'line', 'pct');
    ch += monthChart('월별 오류건수 · 오류점수', months, [{ name: '오류건수', color: COL[4], values: s.monthly.map(function (m) { return m.err; }), fmt: C.fmtNum }, { name: '오류점수', color: COL[3], values: s.monthly.map(function (m) { return m.score; }), fmt: C.fmtNum }], 'bar', 'count');
    tb += '<h3 class="tb-h">구분별</h3>' + ignoredNote(f.ignored) + table(['구분', '신고건수', '오류건수', '오류 비율', '오류점수'], s.groups.map(function (g) { return { cells: [esc(g.key), n0(g.decl), n0(g.err), esc(C.fmtPct(g.rate, 2)), n0(g.score)] }; }),
      ['합계', n0(s.decl), n0(s.err), esc(C.fmtPct(s.rate, 2)), n0(s.score)], 'err-kind');
    tb += '<h3 class="tb-h">월별</h3>' + table(['월', '신고건수', '오류건수', '오류 비율', '오류점수'], s.monthly.map(function (m) { return { cells: [esc(C.monthLabel(m.month)), n0(m.decl), n0(m.err), esc(C.fmtPct(m.rate, 2)), n0(m.score)] }; }), null, 'err-month');
    $('kpi-errors').innerHTML = k; $('ch-errors').innerHTML = ch; $('tb-errors').innerHTML = tb;
  }
  // (v1.2) 품목분류 결정문 현황 — 관세율은 올린 파일 값을 그대로 보인다(물품설명서 초안에는 여전히 싣지 않는다)
  function renderRuling() {
    var f = filtered('ruling'), k = '', ch = '', tb = '';
    if (!f) { $('kpi-ruling').innerHTML = empty('ruling'); $('ch-ruling').innerHTML = ''; $('tb-ruling').innerHTML = ''; return; }
    var s = C.rulingStats(f.recs, state.range, $('by-ruling').value);
    k += kpi('결정문 건수', C.fmtNum(s.n), '완제품 ' + s.products + '종 · 관세사 ' + s.brokers + '곳', '합계', 'rul-n') +
      kpi('관세율 0% 결정', C.fmtNum(s.zero) + '건', C.fmtPct(s.zeroRate) + ' (0% 건수 ÷ 결정 건수)', '계산: 0% 건수 ÷ 결정 건수', 'rul-zero') +
      kpi('종전보다 낮아진 건', s.withPrev ? C.fmtNum(s.lowered) + '건' : '—', s.withPrev ? '종전세율이 있는 ' + s.withPrev + '건 중' : '종전세율 열이 있을 때 보입니다', s.withPrev ? '계산: 결정세율 < 종전세율' : '', 'rul-lowered') +
      kpi('절감 추정(연간)', s.saving == null ? '—' : money(s.saving), s.saving == null ? '종전세율 · 연간 수입액 열이 있을 때 계산합니다' : s.savingN + '건 기준 · 추정치', s.saving == null ? '' : '계산: 연간 수입액 × (종전세율 − 결정세율)', 'rul-saving') +
      kpi('최근 시행', s.latest ? s.latest.date : '—', s.latest ? esc(s.latest.item) : '', '', 'rul-latest');
    ch += monthChart('월별 결정문 시행 건수', s.months, [{ name: '결정 건수', color: COL[2], values: s.monthly.map(function (m) { return m.n || null; }), fmt: C.fmtNum }], 'bar', 'count');
    ch += hbar(s.byLabel + '별 결정 건수', s.groups.slice(0, 12).map(function (g) { return { label: g.key, value: g.n }; }), C.fmtNum, COL[2]);
    tb += '<h3 class="tb-h">' + esc(s.byLabel) + '별</h3>' + ignoredNote(f.ignored) +
      table([s.byLabel, '결정 건수', '관세율 0%', '0% 비율', '절감 추정'], s.groups.map(function (g) { return { cells: [esc(g.key), n0(g.n), n0(g.zero), esc(C.fmtPct(g.zeroRate)), esc(g.saving == null ? '—' : money(g.saving))] }; }),
        ['합계', n0(s.n), n0(s.zero), esc(C.fmtPct(s.zeroRate)), esc(s.saving == null ? '—' : money(s.saving))], 'ruling-by');
    tb += '<h3 class="tb-h">세율별 분포</h3>' + table(['관세율', '건수'], s.rates.map(function (r) { return { cells: [esc(r.key), n0(r.n)] }; }), null, 'ruling-rates');
    tb += '<h3 class="tb-h">결정문 목록(최근 시행 순)</h3>' + table(['시행일자', '완제품', '품명', '결정세번', '결정문번호', '관세율', '관세사'], s.list.map(function (r) {
      return { cells: [esc(r.date), esc(r.product), esc(r.item), esc(r.hs), esc(r.docNo || ''), esc(r.rate == null ? '—' : (r.rateCode ? r.rateCode + ' ' : '') + r.rate + '%'), esc(r.broker || '')] };
    }), null, 'ruling-list') + '<p class="sub">관세율은 올린 파일의 값을 그대로 보입니다. 물품설명서 초안에는 세율을 싣지 않는 규칙이 그대로입니다.</p>';
    $('kpi-ruling').innerHTML = k; $('ch-ruling').innerHTML = ch; $('tb-ruling').innerHTML = tb;
  }
  var RENDER = { trade: renderTrade, fta: renderFta, refund: renderRefund, errors: renderErrors, ruling: renderRuling };
  function renderTab() {
    if (!state.range) return;
    document.querySelectorAll('.tab').forEach(function (b) { var on = b.dataset.tab === state.tab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.classList.toggle('on', on); });
    ['trade', 'fta', 'refund', 'errors', 'ruling'].forEach(function (t) { $('t-' + t).hidden = t !== state.tab; });
    RENDER[state.tab]();
  }

  /* ---------- 엑셀 ---------- */
  function exportXlsx() {
    var data = {};
    C.KINDS.forEach(function (k) { var s = ready(k); if (s) data[k] = { file: s.file, uploadedAt: s.uploadedAt, period: s.norm.period, records: s.norm.records, map: s.res.map, skipped: s.norm.skipped }; });
    var book = C.exportBook({ range: state.range, filter: state.filter, unit: state.unit, data: data });
    var wb = XLSX.utils.book_new();
    book.forEach(function (sh) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.aoa), sh.name); });
    XLSX.writeFile(wb, '수출입통관_집계_' + state.range.from.replace('-', '') + '-' + state.range.to.replace('-', '') + '.xlsx');
  }

  /* ---------- 이벤트 ---------- */
  var drop = $('d-drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { readFiles(e.dataTransfer.files); });
  $('d-file').addEventListener('change', function () { readFiles(this.files); this.value = ''; });
  $('btn-dash-sample').addEventListener('click', loadSample);
  $('btn-dash-clear').addEventListener('click', function () { localStorage.removeItem(LS.data); state.sets = {}; state.pending = []; state.range = null; renderSets(); msg('이 브라우저에 기억한 데이터를 지웠습니다.', 'ok'); });
  $('d-remember').addEventListener('change', function () { if (this.checked) save(); else localStorage.removeItem(LS.data); });
  $('d-sets').addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.map) { var s = state.sets[t.dataset.map]; s.override[t.dataset.f] = t.value; state.open[t.dataset.map] = true; rebuild(false); }
    else if (t.dataset.pending != null && t.value) { var p = state.pending.splice(+t.dataset.pending, 1)[0]; state.sets[t.value] = p; state.open[t.value] = true; rebuild(true); }
  });
  $('d-sets').addEventListener('click', function (e) {
    var t = e.target;
    if (t.dataset.toggle) { state.open[t.dataset.toggle] = !state.open[t.dataset.toggle]; renderSets(); }
    else if (t.dataset.dropPending != null) { state.pending.splice(+t.dataset.dropPending, 1); renderSets(); }
  });
  $('f-from').addEventListener('change', function () { state.range.from = this.value; if (state.range.to < this.value) state.range.to = this.value; renderFilter(); renderTab(); });
  $('f-to').addEventListener('change', function () { state.range.to = this.value; if (state.range.from > this.value) state.range.from = this.value; renderFilter(); renderTab(); });
  $('f-hq').addEventListener('change', function () { state.filter.hq = this.value; renderTab(); });
  $('f-country').addEventListener('change', function () { state.filter.country = this.value; renderTab(); });
  $('f-unit').addEventListener('change', function () { state.unit = this.value; localStorage.setItem(LS.unit, this.value); renderFilter(); renderTab(); });
  $('btn-f-reset').addEventListener('click', function () { state.range = C.defaultRange(state.period); state.filter = {}; renderFilter(); renderTab(); });
  $('btn-dash-xlsx').addEventListener('click', exportXlsx);
  document.querySelector('.tabs').addEventListener('click', function (e) { var b = e.target.closest('.tab'); if (b) { state.tab = b.dataset.tab; renderTab(); } });
  ['by-trade', 'top-trade', 'by-fta', 'by-ruling'].forEach(function (id) { $(id).addEventListener('change', renderTab); });

  if (location.hash === '#example') loadSample();
  else if (restore()) { rebuild(true); msg('이 브라우저에 기억한 데이터를 불러왔습니다. 오늘 엑셀을 올리면 새 데이터로 바뀝니다.', 'note'); }
})();
