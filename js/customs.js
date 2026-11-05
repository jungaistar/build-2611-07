/* 수출입통관 업무 대시보드 — 엔진 (v1.1 · v1.2 결정문 현황)
 *
 * 화면(dash.js · library.js)은 판정하지 않는다. 열 이름 짝짓기·값 읽기·집계·전년 동기 대비·
 * FTA 활용률·환급·오류 비율·엑셀 표·자료 목록 규칙은 전부 여기서 만들고 test/logic.test.js 로 고정한다.
 * 브라우저(window.Customs)와 node(require) 양쪽에서 읽힌다.
 *
 * 지키는 것
 *   - 화면에 보이는 숫자는 올린 파일에서 계산한다. 손으로 적은 값이 없다.
 *   - 0 으로 나누면 값을 지어내지 않고 null(화면 「—」)로 둔다.
 *   - 못 읽은 줄은 조용히 버리지 않는다. 건너뛴 줄과 사유를 돌려준다.
 *   - 열 이름이 달라도 받는다. 늘릴 때는 코드가 아니라 DATASETS 의 aliases 표를 늘린다.
 */
(function (root) {
  'use strict';

  /* ---------- 데이터 종류와 열 ---------- */
  // type: date · text · hs · num. req = 이 열이 없으면 집계할 수 없다(사용자가 골라야 한다).
  var HQ = { key: 'hq', label: '본부', type: 'text', req: true, aliases: ['사업본부', '본부명', '사업부', '부문', '사업부문', 'division', 'bu'] };
  var HS = { key: 'hs', label: 'HS 코드', type: 'hs', req: true, aliases: ['hs', 'hscode', 'hs코드', 'hs부호', '세번', '세번부호', '품목번호', 'hsk', '품목분류'] };
  var FTA_GOODS = { key: 'ftaGoods', label: '물자대_FTA', type: 'num', aliases: ['물자대fta', 'fta물자대', 'fta적용물자대', 'fta금액', 'fta적용금액', '협정적용금액', 'fta적용액'] };
  var SAVING = { key: 'saving', label: '절감액', type: 'num', aliases: ['fta절감액', '관세절감액', '감면액', 'fta감면액', '절감관세'] };
  var DATASETS = {
    import: {
      label: '수입 통관 실적', source: 'ERP 엑셀', cycle: '매일', hint: /수입|import/i,
      fields: [
        { key: 'date', label: '신고일자', type: 'date', req: true, aliases: ['수리일자', '신고일', '수입신고일', '수입신고일자', '통관일자', '수리일', '일자', 'date'] },
        HQ,
        { key: 'country', label: '국가', type: 'text', req: true, aliases: ['원산지', '원산지국', '적출국', '국가명', '수입국', '원산국', 'country', 'origin'] },
        { key: 'company', label: '업체', type: 'text', req: true, aliases: ['업체명', '거래처', '거래처명', '공급사', '공급업체', '수출자', '해외공급자', 'vendor', 'supplier'] },
        HS,
        { key: 'goods', label: '물자대', type: 'num', req: true, aliases: ['물품가액', '과세가격', '물자대금액', '수입금액', '과세가격원화', '금액', 'amount'] },
        { key: 'duty', label: '관세', type: 'num', req: true, aliases: ['관세액', '관세금액', '납부관세', '납부세액관세', 'duty'] },
        FTA_GOODS, SAVING
      ]
    },
    export: {
      label: '수출 통관 실적', source: 'ERP 엑셀', cycle: '매일', hint: /수출|export/i,
      fields: [
        { key: 'date', label: '신고일자', type: 'date', req: true, aliases: ['수출신고일', '수출신고일자', '수리일자', '선적일자', '신고일', '일자', 'date'] },
        HQ,
        { key: 'country', label: '국가', type: 'text', req: true, aliases: ['목적국', '도착국', '수출국', '국가명', '수입국', 'country', 'destination'] },
        { key: 'company', label: '업체', type: 'text', req: true, aliases: ['업체명', '거래처', '거래처명', '수입자', '바이어', '구매자', 'buyer', 'customer'] },
        HS,
        { key: 'amount', label: '수출금액', type: 'num', req: true, aliases: ['수출액', 'fob금액', '신고금액', '결제금액', '물자대', '금액', 'amount'] },
        FTA_GOODS, SAVING
      ]
    },
    refund: {
      label: '관세환급 실적', source: '환급프로그램 엑셀', cycle: '매월', hint: /환급|refund|drawback/i,
      fields: [
        { key: 'date', label: '환급월', type: 'date', req: true, aliases: ['환급일자', '지급일자', '환급결정일', '결정일자', '환급년월', '년월', '월', '기간', '일자'] },
        HQ,
        { key: 'amount', label: '환급액', type: 'num', req: true, aliases: ['환급금액', '환급금', '관세환급액', '환급세액', '결정금액'] },
        { key: 'count', label: '건수', type: 'num', aliases: ['환급건수', '신청건수', '결정건수'] }
      ]
    },
    errors: {
      label: '수출입 오류점수', source: '관세청 엑셀', cycle: '매월', hint: /오류|error|성실/i,
      fields: [
        { key: 'date', label: '기간', type: 'date', req: true, aliases: ['년월', '월', '대상월', '신고월', '평가월', '일자'] },
        { key: 'kind', label: '구분', type: 'text', aliases: ['수출입구분', '신고구분', '수출입', '업무구분'] },
        { key: 'hq', label: '본부', type: 'text', aliases: HQ.aliases },
        { key: 'decl', label: '신고건수', type: 'num', req: true, aliases: ['신고수', '전체건수', '총신고건수', '신고건'] },
        { key: 'err', label: '오류건수', type: 'num', req: true, aliases: ['오류수', '오류신고건수', '정정건수', '오류건'] },
        { key: 'score', label: '오류점수', type: 'num', req: true, aliases: ['점수', '오류점수합계', '감점', '벌점'] }
      ]
    }
  };
  // (v1.2) 품목분류 사전회신 결정문 현황 — 담당자가 관리하는 엑셀(연번·완제품·품명·결정세번·결정문번호·시행일자·관세율·관세사).
  // 종전세율·연간 수입액 열이 함께 있을 때만 절감 추정을 계산한다. 관세율은 올린 파일의 값을 그대로 보인다(물품설명서 초안에는 여전히 싣지 않는다).
  DATASETS.ruling = {
    label: '품목분류 결정문 현황', source: '결정문 현황 엑셀', cycle: '수시', hint: /결정문|품목분류|사전심사|사전회신|ruling/i,
    fields: [
      { key: 'seq', label: '연번', type: 'text', aliases: ['번호', 'no', '순번'] },
      { key: 'product', label: '완제품', type: 'text', req: true, aliases: ['완제품명', '적용기종', '기종', '장비', '제품', '제품명', 'product'] },
      { key: 'item', label: '품명', type: 'text', req: true, aliases: ['부품명', '물품명', '품목명', 'item', 'description'] },
      { key: 'hs', label: '결정세번', type: 'hs', req: true, aliases: ['결정hs', '결정품목번호', '결정hscode', 'hs', 'hscode', 'hs코드', '세번', '품목번호', 'hsk'] },
      { key: 'docNo', label: '결정문번호', type: 'text', aliases: ['품목분류사전심사결정문번호', '사전심사결정문번호', '결정문', '문서번호', '회신번호', '결정번호'] },
      { key: 'date', label: '시행일자', type: 'date', req: true, aliases: ['시행일', '결정일자', '결정일', '회신일자', '회신일', '일자', 'date'] },
      { key: 'rate', label: '관세율', type: 'rate', aliases: ['결정세율', '결정관세율', '세율', '기본세율', 'rate'] },
      { key: 'broker', label: '관세사', type: 'text', aliases: ['관세법인', '대리인', '신청대리인', '신청인'] },
      { key: 'prevRate', label: '종전세율', type: 'rate', aliases: ['기존세율', '종전관세율', '변경전세율', '이전세율', '신청전세율'] },
      { key: 'goods', label: '연간 수입액', type: 'num', aliases: ['물자대', '수입금액', '연간물자대', '과세가격', '수입액', '연간수입액'] }
    ]
  };
  var KINDS = ['import', 'export', 'refund', 'errors', 'ruling'];
  function fieldsOf(kind) { return DATASETS[kind].fields; }
  function hasField(kind, key) { return fieldsOf(kind).some(function (f) { return f.key === key; }); }

  /* ---------- 열 이름 짝짓기 ---------- */
  // 괄호 속 단위(원)·[KRW] 와 공백·구두점을 지우고 소문자로 맞춘 뒤 비교한다.
  function normKey(s) {
    return String(s == null ? '' : s).replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[\s.·_\-/:()[\]]/g, '').toLowerCase();
  }
  // 이름 점수: 같음 1 · 같은 뜻 낱말과 같음 0.95 · 낱말을 품음 0.6 + 0.3×(낱말 길이 / 열 이름 길이)
  function nameScore(header, field) {
    var h = normKey(header); if (!h) return 0;
    var words = [normKey(field.label)].concat(field.aliases.map(normKey));
    if (h === words[0]) return 1;
    var best = 0;
    words.forEach(function (w, i) {
      if (!w) return;
      if (h === w) best = Math.max(best, i ? 0.95 : 1);
      else if (w.length >= 2 && h.indexOf(w) >= 0) best = Math.max(best, 0.6 + 0.3 * w.length / h.length);
    });
    return best;
  }
  var MIN_SCORE = 0.6;
  // headers: 열 이름 배열. override: { 필드key: 열 이름 | '' (없음) } — 사람이 고른 것이 늘 앞선다.
  // → { map: {key: header}, score: {key: 점수}, missing: [필수인데 못 찾은 label], unused: [쓰지 않은 열] }
  function mapColumns(headers, kind, override) {
    override = override || {};
    var fields = fieldsOf(kind), map = {}, score = {}, used = {};
    fields.forEach(function (f) {
      if (Object.prototype.hasOwnProperty.call(override, f.key)) {
        var o = override[f.key];
        if (o && headers.indexOf(o) >= 0) { map[f.key] = o; score[f.key] = 'user'; used[o] = true; }
        else score[f.key] = 'user-none';
      }
    });
    var cand = [];
    fields.forEach(function (f) {
      if (score[f.key]) return;
      headers.forEach(function (h) { var s = nameScore(h, f); if (s >= MIN_SCORE) cand.push({ f: f.key, h: h, s: s }); });
    });
    cand.sort(function (a, b) { return b.s - a.s; });
    cand.forEach(function (c) { if (!map[c.f] && !score[c.f] && !used[c.h]) { map[c.f] = c.h; score[c.f] = Math.round(c.s * 100) / 100; used[c.h] = true; } });
    return {
      map: map, score: score,
      missing: fields.filter(function (f) { return f.req && !map[f.key]; }).map(function (f) { return f.label; }),
      missingKeys: fields.filter(function (f) { return f.req && !map[f.key]; }).map(function (f) { return f.key; }),
      unused: headers.filter(function (h) { return !used[h] && String(h).trim(); })
    };
  }
  // 머리글 줄 찾기 — ERP 엑셀은 맨 위에 제목·조회 조건 줄이 붙어 나오기도 한다.
  // 처음 10줄 중 어느 종류의 열 이름이든 가장 많이 맞는 줄. 하나도 안 맞으면 첫 줄.
  function findHeaderRow(aoa) {
    var best = 0, bestN = 0;
    (aoa || []).slice(0, 10).forEach(function (row, i) {
      var n = 0;
      (row || []).forEach(function (h) {
        if (typeof h !== 'string' || !h.trim()) return;
        if (KINDS.some(function (k) { return fieldsOf(k).some(function (f) { return nameScore(h, f) >= MIN_SCORE; }); })) n++;
      });
      if (n > bestN) { best = i; bestN = n; }
    });
    return best;
  }
  // 어떤 종류의 파일인가 — 필수 열을 찾은 비율이 가장 높은 종류. 같으면 찾은 열이 많은 쪽, 그다음 파일 이름.
  function detectKind(headers, fileName) {
    var ranked = KINDS.map(function (k) {
      var m = mapColumns(headers, k), req = fieldsOf(k).filter(function (f) { return f.req; }).length;
      var found = Object.keys(m.map).length;
      return { kind: k, ratio: (req - m.missing.length) / req, found: found, name: DATASETS[k].hint.test(fileName || '') ? 1 : 0 };
    }).sort(function (a, b) { return b.ratio - a.ratio || b.found - a.found || b.name - a.name; });
    var top = ranked[0];
    return { kind: top.ratio >= 0.5 ? top.kind : null, ratio: top.ratio, ranked: ranked };
  }

  /* ---------- 값 읽기 ---------- */
  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  // 숫자: 1,234 · (1,234)=음수 · ₩·원·KRW·USD 표기 · 빈칸/「-」= null(빈 값) · 읽지 못하면 NaN
  function parseNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = clean(v); if (!s || /^[-–—]$/.test(s)) return null;
    var neg = /^\(.*\)$/.test(s) || /^△|^▲/.test(s);
    s = s.replace(/^\(|\)$/g, '').replace(/^[△▲]/, '').replace(/[,\s]|원|₩|krw|usd|\$/gi, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    var n = Number(s); return neg ? -Math.abs(n) : n;
  }
  // 관세율: 「8」·「8%」·「0」·「FCN0」(협정세율 부호 + 세율) → { rate, code }. 빈칸은 null, 읽지 못하면 undefined.
  function parseRate(v) {
    if (typeof v === 'number') return isFinite(v) ? { rate: v, code: '' } : undefined;
    var s = clean(v); if (!s || /^[-–—]$/.test(s)) return null;
    var m = s.match(/^([A-Za-z]{0,6})\s*(\d+(?:\.\d+)?)\s*%?$/);
    if (!m) return undefined;
    return { rate: Number(m[2]), code: m[1].toUpperCase() };
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function mkDate(y, m, d) {
    if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12)) return null;
    if (d != null && !(d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate())) return null;
    return { y: y, m: m, d: d == null ? null : d, month: y + '-' + pad2(m), date: d == null ? null : y + '-' + pad2(m) + '-' + pad2(d) };
  }
  // 날짜: 2025-01-15 · 2025.1.15 · 2025/01 · 20250115 · 202501 · 2025년 1월 · 엑셀 날짜 일련번호 · Date
  function parseDate(v) {
    if (v instanceof Date) return isNaN(v) ? null : mkDate(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      if (v >= 19900101 && v <= 21001231 && v % 1 === 0) return mkDate(Math.floor(v / 10000), Math.floor(v / 100) % 100, v % 100);
      if (v >= 199001 && v <= 210012 && v % 1 === 0) return mkDate(Math.floor(v / 100), v % 100, null);
      if (v >= 20000 && v < 80000) { var t = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000); return mkDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
      return null;
    }
    var s = clean(v); if (!s) return null;
    var m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*(?:[-./월]\s*(?:(\d{1,2})\s*일?)?)?/);
    if (m) return mkDate(+m[1], +m[2], m[3] ? +m[3] : null);
    m = s.match(/^(\d{4})(\d{2})(\d{2})?$/);
    if (m) return mkDate(+m[1], +m[2], m[3] ? +m[3] : null);
    if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s));
    return null;
  }
  // HS 4단위(호): 점 앞이 3자리면 앞의 0 이 빠진 것(402.10 → 0402). 점이 없고 자리수가 홀수(5·7·9)여도
  // 엑셀이 앞의 0 을 지운 것으로 본다. 류 01~97(77 제외)이 아니면 null.
  function hs4(v) {
    var s = clean(v); if (!s) return null;
    var head = s.split(/[.\s-]/)[0].replace(/\D/g, ''), digits = s.replace(/\D/g, '');
    var four;
    if (/[.\s-]/.test(s) && head.length >= 3 && head.length <= 4) four = (head.length === 3 ? '0' + head : head);
    else {
      if (digits.length % 2 === 1 && digits.length >= 5) digits = '0' + digits;
      if (digits.length < 4) return null;
      four = digits.slice(0, 4);
    }
    var ch = +four.slice(0, 2);
    return ch >= 1 && ch <= 97 && ch !== 77 ? four : null;
  }
  var TOTAL_RE = /^(합\s*계|소\s*계|총\s*계|누\s*계|total|subtotal)$/i;

  // rows: 엑셀 한 시트의 객체 배열(sheet_to_json). → { records, skipped:[{row, reason}], issues:[문장], blanks:{label: 칸 수}, period }
  // row 번호는 엑셀 줄 번호(머리글 1줄 + 1부터)다.
  // offset = 머리글 위에 있던 줄 수(제목 줄 등) — 엑셀 줄 번호를 맞추려고 쓴다.
  function normalize(rows, kind, map, offset) {
    var fields = fieldsOf(kind), recs = [], skipped = [], blanks = {}, bad = {}, badRows = {};
    (rows || []).forEach(function (r, i) {
      var row = i + 2 + (offset || 0), vals = fields.map(function (f) { return map[f.key] ? r[map[f.key]] : undefined; });
      if (vals.every(function (x) { return clean(x) === ''; })) return;                       // 완전히 빈 줄
      var text = fields.filter(function (f) { return f.type === 'text' && map[f.key]; }).map(function (f) { return clean(r[map[f.key]]); });
      var firstCells = Object.keys(r).slice(0, 3).map(function (k) { return clean(r[k]); });
      if (text.concat(firstCells).some(function (t) { return TOTAL_RE.test(t); })) { skipped.push({ row: row, reason: '합계·소계 줄' }); return; }
      var rec = { row: row };
      var ok = true;
      fields.forEach(function (f) {
        if (!map[f.key]) return;
        var raw = r[map[f.key]];
        if (f.type === 'date') {
          var d = parseDate(raw);
          if (!d) { ok = false; skipped.push({ row: row, reason: clean(raw) ? f.label + '을(를) 날짜로 읽지 못함: ' + clean(raw) : f.label + ' 빈칸' }); return; }
          rec.date = d.date; rec.month = d.month; rec.year = d.y;
        } else if (f.type === 'num') {
          var n = parseNum(raw);
          if (n === null) { blanks[f.label] = (blanks[f.label] || 0) + 1; rec[f.key] = null; }
          else if (isNaN(n)) { bad[f.label] = (bad[f.label] || 0) + 1; (badRows[f.label] = badRows[f.label] || []).push(row); rec[f.key] = null; }
          else rec[f.key] = n;
        } else if (f.type === 'rate') {
          var rt = parseRate(raw);
          if (rt === undefined) { bad[f.label] = (bad[f.label] || 0) + 1; (badRows[f.label] = badRows[f.label] || []).push(row); rec[f.key] = null; }
          else if (rt === null) { blanks[f.label] = (blanks[f.label] || 0) + 1; rec[f.key] = null; }
          else { rec[f.key] = rt.rate; if (rt.code) rec[f.key + 'Code'] = rt.code; }
        } else if (f.type === 'hs') {
          rec.hs = clean(raw); rec.hs4 = hs4(raw) || '(HS 미상)';
          if (rec.hs4 === '(HS 미상)') bad['HS 4단위'] = (bad['HS 4단위'] || 0) + 1;
        } else rec[f.key] = clean(raw) || '(미기재)';
      });
      if (ok) recs.push(rec);
    });
    var issues = [];
    Object.keys(bad).forEach(function (k) {
      issues.push(k + ' 값 ' + bad[k] + '칸을 읽지 못했습니다' + (badRows[k] ? '(엑셀 ' + badRows[k].slice(0, 5).join('·') + '행' + (badRows[k].length > 5 ? ' 외' : '') + ')' : '') + ' — 집계에서 뺍니다.');
    });
    // 필수 금액 칸의 빈칸만 알린다. FTA·절감액 같은 선택 칸은 비어 있는 것이 보통이다(FTA 미적용).
    fields.forEach(function (f) { if (f.req && blanks[f.label]) issues.push(f.label + ' 빈칸 ' + blanks[f.label] + '칸 — 0 으로 채우지 않고 비워 둔 채 더합니다.'); });
    if (skipped.length) issues.push('건너뛴 줄 ' + skipped.length + '개(합계 줄·날짜 없음)');
    return { records: recs, skipped: skipped, issues: issues, blanks: blanks, period: periodOf(recs) };
  }

  /* ---------- 기간 ---------- */
  function periodOf(recs) {
    var ms = recs.map(function (r) { return r.month; }).filter(Boolean).sort();
    return ms.length ? { from: ms[0], to: ms[ms.length - 1] } : null;
  }
  function shiftMonth(m, k) {
    var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k;
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    return y + '-' + pad2(mo + 1);
  }
  function monthsBetween(from, to) { var out = []; for (var m = from; m <= to && out.length < 600; m = shiftMonth(m, 1)) out.push(m); return out; }
  // 여러 데이터의 기간을 합친다
  function unionPeriod(periods) {
    var p = periods.filter(Boolean); if (!p.length) return null;
    return { from: p.map(function (x) { return x.from; }).sort()[0], to: p.map(function (x) { return x.to; }).sort().pop() };
  }
  // 기본 조회 기간 = 마지막 달이 든 해의 1월(데이터가 그보다 늦게 시작하면 그 달) ~ 마지막 달
  function defaultRange(period) {
    if (!period) return null;
    var from = period.to.slice(0, 4) + '-01';
    return { from: from < period.from ? period.from : from, to: period.to };
  }
  // 전년 동기 = 같은 달 수만큼 12개월 앞. 12개월을 넘게 고르면 두 기간이 겹친다(overlap).
  function prevRange(range) {
    return { from: shiftMonth(range.from, -12), to: shiftMonth(range.to, -12), overlap: monthsBetween(range.from, range.to).length > 12 };
  }

  /* ---------- 거르기 ---------- */
  // f = { from, to, hq, country }. 그 열이 없는 데이터(예: 환급에는 국가가 없다)는 그 조건을 걸지 않고 ignored 로 알린다.
  function applyFilter(recs, kind, f) {
    f = f || {};
    var ignored = [];
    var useHq = f.hq && hasField(kind, 'hq'), useCo = f.country && hasField(kind, 'country');
    if (f.hq && !useHq) ignored.push('본부');
    if (f.country && !useCo) ignored.push('국가');
    var out = recs.filter(function (r) {
      if (f.from && r.month < f.from) return false;
      if (f.to && r.month > f.to) return false;
      if (useHq && r.hq !== f.hq) return false;
      if (useCo && r.country !== f.country) return false;
      return true;
    });
    return { records: out, ignored: ignored };
  }
  function valuesOf(recs, key) {
    var s = {}; recs.forEach(function (r) { if (r[key] != null) s[r[key]] = true; });
    return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }

  /* ---------- 계산 ---------- */
  // 빈 값(null)은 더하지 않는다. 하나도 없으면 null.
  function sum(recs, key) {
    var t = 0, n = 0;
    recs.forEach(function (r) { if (r[key] != null && isFinite(r[key])) { t += r[key]; n++; } });
    return n ? t : null;
  }
  function ratio(a, b) { return a == null || b == null || b === 0 ? null : a / b; }
  function change(cur, prev) { return { cur: cur, prev: prev, diff: cur == null && prev == null ? null : (cur || 0) - (prev || 0), rate: ratio((cur || 0) - (prev || 0), prev) }; }
  // 묶어 더하기 → [{ key, n, sums:{m: 합} }] — 첫 측정값 큰 순, 같으면 이름 순
  function group(recs, by, measures) {
    var g = {};
    recs.forEach(function (r) {
      var k = r[by] == null ? '(미기재)' : r[by];
      var o = g[k] || (g[k] = { key: k, n: 0, rows: [] });
      o.n++; o.rows.push(r);
    });
    return Object.keys(g).map(function (k) {
      var o = g[k], sums = {}; measures.forEach(function (m) { sums[m] = sum(o.rows, m); });
      return { key: k, n: o.n, sums: sums };
    }).sort(function (a, b) { return (b.sums[measures[0]] || 0) - (a.sums[measures[0]] || 0) || String(a.key).localeCompare(String(b.key), 'ko'); });
  }
  function byMonth(recs, months, measures) {
    var idx = {}; months.forEach(function (m, i) { idx[m] = i; });
    var out = months.map(function (m) { var o = { month: m, n: 0 }; measures.forEach(function (k) { o[k] = null; }); return o; });
    recs.forEach(function (r) {
      var o = out[idx[r.month]]; if (!o) return; o.n++;
      measures.forEach(function (k) { if (r[k] != null) o[k] = (o[k] || 0) + r[k]; });
    });
    return out;
  }
  function inRange(recs, range) { return recs.filter(function (r) { return r.month >= range.from && r.month <= range.to; }); }

  var BY = { hq: '본부', country: '국가', company: '업체', hs4: 'HS 4단위', kind: '구분' };

  // 수입: 물자대 · 관세 · 관세부담율(=관세 ÷ 물자대)
  function importStats(recs, range, by) {
    var cur = inRange(recs, range), goods = sum(cur, 'goods'), duty = sum(cur, 'duty');
    return {
      range: range, n: cur.length, goods: goods, duty: duty, burden: ratio(duty, goods),
      groups: group(cur, by || 'hq', ['goods', 'duty']).map(function (g) { return { key: g.key, n: g.n, goods: g.sums.goods, duty: g.sums.duty, burden: ratio(g.sums.duty, g.sums.goods) }; }),
      monthly: byMonth(cur, monthsBetween(range.from, range.to), ['goods', 'duty']).map(function (m) { m.burden = ratio(m.duty, m.goods); return m; })
    };
  }
  // 수출: 수출금액과 전년 동기 대비 증감(금액·비율). 전년에만 있던 묶음도 남긴다(올해 0).
  function exportStats(recs, range, by) {
    by = by || 'hq';
    var pr = prevRange(range), cur = inRange(recs, range), prev = inRange(recs, pr);
    var gc = {}, gp = {};
    group(cur, by, ['amount']).forEach(function (g) { gc[g.key] = g; });
    group(prev, by, ['amount']).forEach(function (g) { gp[g.key] = g; });
    var keys = Object.keys(gc).concat(Object.keys(gp).filter(function (k) { return !gc[k]; }));
    var groups = keys.map(function (k) {
      var c = gc[k] ? gc[k].sums.amount : null, p = gp[k] ? gp[k].sums.amount : null, ch = change(c, p);
      return { key: k, n: gc[k] ? gc[k].n : 0, amount: c, prev: p, diff: ch.diff, rate: ch.rate };
    }).sort(function (a, b) { return (b.amount || 0) - (a.amount || 0) || (b.prev || 0) - (a.prev || 0); });
    var months = monthsBetween(range.from, range.to);
    var mc = byMonth(cur, months, ['amount']), mp = byMonth(prev, months.map(function (m) { return shiftMonth(m, -12); }), ['amount']);
    var tot = change(sum(cur, 'amount'), sum(prev, 'amount'));
    return {
      range: range, prevRange: pr, n: cur.length, amount: tot.cur, prev: tot.prev, diff: tot.diff, rate: tot.rate,
      hasPrev: prev.length > 0, groups: groups,
      monthly: months.map(function (m, i) { return { month: m, amount: mc[i].amount, prev: mp[i].amount }; })
    };
  }
  // FTA: 물자대 · 물자대_FTA · 활용률(=물자대_FTA ÷ 물자대) · 절감액. 수입은 goods, 수출은 amount 가 물자대다.
  function ftaStats(recs, kind, range, by, map) {
    var base = kind === 'import' ? 'goods' : 'amount';
    var available = !map || !!map.ftaGoods, cur = inRange(recs, range);
    // 물자대_FTA 열이 있으면 빈칸은 「FTA 미적용」이라 0 으로 본다. 열이 없으면 값을 지어내지 않는다(null).
    var hasSaving = !map || !!map.saving;
    function z(v, on) { return v == null && on ? 0 : v; }
    var goods = sum(cur, base), fg = z(sum(cur, 'ftaGoods'), available && cur.length), sv = z(sum(cur, 'saving'), hasSaving && cur.length);
    return {
      kind: kind, available: available, hasSaving: hasSaving, range: range, n: cur.length,
      goods: goods, ftaGoods: fg, util: ratio(fg, goods), saving: sv,
      groups: group(cur, by || 'hq', [base, 'ftaGoods', 'saving']).map(function (g) {
        var gf = z(g.sums.ftaGoods, available);
        return { key: g.key, n: g.n, goods: g.sums[base], ftaGoods: gf, util: ratio(gf, g.sums[base]), saving: z(g.sums.saving, hasSaving) };
      }),
      monthly: byMonth(cur, monthsBetween(range.from, range.to), [base, 'ftaGoods', 'saving']).map(function (m) {
        var mf = z(m.ftaGoods, available && m.n);
        return { month: m.month, goods: m[base], ftaGoods: mf, util: ratio(mf, m[base]), saving: z(m.saving, hasSaving && m.n) };
      })
    };
  }
  // 환급: 본부 × 월 표(행 합계·열 합계), 월 평균은 데이터가 있는 달 수로 나눈다
  function refundStats(recs, range) {
    var cur = inRange(recs, range), months = monthsBetween(range.from, range.to);
    var monthly = byMonth(cur, months, ['amount', 'count']);
    var filled = monthly.filter(function (m) { return m.amount != null; });
    var hqs = group(cur, 'hq', ['amount', 'count']);
    var pivot = hqs.map(function (g) {
      var rows = cur.filter(function (r) { return r.hq === g.key; });
      return { hq: g.key, total: g.sums.amount, count: g.sums.count, months: byMonth(rows, months, ['amount']).map(function (m) { return m.amount; }) };
    });
    var total = sum(cur, 'amount');
    return {
      range: range, months: months, n: cur.length, amount: total, count: sum(cur, 'count'),
      monthAvg: filled.length ? total / filled.length : null, monthsWithData: filled.length,
      last: filled.length ? filled[filled.length - 1] : null, monthly: monthly, pivot: pivot
    };
  }
  // 오류: 신고건수 · 오류건수 · 오류 비율(=오류건수 ÷ 신고건수) · 오류점수
  function errorStats(recs, range, by) {
    var cur = inRange(recs, range), decl = sum(cur, 'decl'), err = sum(cur, 'err');
    function row(o) { return { decl: o.decl, err: o.err, rate: ratio(o.err, o.decl), score: o.score }; }
    return {
      range: range, n: cur.length, decl: decl, err: err, rate: ratio(err, decl), score: sum(cur, 'score'),
      groups: group(cur, by || 'kind', ['decl', 'err', 'score']).map(function (g) { var o = row(g.sums); o.key = g.key; o.n = g.n; return o; }),
      monthly: byMonth(cur, monthsBetween(range.from, range.to), ['decl', 'err', 'score']).map(function (m) { var o = row(m); o.month = m.month; return o; })
    };
  }
  // (v1.2) 결정문: 건수 · 관세율 0 결정 건수와 비율 · 종전보다 낮아진 건 · 절감 추정(연간 수입액 × (종전세율 − 결정세율), 세 값이 다 있을 때만)
  // · 묶음별(완제품·관세사·HS 4단위) · 월별 시행 건수 · 세율별 분포 · 목록(최근 시행 순)
  var RULING_BY = { product: '완제품', broker: '관세사', hs4: 'HS 4단위' };
  function rulingStats(recs, range, by) {
    by = RULING_BY[by] ? by : 'product';
    var cur = inRange(recs, range), months = monthsBetween(range.from, range.to);
    var zero = cur.filter(function (r) { return r.rate === 0; }).length;
    var withPrev = cur.filter(function (r) { return r.rate != null && r.prevRate != null; });
    var lowered = withPrev.filter(function (r) { return r.rate < r.prevRate; }).length;
    var canSave = withPrev.filter(function (r) { return r.goods != null; });
    var saving = canSave.length ? canSave.reduce(function (t, r) { return t + r.goods * (r.prevRate - r.rate) / 100; }, 0) : null;
    var g = {};
    cur.forEach(function (r) {
      var k = r[by] == null ? '(미기재)' : r[by], o = g[k] || (g[k] = { key: k, n: 0, zero: 0, saving: null });
      o.n++; if (r.rate === 0) o.zero++;
      if (r.goods != null && r.rate != null && r.prevRate != null) o.saving = (o.saving || 0) + r.goods * (r.prevRate - r.rate) / 100;
    });
    var groups = Object.keys(g).map(function (k) { var o = g[k]; o.zeroRate = ratio(o.zero, o.n); return o; })
      .sort(function (a, b) { return b.n - a.n || String(a.key).localeCompare(String(b.key), 'ko'); });
    var rates = {};
    cur.forEach(function (r) { var k = r.rate == null ? '(미기재)' : (r.rateCode ? r.rateCode + ' ' : '') + r.rate + '%'; rates[k] = (rates[k] || 0) + 1; });
    var list = cur.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return {
      range: range, months: months, by: by, byLabel: RULING_BY[by], n: cur.length, zero: zero, zeroRate: ratio(zero, cur.length),
      withPrev: withPrev.length, lowered: lowered, saving: saving, savingN: canSave.length,
      products: valuesOf(cur, 'product').length, brokers: valuesOf(cur, 'broker').length,
      latest: list.length ? list[0] : null, groups: groups, monthly: byMonth(cur, months, []),
      rates: Object.keys(rates).map(function (k) { return { key: k, n: rates[k] }; }).sort(function (a, b) { return b.n - a.n; }), list: list
    };
  }
  function topN(groups, n) {
    if (groups.length <= n) return { rows: groups, rest: null };
    var rest = groups.slice(n), keys = Object.keys(rest[0]).filter(function (k) { return k !== 'key' && typeof rest[0][k] !== 'object'; });
    var o = { key: '그 밖 ' + rest.length + '개', n: 0 };
    ['n', 'goods', 'duty', 'amount', 'prev', 'ftaGoods', 'saving', 'decl', 'err', 'score'].forEach(function (k) {
      if (keys.indexOf(k) < 0) return;
      var t = null; rest.forEach(function (r) { if (r[k] != null) t = (t || 0) + r[k]; }); o[k] = t;
    });
    if ('burden' in rest[0]) o.burden = ratio(o.duty, o.goods);
    if ('util' in rest[0]) o.util = ratio(o.ftaGoods, o.goods);
    if ('rate' in rest[0] && 'prev' in rest[0]) { var c = change(o.amount, o.prev); o.diff = c.diff; o.rate = c.rate; }
    else if ('rate' in rest[0]) o.rate = ratio(o.err, o.decl);
    return { rows: groups.slice(0, n), rest: o };
  }

  /* ---------- 표기 ---------- */
  function fmtNum(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    var s = Math.abs(v).toFixed(dp || 0).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '-' : '') + s.join('.');
  }
  function fmtPct(v, dp) { return v == null || !isFinite(v) ? '—' : fmtNum(v * 100, dp == null ? 1 : dp) + '%'; }
  function fmtSigned(v, dp) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + fmtNum(v, dp); }
  function fmtSignedPct(v) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + fmtPct(v); }
  // 원 단위일 때만 억·만으로 줄여 쓴다(다른 단위면 그대로).
  function fmtShort(v, unit) {
    if (v == null || !isFinite(v)) return '—';
    if (unit && unit !== '원') return fmtNum(v) + ' ' + unit;
    var a = Math.abs(v), sg = v < 0 ? '-' : '';
    if (a >= 1e8) return sg + fmtNum(a / 1e8, a >= 1e10 ? 0 : 1) + '억원';
    if (a >= 1e4) return sg + fmtNum(a / 1e4, 0) + '만원';
    return fmtNum(v) + '원';
  }
  function monthLabel(m) { return m ? m.slice(0, 4) + '.' + m.slice(5, 7) : ''; }

  /* ---------- 엑셀 표(탭별 집계 시트) ---------- */
  // ctx = { range, filter:{hq,country}, unit, data:{kind:{file, uploadedAt, period, records, map, skipped}} }
  // → [{ name, aoa }]. 화면은 이 표를 그대로 SheetJS 로 쓴다.
  function exportBook(ctx) {
    var out = [], d = ctx.data || {}, range = ctx.range, unit = ctx.unit || '원';
    var info = [['수출입통관 업무 대시보드 — 집계 내보내기'], ['조회 기간', monthLabel(range.from) + ' ~ ' + monthLabel(range.to)],
      ['전년 동기', monthLabel(prevRange(range).from) + ' ~ ' + monthLabel(prevRange(range).to)],
      ['본부 조건', (ctx.filter && ctx.filter.hq) || '전체'], ['국가 조건', (ctx.filter && ctx.filter.country) || '전체'], ['금액 단위', unit], [],
      ['데이터', '파일', '올린 날짜', '데이터 기간', '읽은 줄', '건너뛴 줄']];
    KINDS.forEach(function (k) {
      var x = d[k]; if (!x) return;
      info.push([DATASETS[k].label, x.file || '', x.uploadedAt || '', x.period ? monthLabel(x.period.from) + ' ~ ' + monthLabel(x.period.to) : '', x.records.length, (x.skipped || []).length]);
    });
    info.push([], ['계산식', '관세부담율 = 관세 ÷ 물자대 · FTA 활용률 = 물자대_FTA ÷ 물자대 · 오류 비율 = 오류건수 ÷ 신고건수 · 증감률 = (올해 − 전년 동기) ÷ 전년 동기'],
      ['', '나누는 값이 0 이거나 비면 비워 둡니다. 빈 금액은 0 으로 더하지 않습니다.']);
    out.push({ name: '안내', aoa: info });
    function f(rec, k) { return rec && rec[k] != null && isFinite(rec[k]) ? rec[k] : ''; }
    function pct(v) { return v == null ? '' : Math.round(v * 10000) / 100; }
    function filt(k) { return applyFilter(d[k].records, k, ctx.filter).records; }
    ['hq', 'country', 'company', 'hs4'].forEach(function (by) {
      if (d.import) {
        var s = importStats(filt('import'), range, by);
        out.push({ name: '수입_' + BY[by].replace(/\s/g, ''), aoa: [[BY[by], '건수', '물자대', '관세', '관세부담율(%)']].concat(s.groups.map(function (g) { return [g.key, g.n, f(g, 'goods'), f(g, 'duty'), pct(g.burden)]; }), [['합계', s.n, f(s, 'goods'), f(s, 'duty'), pct(s.burden)]]) });
      }
      if (d.export) {
        var e = exportStats(filt('export'), range, by);
        out.push({ name: '수출_' + BY[by].replace(/\s/g, ''), aoa: [[BY[by], '건수', '수출금액', '전년 동기', '증감', '증감률(%)']].concat(e.groups.map(function (g) { return [g.key, g.n, f(g, 'amount'), f(g, 'prev'), f(g, 'diff'), pct(g.rate)]; }), [['합계', e.n, f(e, 'amount'), f(e, 'prev'), f(e, 'diff'), pct(e.rate)]]) });
      }
    });
    ['import', 'export'].forEach(function (k) {
      if (!d[k]) return;
      ['hq', 'country'].forEach(function (by) {
        var s = ftaStats(filt(k), k, range, by, d[k].map);
        out.push({ name: 'FTA_' + (k === 'import' ? '수입' : '수출') + '_' + BY[by], aoa: [[BY[by], '물자대', '물자대_FTA', 'FTA 활용률(%)', '절감액']].concat(s.groups.map(function (g) { return [g.key, f(g, 'goods'), f(g, 'ftaGoods'), pct(g.util), f(g, 'saving')]; }), [['합계', f(s, 'goods'), f(s, 'ftaGoods'), pct(s.util), f(s, 'saving')]]) });
      });
    });
    if (d.refund) {
      var r = refundStats(filt('refund'), range);
      out.push({ name: '환급_본부월', aoa: [['본부'].concat(r.months.map(monthLabel), ['합계'])].concat(r.pivot.map(function (p) { return [p.hq].concat(p.months.map(function (v) { return v == null ? '' : v; }), [f(p, 'total')]); }),
        [['합계'].concat(r.monthly.map(function (m) { return m.amount == null ? '' : m.amount; }), [f(r, 'amount')])]) });
    }
    if (d.errors) {
      var er = errorStats(filt('errors'), range, 'kind');
      out.push({ name: '오류_월', aoa: [['월', '신고건수', '오류건수', '오류 비율(%)', '오류점수']].concat(er.monthly.map(function (m) { return [monthLabel(m.month), f(m, 'decl'), f(m, 'err'), pct(m.rate), f(m, 'score')]; }), [['합계', f(er, 'decl'), f(er, 'err'), pct(er.rate), f(er, 'score')]]) });
      out.push({ name: '오류_구분', aoa: [['구분', '신고건수', '오류건수', '오류 비율(%)', '오류점수']].concat(er.groups.map(function (g) { return [g.key, f(g, 'decl'), f(g, 'err'), pct(g.rate), f(g, 'score')]; })) });
    }
    if (d.ruling) {
      ['product', 'broker', 'hs4'].forEach(function (by) {
        var rs = rulingStats(filt('ruling'), range, by);
        out.push({ name: '결정문_' + RULING_BY[by].replace(/\s/g, ''), aoa: [[RULING_BY[by], '결정 건수', '관세율 0% 건수', '0% 비율(%)', '절감 추정']].concat(rs.groups.map(function (g) { return [g.key, g.n, g.zero, pct(g.zeroRate), f(g, 'saving')]; }), [['합계', rs.n, rs.zero, pct(rs.zeroRate), f(rs, 'saving')]]) });
      });
      var rl = rulingStats(filt('ruling'), range, 'product');
      out.push({ name: '결정문_목록', aoa: [['시행일자', '완제품', '품명', '결정세번', '결정문번호', '관세율', '종전세율', '관세사', '연간 수입액', '절감 추정']].concat(rl.list.map(function (r) {
        return [r.date, r.product, r.item, r.hs, r.docNo || '', r.rate == null ? '' : (r.rateCode ? r.rateCode + ' ' : '') + r.rate, r.prevRate == null ? '' : r.prevRate, r.broker || '', f(r, 'goods'), r.goods != null && r.rate != null && r.prevRate != null ? r.goods * (r.prevRate - r.rate) / 100 : ''];
      })) });
    }
    return out;
  }

  /* ---------- 자료 목록(⑦ 통관 서식·업무 매뉴얼) ---------- */
  // 파일 자체는 저장하지 않는다. 이름·설명·분류·사내 위치(링크/경로)만 이 브라우저에 둔다.
  var LIB_CATEGORIES = ['사유서', '업무 매뉴얼', '통관 서식', 'FTA', '관세환급', '기타'];
  var LIB_FIELDS = [
    { key: 'name', label: '파일 이름', aliases: ['파일명', '이름', '자료명', '제목', 'name', 'file'] },
    { key: 'category', label: '분류', aliases: ['구분', '종류', 'category'] },
    { key: 'desc', label: '설명', aliases: ['내용', '비고', '메모', 'description'] },
    { key: 'location', label: '사내 위치', aliases: ['위치', '경로', '링크', '주소', '저장위치', 'url', 'path', 'link'] },
    { key: 'owner', label: '담당', aliases: ['담당자', '등록자', '작성자'] }
  ];
  function libLocationKind(loc) {
    var s = clean(loc); if (!s) return 'none';
    if (/^https?:\/\/\S+$/i.test(s)) return 'url';
    if (/^(\\\\|[a-z]:\\|\/|file:)/i.test(s)) return 'path';
    return 'text';
  }
  function libValidate(e, list) {
    var errs = [], name = clean(e && e.name);
    if (!name) errs.push('파일 이름을 적어 주세요.');
    if (name.length > 120) errs.push('파일 이름이 너무 깁니다(120자 이내).');
    if (/^https?:\/\/\S*\s/i.test(clean(e && e.location))) errs.push('링크 주소에 빈칸이 있습니다.');
    var cat = clean(e && e.category) || '기타';
    if (name && (list || []).some(function (x) { return x.id !== (e && e.id) && clean(x.name) === name && x.category === cat; })) errs.push('같은 분류에 같은 이름이 이미 있습니다.');
    return errs;
  }
  function libEntry(e, now, seq) {
    return { id: e.id || ('L' + String(now || '').replace(/\D/g, '').slice(0, 14) + '-' + (seq || 0)), name: clean(e.name), category: clean(e.category) || '기타',
      desc: clean(e.desc), location: clean(e.location), owner: clean(e.owner), added: e.added || String(now || '').slice(0, 10) };
  }
  // → { list, errors } — 틀린 항목이면 list 를 바꾸지 않는다
  function libAdd(list, e, now) {
    list = list || [];
    var errs = libValidate(e, list); if (errs.length) return { list: list, errors: errs };
    var seq = list.length + 1, ent = libEntry(e, now, seq);
    while (!e.id && list.some(function (x) { return x.id === ent.id; })) ent = libEntry(e, now, ++seq);
    return { list: list.concat([ent]), errors: [] };
  }
  function libRemove(list, id) { return (list || []).filter(function (x) { return x.id !== id; }); }
  function libSearch(list, q, cat) {
    var words = clean(q).toLowerCase().split(' ').filter(Boolean);
    return (list || []).filter(function (x) {
      if (cat && x.category !== cat) return false;
      var hay = [x.name, x.desc, x.location, x.category, x.owner].join(' ').toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }
  function libCounts(list) { var c = {}; (list || []).forEach(function (x) { c[x.category] = (c[x.category] || 0) + 1; }); return c; }
  function libToAoa(list) { return [LIB_FIELDS.map(function (f) { return f.label; }).concat(['등록일'])].concat((list || []).map(function (x) { return [x.name, x.category, x.desc, x.location, x.owner, x.added]; })); }
  // 엑셀에서 되읽기(다른 PC 로 목록 옮기기). 열 이름은 같은 뜻 낱말로 찾는다.
  function libFromRows(rows, list, now) {
    var head = rows && rows.length ? Object.keys(rows[0]) : [], m = {};
    LIB_FIELDS.forEach(function (f) { head.forEach(function (h) { if (!m[f.key] && nameScore(h, f) >= 0.95) m[f.key] = h; }); });
    var added = 0, errors = [];
    list = list || [];
    (rows || []).forEach(function (r, i) {
      var e = {}; LIB_FIELDS.forEach(function (f) { e[f.key] = m[f.key] ? r[m[f.key]] : ''; });
      if (!clean(e.name)) return;
      var res = libAdd(list, e, now);
      if (res.errors.length) errors.push((i + 2) + '행: ' + res.errors.join(' ')); else { list = res.list; added++; }
    });
    return { list: list, added: added, errors: errors, mapped: m };
  }
  function libSample() {
    return [
      { name: '수입 신고 정정 사유서 양식(예시).xlsx', category: '사유서', desc: '수입신고 정정·취하 때 내는 사유서 양식', location: '\\\\fileserver\\통관\\서식\\사유서_예시.xlsx', owner: '통관 담당(예시)' },
      { name: 'FTA 원산지 확인 업무 매뉴얼(예시).pptx', category: 'FTA', desc: '원산지 증명서 확인 순서와 보관 기준', location: 'https://intranet.example.com/customs/fta-manual', owner: 'FTA 담당(예시)' },
      { name: '관세환급 신청 절차(예시).pptx', category: '관세환급', desc: '소요량 계산과 환급 신청 순서', location: '\\\\fileserver\\통관\\매뉴얼\\환급_예시.pptx', owner: '환급 담당(예시)' }
    ];
  }

  /* ---------- 예제 — 가짜 ERP·환급·오류 엑셀 4종(실제 사내 데이터가 아닙니다) ---------- */
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  var S_HQ = ['건설기계본부(가상)', '엔진본부(가상)', '산업차량본부(가상)', '부품사업본부(가상)'];
  var S_IMP_CO = [['가람정밀(가상)', '중국'], ['한빛유압(가상)', '일본'], ['새솔산업(가상)', '독일'], ['누리베어링(가상)', '일본'], ['미르전장(가상)', '베트남'], ['다온주물(가상)', '인도'], ['솔빛고무(가상)', '중국'], ['라온기어(가상)', '이탈리아']];
  var S_EXP_CO = [['가상건설상사(미국)', '미국'], ['가상중장비(브라질)', '브라질'], ['가상기계무역(인니)', '인도네시아'], ['가상엔지니어링(호주)', '호주'], ['가상머신(독일)', '독일'], ['가상트레이딩(사우디)', '사우디아라비아']];
  var S_HS_IMP = ['8431.49-9090', '8482.10-0000', '8413.60-9000', '4009.42-0000', '8483.40-1000', '7325.99-0000', '8544.42-9000'];
  var S_HS_EXP = ['8429.52-1000', '8408.20-9000', '8427.20-1000', '8431.49-9090'];
  var S_DUTY = { '8431': 0.08, '8482': 0.08, '8413': 0.05, '4009': 0.08, '8483': 0.08, '7325': 0.03, '8544': 0.08 };   // 가짜 값 — 예제 관세액을 만드는 데만 씀
  var FTA_IMP = { '독일': 1, '이탈리아': 1, '베트남': 1, '인도': 1, '중국': 1 };
  var FTA_EXP = { '미국': 1, '호주': 1, '독일': 1, '인도네시아': 1 };
  function sampleMonths() { return monthsBetween('2024-01', '2025-10'); }
  function sampleFiles() {
    var R = rng(20261103), months = sampleMonths(), r100 = function (v) { return Math.round(v / 100) * 100; };
    var imp = [['수리일자', '사업본부', '원산지국', '거래처명', 'HS부호', '물자대(원)', '관세액', 'FTA물자대', 'FTA절감액']];
    months.forEach(function (m, mi) {
      for (var i = 0; i < 10; i++) {
        var co = S_IMP_CO[Math.floor(R() * S_IMP_CO.length)], hs = S_HS_IMP[Math.floor(R() * S_HS_IMP.length)];
        var goods = r100((40 + R() * 260) * 1e6 * (1 + mi * 0.01)), rate = S_DUTY[hs.slice(0, 4)];
        var fta = FTA_IMP[co[1]] && R() < 0.7 ? goods : 0;
        var day = 1 + Math.floor(R() * 28), date = m + '-' + pad2(day);
        imp.push([i === 3 ? date.replace(/-/g, '.') : date, S_HQ[Math.floor(R() * S_HQ.length)], co[1], co[0], hs, goods,
          i === 7 && mi === 5 ? '' : Math.round((goods - fta) * rate), fta || '', fta ? Math.round(fta * rate) : '']);
      }
    });
    imp.push(['합계', '', '', '', '', '', '', '', '']);
    var exp = [['수출신고일', '본부', '목적국', '거래처', 'HS CODE', '수출금액', '물자대_FTA', '절감액']];
    months.forEach(function (m, mi) {
      var n = mi >= 12 ? 9 : 8;
      for (var i = 0; i < n; i++) {
        var co = S_EXP_CO[Math.floor(R() * S_EXP_CO.length)];
        if (mi < 12 && co[1] === '사우디아라비아') co = S_EXP_CO[Math.floor(R() * 5)];          // 사우디 거래는 2025년에 새로 생김
        var amt = r100((300 + R() * 900) * 1e6), fta = FTA_EXP[co[1]] && R() < 0.8 ? amt : 0;
        exp.push([m + '-' + pad2(1 + Math.floor(R() * 28)), S_HQ[Math.floor(R() * 3)], co[1], co[0], S_HS_EXP[Math.floor(R() * S_HS_EXP.length)], amt, fta || '', fta ? Math.round(fta * 0.05) : '']);
      }
    });
    var ref = [['환급년월', '본부', '환급금액', '환급건수']];
    months.forEach(function (m) { S_HQ.forEach(function (h, hi) { ref.push([m, h, r100((20 + R() * 80) * 1e6 / (hi + 1)), 5 + Math.floor(R() * 30)]); }); });
    var err = [['년월', '수출입구분', '신고건수', '오류건수', '오류점수']];
    months.forEach(function (m) {
      ['수입', '수출'].forEach(function (k) {
        var d = k === '수입' ? 380 + Math.floor(R() * 120) : 210 + Math.floor(R() * 80), e = Math.floor(R() * 9);
        err.push([m.replace('-', '년 ') + '월', k, d, e, e * (2 + Math.floor(R() * 3))]);
      });
    });
    // (v1.2) 결정문 현황 — 가짜 부품 24건. 종전세율·연간 수입액 열은 예제에만 있다(실제 관리 파일에는 없을 수 있다 → 절감 추정은 「—」).
    var rul = [['연번', '완제품', '품명', '결정세번', '품목분류사전심사결정문번호', '시행일자', '관세율', '관세사', '종전세율', '연간 수입액(원)']];
    var R_ITEMS = ['BLOCK ASSY(가상)', 'WIPER ARM(가상)', 'BELT,SEAT(가상)', 'HORN(가상)', 'DRUM UPPER(가상)', 'PIPE(가상)', 'SPLIT FLANGE(가상)', 'PARKING BRAKE(가상)', 'PEDAL ASSY(가상)', 'PIN(가상)', 'BRACKET(가상)', 'COVER(가상)'];
    var R_HS = [['8431.49-9000', '0'], ['8479.89-9099', '8'], ['8431.43-0000', '0'], ['8512.30-0000', '8'], ['7304.31-0000', '0'], ['7326.90-9000', '8'], ['9401.99-1000', 'FCN0'], ['8481.20-1000', '8']];
    var R_PROD = ['EXCAVATOR', 'EXCAVATOR', 'Wheel Loader', '천공기'], R_BROKER = ['가상관세법인 A', '가상관세법인 B'];
    for (var ri = 0; ri < 24; ri++) {
      var mi2 = 2 + Math.floor(R() * (months.length - 2)), hsr = R_HS[Math.floor(R() * R_HS.length)];
      rul.push([ri + 1, R_PROD[Math.floor(R() * R_PROD.length)], R_ITEMS[ri % R_ITEMS.length], hsr[0], '품목분류' + (1 + Math.floor(R() * 4)) + '과-' + (1000 + Math.floor(R() * 4000)) + '(가상)',
        months[mi2] + '-' + pad2(1 + Math.floor(R() * 28)), hsr[1], R_BROKER[Math.floor(R() * 2)], 8, r100((20 + R() * 300) * 1e6)]);
    }
    return [
      { name: '예제_수입통관실적_ERP.xlsx', kind: 'import', aoa: imp },
      { name: '예제_수출통관실적_ERP.xlsx', kind: 'export', aoa: exp },
      { name: '예제_관세환급실적.xlsx', kind: 'refund', aoa: ref },
      { name: '예제_수출입오류점수.xlsx', kind: 'errors', aoa: err },
      { name: '예제_품목분류결정문현황.xlsx', kind: 'ruling', aoa: rul }
    ];
  }
  // 표(첫 줄 머리글) → sheet_to_json 과 같은 객체 배열
  function aoaToRows(aoa) {
    var head = aoa[0].map(function (h, i) { return clean(h) || ('열' + (i + 1)); });
    return aoa.slice(1).map(function (r) { var o = {}; head.forEach(function (h, i) { o[h] = r[i] == null ? '' : r[i]; }); return o; });
  }

  var api = {
    DATASETS: DATASETS, KINDS: KINDS, BY: BY, LIB_CATEGORIES: LIB_CATEGORIES, LIB_FIELDS: LIB_FIELDS,
    normKey: normKey, nameScore: nameScore, mapColumns: mapColumns, findHeaderRow: findHeaderRow, detectKind: detectKind, hasField: hasField,
    parseNum: parseNum, parseDate: parseDate, hs4: hs4, normalize: normalize,
    periodOf: periodOf, unionPeriod: unionPeriod, shiftMonth: shiftMonth, monthsBetween: monthsBetween, defaultRange: defaultRange, prevRange: prevRange,
    applyFilter: applyFilter, valuesOf: valuesOf, sum: sum, ratio: ratio, change: change, group: group, byMonth: byMonth, topN: topN,
    importStats: importStats, exportStats: exportStats, ftaStats: ftaStats, refundStats: refundStats, errorStats: errorStats,
    parseRate: parseRate, rulingStats: rulingStats, RULING_BY: RULING_BY,
    fmtNum: fmtNum, fmtPct: fmtPct, fmtSigned: fmtSigned, fmtSignedPct: fmtSignedPct, fmtShort: fmtShort, monthLabel: monthLabel,
    exportBook: exportBook,
    libValidate: libValidate, libAdd: libAdd, libRemove: libRemove, libSearch: libSearch, libCounts: libCounts, libToAoa: libToAoa,
    libFromRows: libFromRows, libSample: libSample, libLocationKind: libLocationKind,
    sampleFiles: sampleFiles, aoaToRows: aoaToRows
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Customs = api;
})(this);
