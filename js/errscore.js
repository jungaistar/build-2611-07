/* 수출입통관 오류점수 분석 — 엔진 (v1.3)
 *
 * 화면(errors.js)은 판정하지 않는다. 관세청 유니패스 「귀책사유자별 오류현황 및 상세목록」 엑셀(수입·수출, 월별 시트)을 읽고,
 * 신고번호의 관세사부호로 인천·울산을 가르고, 월별·캠퍼스별 요약(건수·오류건수·오류점수·비율)·분기 경계·항목별·신고번호별·
 * AEO 관리대장 「발생사유 및 정정내용」 표·월별 공유 메일 초안·엑셀 표를 전부 여기서 만들고 test/logic.test.js 로 고정한다.
 * 브라우저(window.ErrScore)와 node(require) 양쪽에서 읽힌다.
 *
 * 지키는 것(기획자 메일 2026-11-04 「4. 수출입통관오류점수분석」)
 *   - 인천/울산 구분: 신고번호 앞 5자리(신고대행 관세사부호)가 43908 이면 울산, 아니면 인천. 부호 목록은 바꿀 수 있다(RULE).
 *   - 신고번호 체계: 5자리 관세사부호 + 2자리 신고년도 + 고유번호, 끝 글자 M = 수입(iMport) · X = 수출(eXport).
 *   - 오류건수는 「동일한 신고번호는 1건」 — 정정 줄 수가 아니라 신고번호 수다. 오류점수는 줄의 오류점수 합.
 *   - 신고건수(분모)는 이 엑셀에 없다. 종합 신고건수는 「현황목록」 시트의 총신고건, 인천 건수는 수출입실적분석에서 사람이 넣고,
 *     울산 = 총신고건 − 인천. 넣지 않으면 비율을 비워 둔다(짐작하지 않는다).
 *   - 분기 300점 이상이면 실물서류 제출 대상 — 경계는 바꿀 수 있고(기본 300) 어느 범위(종합·캠퍼스·수입/수출)에 적용되는지는 기획자 확인 사항이라 전부 보인다.
 *   - 회사 데이터는 저장소에 넣지 않는다. 예제는 가짜 신고번호·가짜 수치다.
 */
(function (root) {
  'use strict';

  var RULE = { ulsan: ['43908'] };                      // 울산캠퍼스 신고대행 관세사부호
  var THRESHOLD = 300;                                   // 분기 오류점수 경계(실물서류 제출)
  var KINDS = ['수입', '수출'];
  var CAMPUSES = ['인천', '울산'];
  var LETTER = { M: '수입', X: '수출' };

  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function normKey(s) { return String(s == null ? '' : s).replace(/[\s()\[\]·_\-/.]/g, '').toLowerCase(); }
  function toNum(v) { if (typeof v === 'number') return isFinite(v) ? v : null; var s = clean(v).replace(/,/g, ''); if (s === '' || s === '-') return null; var n = Number(s); return isFinite(n) ? n : null; }
  function round(v, d) { var p = Math.pow(10, d == null ? 1 : d); return Math.round(v * p) / p; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* ---------- 신고번호 ---------- */
  function parseDeclNo(v) {
    var s = clean(v).toUpperCase().replace(/[\s\-]/g, '');
    var m = s.match(/^(\d{5})(\d{2})(\d{5,7})([MX])?$/);
    if (!m) return null;
    return { no: s, broker: m[1], year: 2000 + Number(m[2]), seq: m[3], kind: m[4] ? LETTER[m[4]] : null };
  }
  function campusOf(declNo, rule) {
    var p = parseDeclNo(declNo); if (!p) return null;
    var list = (rule || RULE).ulsan || [];
    return list.indexOf(p.broker) >= 0 ? '울산' : '인천';
  }

  /* ---------- 날짜 ---------- */
  function parseDate(v) {
    if (v instanceof Date) return isNaN(v) ? null : v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
    if (typeof v === 'number' && v > 20000 && v < 80000) { var t = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)); return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate()); }
    var m = clean(v).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/); if (!m) { m = clean(v).match(/^(\d{4})(\d{2})(\d{2})/); if (!m) return null; }
    var y = +m[1], mo = +m[2], d = +m[3]; if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    return y + '-' + pad2(mo) + '-' + pad2(d);
  }
  function monthOfName(name) { var m = clean(name).match(/(\d{1,2})\s*월/); return m ? +m[1] : null; }

  /* ---------- 시트 읽기 ---------- */
  var FIELDS = [
    { key: 'declNo', label: '신고번호', aliases: ['신고번호', '수출신고번호', '수입신고번호', '신고번호(란)'], req: true },
    { key: 'score', label: '오류점수', aliases: ['오류점수', '점수', '감점'], req: true },
    { key: 'score2', label: '변경 후 오류점수', aliases: ['변경후오류점수', '변경 후 오류점수', '변경후점수'] },
    { key: 'fixedAt', label: '정정일자 및 시간', aliases: ['정정일자및시간', '정정일자', '정정일시', '정정일'] },
    { key: 'accept', label: '수리구분', aliases: ['수리구분', '수리전후'] },
    { key: 'fixType', label: '정정구분', aliases: ['정정구분'] },
    { key: 'code', label: '항목코드', aliases: ['항목코드', '코드'] },
    { key: 'item', label: '항목명', aliases: ['항목명', '항목', '정정항목'] },
    { key: 'before', label: '정정전내역', aliases: ['정정전내역', '정정전', '변경전'] },
    { key: 'after', label: '정정후내역', aliases: ['정정후내역', '정정후', '변경후'] },
    { key: 'lane', label: '란번호', aliases: ['란번호', '란'] },
    { key: 'payer', label: '귀책사유자부호', aliases: ['귀책사유자부호', '귀책사유자'] }
  ];
  function mapHeaders(headers) {
    var map = {}, used = {};
    FIELDS.forEach(function (f) {
      var hit = null;
      headers.forEach(function (h, i) { if (hit != null || used[i]) return; var n = normKey(h); if (n && f.aliases.some(function (a) { return normKey(a) === n; })) hit = i; });
      if (hit == null) headers.forEach(function (h, i) { if (hit != null || used[i]) return; var n = normKey(h); if (n && f.aliases.some(function (a) { var k = normKey(a); return k.length >= 3 && n.indexOf(k) >= 0; })) hit = i; });
      if (hit != null) { map[f.key] = hit; used[hit] = 1; }
    });
    var missing = FIELDS.filter(function (f) { return f.req && map[f.key] == null; }).map(function (f) { return f.label; });
    return { map: map, missing: missing };
  }
  function findHeaderRow(aoa, must) {
    for (var i = 0; i < Math.min(aoa.length, 12); i++) {
      var row = (aoa[i] || []).map(normKey);
      if (must.every(function (m) { return row.some(function (c) { return c.indexOf(normKey(m)) >= 0; }); })) return i;
    }
    return -1;
  }
  function classifySheet(name) {
    var n = clean(name);
    if (/상세/.test(n)) return 'detail';
    if (/현황/.test(n)) return 'status';
    if (/요약/.test(n)) return 'summary';
    return null;
  }
  function kindOfText(s) { var t = clean(s); if (/수입|import/i.test(t) && !/수출/.test(t)) return '수입'; if (/수출|export/i.test(t) && !/수입/.test(t)) return '수출'; return null; }

  // 상세목록 시트 → 정규화 줄. month 는 시트 이름에서, 없으면 정정일자에서.
  function readDetail(aoa, opts) {
    opts = opts || {};
    if (!aoa.some(function (r) { return (r || []).some(function (c) { return clean(c) !== ''; }); })) return { rows: [], skipped: 0 };   // 그 달 오류 없음(빈 시트)
    var hi = findHeaderRow(aoa, ['신고번호', '오류점수']);
    if (hi < 0) return { rows: [], skipped: 0, error: '머리글(신고번호 · 오류점수)을 찾지 못했습니다.' };
    var headers = aoa[hi].map(clean), mh = mapHeaders(headers);
    if (mh.missing.length) return { rows: [], skipped: 0, error: '필요한 열이 없습니다: ' + mh.missing.join(' · ') };
    var rows = [], skipped = 0, m = mh.map;
    aoa.slice(hi + 1).forEach(function (r) {
      var p = parseDeclNo(r[m.declNo]);
      if (!p) { if ((r || []).some(function (c) { return clean(c) !== ''; })) skipped++; return; }
      var fixedAt = m.fixedAt != null ? parseDate(r[m.fixedAt]) : null;
      var month = opts.month || (fixedAt ? +fixedAt.slice(5, 7) : null);
      rows.push({
        kind: opts.kind || p.kind || null, month: month, year: fixedAt ? +fixedAt.slice(0, 4) : p.year,
        declNo: p.no, broker: p.broker, campus: campusOf(p.no, opts.rule), lane: m.lane != null ? clean(r[m.lane]) : '',
        fixedAt: fixedAt, fixedRaw: m.fixedAt != null ? clean(r[m.fixedAt]) : '',
        accept: m.accept != null ? clean(r[m.accept]) : '', fixType: m.fixType != null ? clean(r[m.fixType]) : '',
        code: m.code != null ? clean(r[m.code]) : '', item: m.item != null ? clean(r[m.item]) : '',
        score: toNum(r[m.score]) || 0, score2: m.score2 != null ? toNum(r[m.score2]) : null,
        before: m.before != null ? clean(r[m.before]) : '', after: m.after != null ? clean(r[m.after]) : ''
      });
    });
    return { rows: rows, skipped: skipped, headers: headers, map: m };
  }
  // 현황목록 시트 → { total(총신고건), score, rate } — 귀책사유자 한 줄
  function readStatus(aoa) {
    var hi = findHeaderRow(aoa, ['총신고건']); if (hi < 0) return null;
    var h = aoa[hi].map(normKey), iT = h.indexOf(normKey('총신고건')), iS = h.findIndex(function (c) { return c.indexOf('오류점수') >= 0; }), iR = h.findIndex(function (c) { return c.indexOf('비율') >= 0; });
    var r = aoa[hi + 1]; if (!r) return null;
    return { total: toNum(r[iT]), score: iS >= 0 ? toNum(r[iS]) : null, rate: iR >= 0 ? toNum(r[iR]) : null };
  }
  // 요약 시트(담당자가 손으로 정리한 표) → hand[월][종합|인천|울산] = { decl, err, score }. 월 머리글 칸부터 건수·오류건수·오류점수·비율 순서다.
  function readHandSummary(aoa) {
    var hi = -1, cols = {};
    for (var i = 0; i < Math.min(aoa.length, 6); i++) {
      var found = {}; (aoa[i] || []).forEach(function (c, j) { var m = clean(c).match(/^(\d{1,2})\s*월$/); if (m) found[+m[1]] = j; });
      if (Object.keys(found).length) { hi = i; cols = found; break; }
    }
    if (hi < 0) return {};
    var hand = {};
    aoa.slice(hi + 1).forEach(function (r) {
      var label = clean((r || [])[0]); if (['종합', '인천', '울산'].indexOf(label) < 0) return;
      Object.keys(cols).forEach(function (m) {
        var c = cols[m], decl = toNum(r[c]), err = toNum(r[c + 1]), score = toNum(r[c + 2]);
        if (decl == null && err == null && score == null) return;
        (hand[m] = hand[m] || {})[label] = { decl: decl, err: err, score: score };
      });
    });
    return hand;
  }
  // 통합문서 한 권: sheets = [{ name, aoa }]. 수입/수출은 요약 제목 → 파일명 → 신고번호 끝 글자 순으로 정한다.
  function readWorkbook(sheets, fileName, rule) {
    var kind = null, notes = [], rows = [], status = {}, skipped = 0;
    var sm = sheets.filter(function (s) { return classifySheet(s.name) === 'summary'; })[0];
    if (sm) { var first = (sm.aoa[0] || []).concat(sm.aoa[1] || []).map(clean).join(' '); kind = kindOfText(first); }
    if (!kind) kind = kindOfText(fileName || '');
    var details = sheets.filter(function (s) { return classifySheet(s.name) === 'detail'; });
    var statuses = sheets.filter(function (s) { return classifySheet(s.name) === 'status'; });
    if (!details.length && !sm && !statuses.length) { // 시트 이름이 없으면 머리글로 찾는다
      sheets.forEach(function (s) { if (findHeaderRow(s.aoa, ['신고번호', '오류점수']) >= 0) details.push(s); else if (findHeaderRow(s.aoa, ['총신고건']) >= 0) statuses.push(s); });
    }
    if (!details.length) return { kind: kind, rows: [], status: {}, hand: {}, notes: ['「상세목록」 시트를 찾지 못했습니다(시트 이름에 「상세」 또는 머리글에 신고번호·오류점수).'], skipped: 0, months: [] };
    details.forEach(function (s) {
      var d = readDetail(s.aoa, { month: monthOfName(s.name), kind: kind, rule: rule });
      if (d.error) { notes.push(s.name + ': ' + d.error); return; }
      rows = rows.concat(d.rows); skipped += d.skipped;
    });
    if (!kind) { // 신고번호 끝 글자 다수결
      var c = {}; rows.forEach(function (r) { var p = parseDeclNo(r.declNo); if (p && p.kind) c[p.kind] = (c[p.kind] || 0) + 1; });
      kind = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0] || null;
      rows.forEach(function (r) { if (!r.kind) r.kind = kind; });
    }
    statuses.forEach(function (s) { var mo = monthOfName(s.name), st = readStatus(s.aoa); if (mo && st) status[mo] = st; });
    var months = uniq(rows.map(function (r) { return r.month; }).filter(Boolean)).sort(function (a, b) { return a - b; });
    if (!kind) notes.push('수입인지 수출인지 알 수 없습니다 — 파일 이름에 「수입」 또는 「수출」을 넣어 주세요.');
    return { kind: kind, rows: rows, status: status, hand: sm ? readHandSummary(sm.aoa) : {}, notes: notes, skipped: skipped, months: months, fileName: fileName || '' };
  }

  /* ---------- 규칙 다시 적용 · 부호표 · 인천 건수 · 대장 대조 ---------- */
  function applyRule(books, rule) { books.forEach(function (b) { b.rows.forEach(function (r) { r.campus = campusOf(r.declNo, rule); }); }); return books; }
  function brokers(rows, rule) {
    var g = {}, list = (rule || RULE).ulsan || [];
    rows.forEach(function (r) { var x = g[r.broker] || (g[r.broker] = { broker: r.broker, decls: {}, score: 0 }); x.decls[r.declNo] = 1; x.score += r.score || 0; });
    return Object.keys(g).sort().map(function (k) { return { broker: k, err: Object.keys(g[k].decls).length, score: round(g[k].score, 2), campus: list.indexOf(k) >= 0 ? '울산' : '인천' }; });
  }
  // 요약 시트에 있는 인천 신고건수를 기본값으로(메일: 인천 건수는 수출입실적분석에서, 울산 = 총신고건 − 인천)
  function countsFromBooks(books) {
    var c = { 수입: {}, 수출: {} };
    books.forEach(function (b) { if (!b.kind || !b.hand) return; Object.keys(b.hand).forEach(function (m) { var x = b.hand[m].인천; if (x && x.decl != null) c[b.kind][m] = x.decl; }); });
    return c;
  }
  // 엔진 계산 ↔ 담당자 요약 표. 점수 차이가 먼저고, 건수 차이는 따로 센다(대장에 0점 신고번호를 뺀 달이 있다).
  function compare(books, summary) {
    var out = [];
    books.forEach(function (b) {
      if (!b.kind || !b.hand) return;
      Object.keys(b.hand).map(Number).sort(function (a, c) { return a - c; }).forEach(function (m) {
        CAMPUSES.forEach(function (cp) {
          var h = b.hand[m][cp]; if (!h) return;
          var mm = summary.kinds[b.kind].months[m], calc = mm ? mm[cp] : { err: 0, score: 0 };
          var ds = round((calc.score || 0) - (h.score || 0), 1), de = (calc.err || 0) - (h.err || 0);
          out.push({ kind: b.kind, month: m, campus: cp, calcErr: calc.err || 0, calcScore: calc.score || 0, handErr: h.err || 0, handScore: round(h.score || 0, 2), scoreDiff: ds, errDiff: de });
        });
      });
    });
    return { rows: out, scoreDiffs: out.filter(function (x) { return x.scoreDiff !== 0; }), errDiffs: out.filter(function (x) { return x.errDiff !== 0; }) };
  }

  /* ---------- 집계 ---------- */
  function distinct(rows) { return uniq(rows.map(function (r) { return r.declNo; })).length; }
  function sum(rows) { return round(rows.reduce(function (a, r) { return a + (r.score || 0); }, 0), 2); }
  function rateOf(score, decl) { return decl > 0 && score != null ? round(score / decl * 100, 2) : null; }
  function cell(rows, decl) { var s = sum(rows); return { decl: decl == null ? null : decl, err: distinct(rows), score: s, rate: rateOf(s, decl) }; }
  // books: readWorkbook 결과들 · counts: { 수입: { 9: 1002 }, 수출: {...} } 인천 신고건수(수출입실적분석)
  function summarize(books, counts, opts) {
    opts = opts || {}; counts = counts || {};
    var all = [], status = { 수입: {}, 수출: {} };
    books.forEach(function (b) { if (!b.kind) return; all = all.concat(b.rows.filter(function (r) { return r.month; })); Object.keys(b.status).forEach(function (m) { status[b.kind][m] = b.status[m]; }); });
    var months = uniq(all.map(function (r) { return r.month; })).concat(Object.keys(status.수입).map(Number), Object.keys(status.수출).map(Number));
    months = uniq(months).filter(Boolean).sort(function (a, b) { return a - b; });
    var year = all.length ? all.map(function (r) { return r.year; }).filter(Boolean).sort()[0] : null;
    var out = { months: months, year: year, kinds: {}, total: {} };
    KINDS.forEach(function (k) {
      var kr = all.filter(function (r) { return r.kind === k; }), per = {};
      months.forEach(function (m) {
        var mr = kr.filter(function (r) { return r.month === m; }), st = status[k][m], total = st ? st.total : null;
        var inc = counts[k] && counts[k][m] != null ? toNum(counts[k][m]) : null;
        var uls = total != null && inc != null ? total - inc : null;
        per[m] = { 종합: cell(mr, total), 인천: cell(mr.filter(function (r) { return r.campus === '인천'; }), inc), 울산: cell(mr.filter(function (r) { return r.campus === '울산'; }), uls), statusScore: st ? st.score : null };
      });
      out.kinds[k] = { months: per, cum: cumOf(per, months) };
    });
    months.forEach(function (m) {
      var t = {};
      ['종합', '인천', '울산'].forEach(function (c) {
        var a = out.kinds.수입.months[m][c], b = out.kinds.수출.months[m][c];
        var decl = a.decl != null && b.decl != null ? a.decl + b.decl : null, score = round(a.score + b.score, 2);
        t[c] = { decl: decl, err: a.err + b.err, score: score, rate: rateOf(score, decl) };
      });
      out.total[m] = t;
    });
    out.totalCum = cumOf(out.total, months);
    out.quarters = quarters(out, opts.threshold);
    return out;
  }
  function cumOf(per, months) {
    var c = {};
    ['종합', '인천', '울산'].forEach(function (cp) {
      var decl = 0, dk = true, err = 0, score = 0;
      months.forEach(function (m) { var x = per[m][cp]; if (x.decl == null) dk = false; else decl += x.decl; err += x.err; score += x.score; });
      c[cp] = { decl: dk && months.length ? decl : null, err: err, score: round(score, 2), rate: dk ? rateOf(round(score, 2), decl) : null };
    });
    return c;
  }
  // 분기별 오류점수 — 범위(수입·수출·수출입 × 종합·인천·울산) 전부
  function quarters(summary, threshold) {
    var th = threshold == null ? THRESHOLD : threshold, out = [];
    var scopes = [{ kind: '수출입', get: function (m) { return summary.total[m]; } }, { kind: '수입', get: function (m) { return summary.kinds.수입.months[m]; } }, { kind: '수출', get: function (m) { return summary.kinds.수출.months[m]; } }];
    scopes.forEach(function (sc) {
      ['종합', '인천', '울산'].forEach(function (cp) {
        for (var q = 1; q <= 4; q++) {
          var ms = summary.months.filter(function (m) { return Math.ceil(m / 3) === q; }); if (!ms.length) continue;
          var s = round(ms.reduce(function (a, m) { return a + sc.get(m)[cp].score; }, 0), 2);
          out.push({ kind: sc.kind, campus: cp, q: q, months: ms, score: s, over: s >= th, near: s < th && s >= th * 0.8, threshold: th });
        }
      });
    });
    return out;
  }
  // 항목명별 — 줄 수 · 신고번호 수 · 오류점수 · 비중
  function topItems(rows, n) {
    var g = {}, total = sum(rows);
    rows.forEach(function (r) { var k = r.item || '(항목명 없음)'; if (!g[k]) g[k] = { item: k, codes: [], n: 0, decls: [], score: 0 }; g[k].n++; g[k].score += r.score || 0; if (g[k].decls.indexOf(r.declNo) < 0) g[k].decls.push(r.declNo); if (r.code && g[k].codes.indexOf(r.code) < 0) g[k].codes.push(r.code); });
    var list = Object.keys(g).map(function (k) { var x = g[k]; return { item: x.item, code: x.codes.join('·'), n: x.n, err: x.decls.length, score: round(x.score, 2), share: total > 0 ? round(x.score / total * 100, 1) : null }; });
    list.sort(function (a, b) { return b.score - a.score || b.n - a.n || (a.item < b.item ? -1 : 1); });
    return n ? list.slice(0, n) : list;
  }
  // 신고번호별 — 관리대장의 한 줄 재료
  function byDecl(rows) {
    var g = {};
    rows.forEach(function (r) {
      var x = g[r.declNo] || (g[r.declNo] = { declNo: r.declNo, kind: r.kind, campus: r.campus, broker: r.broker, month: r.month, fixedAt: null, n: 0, score: 0, items: [], accepts: [], changes: [] });
      x.n++; x.score += r.score || 0;
      if (r.fixedAt && (!x.fixedAt || r.fixedAt < x.fixedAt)) x.fixedAt = r.fixedAt;
      if (r.item && x.items.indexOf(r.item) < 0) x.items.push(r.item);
      if (r.accept && x.accepts.indexOf(r.accept) < 0) x.accepts.push(r.accept);
      if (r.item && (r.score || 0) > 0) x.changes.push(r.item + ' ' + (r.before || '') + ' → ' + (r.after || ''));
    });
    var list = Object.keys(g).map(function (k) { g[k].score = round(g[k].score, 2); return g[k]; });
    list.sort(function (a, b) { return (a.month || 0) - (b.month || 0) || b.score - a.score || (a.declNo < b.declNo ? -1 : 1); });
    return list;
  }
  var LEDGER_HEAD = ['구분', 'No', '사업부', 'DRAFT NO', '신고번호', '정정일자', '오류점수', '발생사유 및 정정내용', '귀책', '관련부서', '담당자'];
  // notes[declNo] = { div, draft, reason, blame, dept, owner } — 사람이 채우는 칸. 사유를 안 썼으면 정정 내역(항목 전→후)을 대신 넣는다.
  function ledger(decls, notes, opts) {
    notes = notes || {}; opts = opts || {};
    var list = opts.all ? decls : decls.filter(function (d) { return d.score > 0; });
    var cnt = { 수입: 0, 수출: 0 };
    return list.map(function (d) {
      var n = notes[d.declNo] || {}; cnt[d.kind] = (cnt[d.kind] || 0) + 1;
      return [d.kind || '', cnt[d.kind], n.div || '', n.draft || '', d.declNo, d.fixedAt || '', d.score, n.reason || d.changes.slice(0, 3).join(' / '), n.blame || '', n.dept || '', n.owner || ''];
    });
  }

  /* ---------- 월별 공유 메일 초안 ---------- */
  function f0(v) { return v == null ? '—' : Math.round(v).toLocaleString('ko-KR'); }
  function f1(v) { return v == null ? '—' : String(round(v, 1)); }
  function pct(v) { return v == null ? '—' : round(v, 1) + '%'; }
  function upTo(summary, m, cp) { return summary.months.filter(function (x) { return x <= m; }).reduce(function (a, x) { return a + summary.total[x][cp].score; }, 0); }
  function upToKind(K, summary, m, cp) { return summary.months.filter(function (x) { return x <= m; }).reduce(function (a, x) { return a + K.months[x][cp].score; }, 0); }
  function mailDraft(summary, month, opts) {
    opts = opts || {};
    var m = month || summary.months[summary.months.length - 1]; if (!m) return { subject: '', body: '' };
    var prev = summary.months.filter(function (x) { return x < m; }).pop();
    var T = summary.total[m], P = prev ? summary.total[prev] : null, n = summary.months.filter(function (x) { return x <= m; }).length;
    var yr = summary.year ? summary.year + '년 ' : '';
    var lines = [];
    lines.push('수신인께!');
    lines.push('');
    lines.push(m + '월 수출입 오류관리대장을 배포하오니, AEO 위험성평가 등에 참고하여 주시기 바랍니다.');
    lines.push('');
    var delta = P ? round(T.인천.score - P.인천.score, 1) : null, cumI = upTo(summary, m, '인천');   // 기획자 메일의 1) 줄은 인천 기준이다(2,524건 · 71점)
    lines.push('1) 수출입 오류 현황 : (건수) ' + f0(T.인천.decl) + '건 (오류점수) ' + f1(T.인천.score) + '점' + (delta != null ? ' => ' + m + '월의 경우 ' + prev + '월 대비 오류점수 ' + (delta >= 0 ? delta + '점 증가' : (-delta) + '점 감소') : '') + ' => 월평균 오류점수 ' + f1(cumI / n) + '점');
    KINDS.forEach(function (k) {
      var K = summary.kinds[k], X = K.months[m], PX = prev ? K.months[prev] : null;
      var d2 = PX ? round(X.인천.score - PX.인천.score, 1) : null;
      lines.push('  - ' + k + '(인천) : (신고건수) ' + f0(X.인천.decl) + '건, (오류건수) ' + f0(X.인천.err) + '건, (오류점수) ' + f1(X.인천.score) + '점, (오류비율) ' + pct(X.인천.rate) + (d2 != null ? ' => ' + m + '월은 ' + prev + '월 대비 오류점수 ' + (d2 >= 0 ? d2 + '점 증가' : (-d2) + '점 감소') + ',' : ' =>') + ' 1~' + m + '월까지 누적 발생오류 점수는 ' + f1(upToKind(K, summary, m, '인천')) + '점');
      lines.push('    => 울산캠퍼스 ' + m + '월 ' + k + '오류 점수는 ' + f1(X.울산.score) + '점이며 1~' + m + '월까지 누적 발생오류 점수는 ' + f1(upToKind(K, summary, m, '울산')) + '점');
      if (opts.reasons && opts.reasons[k]) lines.push('    . ' + opts.reasons[k]);
    });
    lines.push('');
    lines.push('2) 수출입오류점수 발생세부 현황 => [항목별 상위 · 발생 사유를 적어 주세요]');
    var top = opts.top || [];
    top.slice(0, 5).forEach(function (t) { lines.push('  . ' + t.item + ' : ' + t.err + '건 ' + f1(t.score) + '점'); });
    lines.push('');
    lines.push('3) Next Step');
    lines.push('  . 각 사업본부 수출입담당자에게 오류발생 최소화 안내 및 교육 실시');
    lines.push('  . 수출신고후 7일이내 정정신고로 오류점수 미발생관리 실시');
    lines.push('');
    lines.push('[첨부파일] 1. ' + yr + 'AEO월별오류점수관리대장  2. 수출/수입귀책사유자별오류현황 및 상세목록  3. 신고인오류대장');
    lines.push('');
    lines.push('감사합니다.');
    return { subject: '(' + m + '월) 수출입 오류점수 현황 및 오류관리대장 공유', body: lines.join('\n') };
  }

  /* ---------- 엑셀 ---------- */
  function monthLabel(m, year) { return (year ? year + '년 ' : '') + m + '월'; }
  function summaryAoa(summary) {
    var ms = summary.months.slice().reverse(), head1 = ['구분', ''], head2 = ['', ''];
    ms.forEach(function (m) { head1.push(m + '월', '', '', ''); head2.push('신고건수', '오류건수', '오류점수', '비율(%)'); });
    head1.push('합계', '', '', ''); head2.push('신고건수', '오류건수', '오류점수', '비율(%)');
    var rows = [['▣ ' + (summary.year ? summary.year + '년도 ' : '') + '수출입오류점수 현황'], head1, head2];
    function line(a, b, get, cum) { var r = [a, b]; ms.forEach(function (m) { var x = get(m); r.push(x.decl == null ? '' : x.decl, x.err, x.score, x.rate == null ? '' : x.rate); }); r.push(cum.decl == null ? '' : cum.decl, cum.err, cum.score, cum.rate == null ? '' : cum.rate); return r; }
    rows.push(line('종합', '', function (m) { return summary.total[m].종합; }, summary.totalCum.종합));
    CAMPUSES.forEach(function (c) { rows.push(line('수출입', c, function (m) { return summary.total[m][c]; }, summary.totalCum[c])); });
    KINDS.forEach(function (k) { rows.push([]); rows.push(line(k, '종합', function (m) { return summary.kinds[k].months[m].종합; }, summary.kinds[k].cum.종합)); CAMPUSES.forEach(function (c) { rows.push(line(k, c, function (m) { return summary.kinds[k].months[m][c]; }, summary.kinds[k].cum[c])); }); });
    rows.push([]); rows.push(['규칙', '인천/울산 = 신고번호 앞 5자리 관세사부호(' + RULE.ulsan.join(',') + ' → 울산) · 오류건수 = 신고번호 수 · 비율 = 오류점수 ÷ 신고건수 · 인천 신고건수는 수출입실적분석에서 입력, 울산 = 총신고건 − 인천']);
    return rows;
  }
  function exportBook(ctx) {
    var s = ctx.summary, out = [];
    out.push({ name: '오류점수요약', aoa: summaryAoa(s) });
    out.push({ name: '발생사유및정정내용', aoa: [LEDGER_HEAD].concat(ledger(ctx.decls, ctx.notes, { all: ctx.allDecls })) });
    out.push({ name: '분기', aoa: [['구분', '캠퍼스', '분기', '월', '오류점수', '경계', '판정']].concat(s.quarters.map(function (q) { return [q.kind, q.campus, q.q + '분기', q.months.join(','), q.score, q.threshold, q.over ? '경계 이상(실물서류 제출 대상)' : q.near ? '경계 80% 이상' : '']; })) });
    out.push({ name: '항목별', aoa: [['항목명', '항목코드', '정정 줄', '신고번호 수', '오류점수', '비중(%)']].concat(topItems(ctx.rows).map(function (t) { return [t.item, t.code, t.n, t.err, t.score, t.share == null ? '' : t.share]; })) });
    out.push({ name: '상세', aoa: [['구분', '월', '캠퍼스', '관세사부호', '신고번호', '란번호', '정정일자', '수리구분', '정정구분', '항목코드', '항목명', '오류점수', '변경 후 오류점수', '정정전내역', '정정후내역']].concat(ctx.rows.map(function (r) { return [r.kind, r.month, r.campus, r.broker, r.declNo, r.lane, r.fixedRaw || r.fixedAt || '', r.accept, r.fixType, r.code, r.item, r.score, r.score2 == null ? '' : r.score2, r.before, r.after]; })) });
    return out;
  }

  /* ---------- 예제 — 가짜 수치·가짜 신고번호(실제 사내 데이터가 아닙니다) ---------- */
  var SAMPLE_ITEMS = { 수입: ['원산지표시유무구분코드', '관세', '부가세과세과표총액', '과세가격원화금액', 'HS10단위부호', '신고수량', '운송보험료'], 수출: ['신고금액', '신고단가', '순중량', '송장번호', '결제금액', '모델규격명', '포장개수'] };
  function sampleBooks() {
    var books = [];
    KINDS.forEach(function (k, ki) {
      var letter = k === '수입' ? 'M' : 'X', sheets = [], seed = 17 + ki * 7;
      var hand = {};
      [7, 8, 9].forEach(function (mo, mi) {
        var total = k === '수입' ? [2023, 1543, 1764][mi] : [2453, 1933, 2227][mi];
        var detail = [['No', '귀책사유자부호', '신고번호', '란번호', '정정일자 및 시간', '수리구분', '정정구분', '항목코드', '항목명', '오류점수', '변경 후 오류점수', '정정전내역', '정정후내역']];
        var nDecl = [3, 4, 6][mi] + ki, no = 0, score = 0;
        for (var d = 0; d < nDecl; d++) {
          var broker = (d + mi + ki) % 3 === 0 ? '42158' : '43908';          // 셋에 하나 인천, 나머지 울산
          var decl = broker + '26' + String(600000 + seed * 37 + mo * 1000 + d * 13).slice(0, 6) + letter;
          var lines = 1 + ((d + mi) % 3);
          for (var l = 0; l < lines; l++) {
            var item = SAMPLE_ITEMS[k][(d + l + mi) % SAMPLE_ITEMS[k].length];
            var sc = [0, 1, 2, 5, 10, 3][(d * 2 + l + mi) % 6]; score += sc;
            detail.push([++no, '예제1177017', decl, '0', '2026-' + pad2(mo) + '-' + pad2(3 + d * 3 + l) + '  10:' + pad2(10 + l * 7) + ':00', l === 0 && d % 4 === 3 ? '수리전' : '수리후', '정정', 'A' + (800 + (d + l) % 20), item, sc, sc, String(1000 + d * 111), String(1000 + d * 111 + 50)]);
          }
        }
        var inc = k === '수입' ? [1260, 900, 1002][mi] : [1535, 1212, 1522][mi], cnt = { 인천: { d: {}, s: 0 }, 울산: { d: {}, s: 0 } };
        detail.slice(1).forEach(function (r) { var c = campusOf(r[2]); cnt[c].d[r[2]] = 1; cnt[c].s += r[9]; });
        var shift = k === '수출' && mo === 8 ? 5 : 0;      // 예제: 담당자 표가 5점 어긋난 달(대조 화면 시연용)
        hand[mo] = { 인천: [inc, Object.keys(cnt.인천.d).length, cnt.인천.s + shift], 울산: [total - inc, Object.keys(cnt.울산.d).length, cnt.울산.s - shift] };
        sheets.push({ name: '귀책사유자별오류현황목록_' + mo + '월', aoa: [['No', '귀책사유자부호', '귀책사유자상호', '관할지세관부호', '관할지세관', '총신고건', '오류점수', '비율'], [1, '예제1177017', '예제건설기계(주)', '012', '성남세관', total, score, round(score / total * 100, 1)]] });
        sheets.push({ name: '귀책사유자별오류상세목록_' + mo + '월', aoa: detail });
      });
      var hd = ['구분'], order = [9, 8, 7], line = function (cp) { var r = [cp]; order.forEach(function (mo) { r = r.concat(hand[mo][cp], ['']); }); return r; };
      order.forEach(function (mo) { hd.push(mo + '월', '', '', ''); });
      sheets.unshift({ name: '요약', aoa: [['▣ 2026년 ' + k + '오류점수 현황(예제)'], hd, [''].concat(['건수', '오류건수', '오류점수', '비율', '건수', '오류건수', '오류점수', '비율', '건수', '오류건수', '오류점수', '비율']), line('인천'), line('울산')] });
      books.push({ name: '예제_2026년' + k + '귀책사유자별오류현황및상세목록.xlsx', sheets: sheets });
    });
    return books;
  }

  var api = {
    RULE: RULE, THRESHOLD: THRESHOLD, KINDS: KINDS, CAMPUSES: CAMPUSES, FIELDS: FIELDS, LEDGER_HEAD: LEDGER_HEAD,
    parseDeclNo: parseDeclNo, campusOf: campusOf, parseDate: parseDate, monthOfName: monthOfName, classifySheet: classifySheet,
    mapHeaders: mapHeaders, findHeaderRow: findHeaderRow, readDetail: readDetail, readStatus: readStatus, readWorkbook: readWorkbook, readHandSummary: readHandSummary, applyRule: applyRule, brokers: brokers, countsFromBooks: countsFromBooks, compare: compare,
    summarize: summarize, quarters: quarters, topItems: topItems, byDecl: byDecl, ledger: ledger, mailDraft: mailDraft,
    summaryAoa: summaryAoa, exportBook: exportBook, sampleBooks: sampleBooks, round: round, toNum: toNum
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ErrScore = api;
})(this);
