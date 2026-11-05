/* 화면 — 판정은 engine.js 가 한다. 여기서는 읽고, 그리고, 고친 문장을 기억할 뿐이다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = Doc.esc;
  var LS = { labels: 'b2611-07.labels', key: 'b2611-07.key', provider: 'b2611-07.provider' };
  // edits[id][section] = { text, source: 'edit' | 'ai' } — 규칙 초안 위에 덮어쓴 문장
  var state = { items: [], sel: 0, edits: {}, ai: {}, labels: Doc.mergeLabels(readJSON(LS.labels)) };

  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }

  /* ---------- 읽기 ---------- */
  function readFile(f) {
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
        load(rows, f.name);
      } catch (err) { $('data-status').innerHTML = '<div class="warn">파일을 읽지 못했습니다: ' + esc(err.message) + '</div>'; }
    };
    rd.readAsArrayBuffer(f);
  }
  function load(rows, name) {
    var n = Doc.normalize(rows);
    state.items = n.items; state.sel = 0; state.edits = {}; state.ai = {};
    var h = '<div class="stats">' + stat('출처', esc(name)) + stat('부품', n.items.length) +
      stat('누락 있는 건', n.items.filter(function (it) { return !Doc.check(it).ok; }).length) + '</div>';
    h += n.issues.length ? '<div class="warn"><b>확인할 것 ' + n.issues.length + '건</b><ul>' + n.issues.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>'
      : '<div class="ok">경고 없이 읽었습니다.</div>';
    $('data-status').innerHTML = h;
    if (!n.items.length) return;
    ['s-draft', 's-ai', 's-out'].forEach(function (id) { $(id).hidden = false; });
    renderAll();
  }
  function stat(k, v) { return '<div class="stat"><b>' + v + '</b>' + k + '</div>'; }

  /* ---------- 목록 ---------- */
  function renderItems() {
    var h = '<div class="tablewrap"><table><thead><tr><th>관리번호</th><th>품명</th><th>모델·품번</th><th>HS 후보 <small>(검토 필요)</small></th><th>점검</th></tr></thead><tbody>';
    state.items.forEach(function (it, i) {
      var c = Doc.check(it), hs = Doc.parseHS(it.hs).list.map(function (x) { return x.display; }).join(', ');
      h += '<tr class="pick' + (i === state.sel ? ' on' : '') + (c.ok ? '' : ' flag') + '" data-i="' + i + '"><td>' + esc(it.id) + '</td><td>' + esc(it.name || '(품명 없음)') + '</td><td>' + esc(it.model || '') +
        '</td><td class="mono">' + esc(hs) + '</td><td>' + (c.ok ? '<span class="tag ok-t">필수 칸 채움</span>' : '<span class="tag bad-t">누락 ' + c.missing.length + '</span>') +
        (c.warns.length ? ' <span class="tag">확인 ' + c.warns.length + '</span>' : '') + '</td></tr>';
    });
    $('items').innerHTML = h + '</tbody></table></div><p class="sub" style="margin-top:8px">줄을 누르면 그 부품의 초안을 엽니다.</p>';
    $('pick').innerHTML = state.items.map(function (it, i) { return '<option value="' + i + '"' + (i === state.sel ? ' selected' : '') + '>' + esc(it.id + ' · ' + (it.name || '(품명 없음)')) + '</option>'; }).join('');
  }

  /* ---------- 초안 ---------- */
  function style() {
    var v = $('style').value;
    if (v !== 'auto') return { style: v, auto: false };
    var d = Doc.detectStyle($('example').value);
    return { style: d.style, auto: true, counts: d.counts };
  }
  var STYLE_NAME = { nida: '…입니다', ida: '…이다', ham: '…임·함' };
  // 한 부품의 최종 칸들: 규칙 초안(문체 적용) 위에 고친 문장·반영한 AI 문장을 얹는다
  function entryOf(i) {
    var it = state.items[i], st = style().style;
    var d = Doc.applyStyle(Doc.draft(it, state.labels), st), ed = state.edits[it.id] || {};
    return { item: it, holes: d.holes, check: Doc.check(it), sections: d.sections.map(function (s) {
      return ed[s.key] ? Object.assign({}, s, { text: ed[s.key].text, source: ed[s.key].source }) : s;
    }) };
  }
  function renderDraft() {
    var it = state.items[state.sel]; if (!it) return;
    var e = entryOf(state.sel), c = e.check, st = style();
    $('pick-info').textContent = (it.row ? '엑셀 ' + it.row + '행 · ' : '') + '모델 ' + (it.model || '없음');
    var h = '';
    if (c.missing.length) h += '<div class="warn"><b>필수 항목 누락 ' + c.missing.length + '건</b> — ' + c.missing.map(esc).join(', ') + '. 초안에는 「[확인 필요: …]」로 남겼습니다.</div>';
    else h += '<div class="ok">필수 항목을 모두 채웠습니다.</div>';
    if (c.warns.length) h += '<div class="note"><b>확인할 점</b><ul>' + c.warns.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    $('check').innerHTML = h;
    $('style-info').textContent = st.auto ? ($('example').value.trim() ? '사례에서 찾은 문체: ' + STYLE_NAME[st.style] : '사례가 없어 …입니다 로 씁니다') : '';

    $('fields').innerHTML = Doc.FIELDS.map(function (f) {
      var long = ['structure', 'function', 'use', 'composition', 'process', 'docs', 'basis'].indexOf(f.key) >= 0;
      var miss = f.req && c.missing.indexOf(f.label) >= 0;
      return '<label class="' + (long ? 'wide' : '') + (miss ? ' miss' : '') + '">' + esc(f.label) + (f.req ? ' <small>필수</small>' : '') +
        (long ? '<textarea rows="2" data-f="' + f.key + '">' + esc(it[f.key] || '') + '</textarea>' : '<input type="text" data-f="' + f.key + '" value="' + esc(it[f.key] || '') + '">') + '</label>';
    }).join('');

    $('sections').innerHTML = e.sections.map(function (s) {
      var badge = s.source === 'ai' ? '<span class="tag ai-t">AI 초안 — 검토 필요</span>' : s.source === 'edit' ? '<span class="tag">직접 고침</span>' : '<span class="tag">' + (s.key === 'opinion' ? '규칙 초안 — 검토 필요' : '입력값으로 만든 초안') + '</span>';
      return '<div class="sec"><div class="sec-h"><h3>' + esc(s.label) + '</h3>' + badge +
        (s.source !== 'rule' ? ' <button class="x" data-reset="' + s.key + '" type="button">규칙 초안으로 되돌리기</button>' : '') + '</div>' +
        '<textarea class="sec-t" rows="' + Math.max(4, s.text.split('\n').length + 1) + '" data-sec="' + s.key + '">' + esc(s.text) + '</textarea></div>';
    }).join('');
    renderAIOut();
  }
  function renderLabels() {
    $('labels').innerHTML = Object.keys(Doc.DEFAULT_LABELS).map(function (k) {
      return '<label>' + (k === 'title' ? '양식 제목' : '칸 ' + (Doc.SECTIONS.indexOf(k) + 1)) + '<input type="text" data-l="' + k + '" value="' + esc(state.labels[k]) + '" placeholder="' + esc(Doc.DEFAULT_LABELS[k]) + '"></label>';
    }).join('');
  }
  function renderAll() { renderItems(); renderDraft(); $('preview').innerHTML = ''; }

  /* ---------- AI(선택) ---------- */
  function renderAIOut() {
    var it = state.items[state.sel], r = it && state.ai[it.id];
    if (!r) { $('ai-out').innerHTML = ''; return; }
    if (r.error) { $('ai-out').innerHTML = '<div class="warn">' + esc(r.error) + '</div>'; return; }
    var h = '<div class="ai-box"><p><span class="tag ai-t">AI 초안 — 검토 필요</span> 입력에 없는 내용이 들어갔는지 꼭 대조해 주세요.</p>';
    if (r.warns.length) h += '<div class="warn"><ul>' + r.warns.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    if (r.missing.length) h += '<p><b>AI 가 짚은 빠진 정보</b></p><ul class="ul">' + r.missing.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
    Doc.SECTIONS.forEach(function (k) {
      if (!r.sections[k]) return;
      h += '<div class="sec"><div class="sec-h"><h3>' + esc(state.labels[k]) + '</h3><button class="btn" data-apply="' + k + '" type="button">이 칸에 반영</button></div><pre class="ai-t-body">' + esc(r.sections[k]) + '</pre></div>';
    });
    if (r.notes) h += '<p class="sub">AI 메모: ' + esc(r.notes) + '</p>';
    $('ai-out').innerHTML = h + '</div>';
  }
  function syncAIBtn() { $('btn-ai').disabled = !($('ai-agree').checked && $('ai-key').value.trim()); }
  function runAI() {
    var it = state.items[state.sel]; if (!it) return;
    if (!$('ai-agree').checked) return;
    var prov = $('ai-provider').value, key = $('ai-key').value.trim();
    localStorage.setItem(LS.key, key); localStorage.setItem(LS.provider, prov);
    var e = entryOf(state.sel);
    var req = Doc.buildRequest(prov, key, Doc.buildPrompt(it, e, $('example').value, state.labels));
    $('btn-ai').disabled = true; $('ai-out').innerHTML = '<p class="sub">AI 에 보내는 중입니다…</p>';
    fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && (j.error.message || j.error.type)) || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) { state.ai[it.id] = Doc.parseAIReply(Doc.extractText(prov, j)); })
      .catch(function (err) { state.ai[it.id] = { error: 'AI 호출 실패: ' + err.message + ' — 규칙 초안은 그대로 쓸 수 있습니다.' }; })
      .then(function () { syncAIBtn(); renderAIOut(); });
  }

  /* ---------- 내보내기 ---------- */
  function entries() { return state.items.map(function (it, i) { return entryOf(i); }); }
  function exportXlsx() {
    var en = entries(), wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(Doc.sheetRows(en, state.labels));
    ws['!cols'] = [10, 18, 16, 18, 18, 50, 50, 50, 40, 60, 18, 18, 40].map(function (w) { return { wch: w }; });
    XLSX.utils.book_append_sheet(wb, ws, '물품설명서');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.items.map(rowOf)), '입력');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['안내'],
      ['품목분류 의견은 규칙·AI 초안이며 최종 판단은 담당자가 합니다.'],
      ['HS 코드는 후보입니다. 관세율 수치는 싣지 않았습니다.'],
      ['예제 데이터는 실제 사내 데이터가 아닙니다.']]), '안내');
    XLSX.writeFile(wb, '물품설명서_초안_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }
  function rowOf(it) { var o = { 관리번호: it.id }; Doc.FIELDS.forEach(function (f) { if (f.key !== 'id') o[f.label] = it[f.key] || ''; }); return o; }
  function template(withSample) {
    var wb = XLSX.utils.book_new();
    var rows = withSample ? Doc.normalize(Doc.sample()).items.map(rowOf) : [rowOf({ id: '' })];
    var ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '부품정보');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['칸', '필수', '적는 법']].concat(Doc.FIELDS.map(function (f) {
      return [f.label, f.req ? '필수' : '', f.key === 'hs' ? '4·6·10자리, 여러 개는 쉼표로 (예: 8431.49, 7325.99)' : f.key === 'process' ? '단계를 → 로 이어 적기' : f.key === 'docs' ? '붙임 자료 이름을 쉼표로 (예: 카탈로그, 도면, 성분표)' : f.key === 'supplierHs' ? '해외 공급자가 제시한 HS 번호(참고)' : ''];
    }))), '작성안내');
    XLSX.writeFile(wb, '물품설명서_부품정보_양식.xlsx');
  }
  function preview() { $('preview').innerHTML = Doc.printHTML(entries(), state.labels); }

  /* ---------- 이벤트 ---------- */
  $('file').addEventListener('change', function (e) { if (e.target.files[0]) readFile(e.target.files[0]); });
  var drop = $('drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  $('btn-sample').addEventListener('click', function () { load(Doc.sample(), '예제(가짜 굴착기 부품 3건)'); });
  $('btn-template').addEventListener('click', function () { template(false); });
  $('btn-new').addEventListener('click', function () {
    if (!state.items.length) load([{ 품명: '새 부품' }], '직접 입력');
    else { state.items.push(Doc.normalize([{ 관리번호: 'P-' + String(state.items.length + 1).padStart(2, '0'), 품명: '새 부품' }]).items[0]); state.sel = state.items.length - 1; renderAll(); }
    $('edit-box').open = true; $('s-draft').scrollIntoView();
  });
  $('items').addEventListener('click', function (e) { var tr = e.target.closest('tr.pick'); if (tr) { state.sel = +tr.dataset.i; renderAll(); } });
  $('pick').addEventListener('change', function () { state.sel = +this.value; renderAll(); });
  $('fields').addEventListener('change', function (e) {
    var k = e.target.dataset.f; if (!k) return;
    var it = state.items[state.sel], v = e.target.value.trim();
    if (k === 'id') { if (!v) return; var old = it.id; it.id = v; if (state.edits[old]) { state.edits[v] = state.edits[old]; delete state.edits[old]; } }
    else if (v) it[k] = v; else delete it[k];
    var open = $('edit-box').open; renderAll(); $('edit-box').open = open;
  });
  $('sections').addEventListener('input', function (e) {
    var k = e.target.dataset.sec; if (!k) return;
    var id = state.items[state.sel].id; (state.edits[id] = state.edits[id] || {})[k] = { text: e.target.value, source: 'edit' };
  });
  $('sections').addEventListener('change', function (e) { if (e.target.dataset.sec) renderDraft(); });
  $('sections').addEventListener('click', function (e) {
    var k = e.target.dataset.reset; if (!k) return;
    var id = state.items[state.sel].id; if (state.edits[id]) delete state.edits[id][k]; renderDraft();
  });
  $('example').addEventListener('input', renderDraft);
  $('style').addEventListener('change', renderDraft);
  $('btn-ex-sample').addEventListener('click', function () { $('example').value = Doc.sampleExample(); renderDraft(); });
  $('labels').addEventListener('change', function (e) {
    var k = e.target.dataset.l; if (!k) return;
    var raw = readJSON(LS.labels) || {}; raw[k] = e.target.value; localStorage.setItem(LS.labels, JSON.stringify(raw));
    state.labels = Doc.mergeLabels(raw); renderLabels(); if (state.items.length) renderAll();
  });
  $('btn-labels-reset').addEventListener('click', function () { localStorage.removeItem(LS.labels); state.labels = Doc.mergeLabels({}); renderLabels(); if (state.items.length) renderAll(); });
  $('ai-key').value = localStorage.getItem(LS.key) || '';
  $('ai-provider').value = localStorage.getItem(LS.provider) || 'openai';
  ['input', 'change'].forEach(function (t) { $('ai-key').addEventListener(t, syncAIBtn); $('ai-agree').addEventListener(t, syncAIBtn); });
  $('btn-ai').addEventListener('click', runAI);
  $('ai-out').addEventListener('click', function (e) {
    var k = e.target.dataset.apply; if (!k) return;
    var it = state.items[state.sel], r = state.ai[it.id];
    (state.edits[it.id] = state.edits[it.id] || {})[k] = { text: r.sections[k], source: 'ai' }; renderDraft();
  });
  $('btn-xlsx').addEventListener('click', exportXlsx);
  $('btn-preview').addEventListener('click', preview);
  $('btn-print').addEventListener('click', function () { preview(); window.print(); });
  renderLabels();
})();
