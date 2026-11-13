/* 브라우저에 실제로 띄워 화면이 그려지는지 본다 — node test/smoke.browser.js
 * 규칙 테스트가 다 통과해도 app.js 오타 하나면 빈 화면이 된다. playwright 가 없으면 건너뛴다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다.'); process.exit(0); }
var ROOT = path.join(__dirname, '..');
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
var srv = http.createServer(function (q, s) {
  var p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, function (e, b) { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
});
var passed = 0, failed = 0, v10 = null, v11 = null;
function ok(c, label, d) { if (c) passed++; else { failed++; console.log('  X ' + label + (d ? '  ' + d : '')); } }
srv.listen(0, async function () {
  var base = 'http://127.0.0.1:' + srv.address().port + '/';
  var br = await chromium.launch(); var pg = await br.newPage({ viewport: { width: 1280, height: 900 } });
  var errs = []; pg.on('pageerror', function (e) { errs.push(e.message); });
  var outbound = []; pg.on('request', function (r) { if (!r.url().startsWith(base) && !r.url().startsWith('https://api.openai.com/') && !r.url().startsWith('https://unipass.customs.go.kr:38010/')) outbound.push(r.url()); });
  try {
    await pg.goto(base);
    ok(await pg.isHidden('#s-draft'), '처음에는 초안 영역이 닫혀 있다');
    await pg.click('#btn-sample');
    await pg.waitForSelector('#items tr.pick', { timeout: 5000 });
    ok(await pg.isVisible('#s-draft'), '초안 영역이 열린다');
    ok(await pg.$$eval('#items tr.pick', function (t) { return t.length; }) === 3, '예제 3건 목록');
    ok(await pg.$$eval('#items tr.flag', function (t) { return t.length; }) === 1, '누락 있는 1건 표시');
    ok(await pg.$$eval('#sections textarea.sec-t', function (t) { return t.length; }) === 5, '다섯 칸 초안(v1.2 양식 2~6절)');
    var op = await pg.inputValue('#sections textarea[data-sec="opinion"]');
    ok(/후보 1: 8431\.49/.test(op) && /최종 품목분류는 담당자/.test(op), '품목분류 의견에 후보와 담당자 판단 문구', op.slice(0, 80));
    await pg.click('#items tr.flag');
    ok(/제조공정/.test(await pg.textContent('#check')), '누락 건을 누르면 누락 항목이 보인다');
    ok(/\[확인 필요: 제조공정\]/.test(await pg.inputValue('#sections textarea[data-sec="composition"]')), '초안에 빈칸 표시');
    // 문체 — 개조식 사례를 넣으면 …임 으로 바뀐다
    await pg.evaluate(function () { document.querySelectorAll('details.box').forEach(function (d) { d.open = true; }); });
    await pg.click('#btn-ex-sample');
    var st = await pg.inputValue('#sections textarea[data-sec="structure"]');
    ok(/임\./.test(st) && !/니다/.test(st), '사례 문체(…임)를 따른다', st.slice(0, 60));
    // 칸 이름 바꾸기
    await pg.fill('#labels input[data-l="opinion"]', '세번 검토 의견');
    await pg.dispatchEvent('#labels input[data-l="opinion"]', 'change');
    ok(/세번 검토 의견/.test(await pg.textContent('#sections')), '바꾼 칸 이름이 초안에 쓰인다');
    // AI 는 확인 전에는 못 누른다
    await pg.fill('#ai-key', 'test-key');
    ok(await pg.isDisabled('#btn-ai'), '보안 확인 전에는 AI 단추가 꺼져 있다');
    // AI 응답은 가짜로 돌려준다(실제 호출 없음) — 세율이 섞인 답이 걸러지고, 반영해야 들어가는지
    await pg.route('https://api.openai.com/**', function (r) {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content:
        '{"sections":{"structure":"다듬은 구조 문장임.","opinion":"관세율은 8%임. 후보 검토 필요."},"missing":["호스 내압"],"notes":""}' } }] }) });
    });
    await pg.check('#ai-agree');
    ok(!(await pg.isDisabled('#btn-ai')), '확인하면 AI 단추가 켜진다');
    await pg.click('#btn-ai');
    await pg.waitForSelector('#ai-out .ai-box', { timeout: 5000 });
    var aiText = await pg.textContent('#ai-out');
    ok(/AI 초안 — 검토 필요/.test(aiText) && /호스 내압/.test(aiText), 'AI 답은 검토 필요 표시와 함께 따로 보인다');
    ok(!/8%/.test(aiText), 'AI 답의 세율 수치는 지운다');
    ok(!/다듬은 구조 문장/.test(await pg.inputValue('#sections textarea[data-sec="structure"]')), '반영 전에는 초안이 그대로다');
    await pg.click('#ai-out [data-apply="structure"]');
    ok(/다듬은 구조 문장/.test(await pg.inputValue('#sections textarea[data-sec="structure"]')), '반영하면 그 칸에 들어간다');
    // 인쇄용 양식
    await pg.click('#btn-preview');
    ok(await pg.$$eval('#preview article.doc', function (t) { return t.length; }) === 3, '인쇄용 양식 3건');
    ok(/세번 검토 의견/.test(await pg.textContent('#preview')), '인쇄용 양식에도 바꾼 칸 이름');
    var dl = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#btn-xlsx')]);
    ok(/물품설명서_초안_.*\.xlsx$/.test(dl[0].suggestedFilename()), '엑셀 내보내기', dl[0].suggestedFilename());
    // 360px 가로 넘침
    await pg.setViewportSize({ width: 360, height: 800 });
    var over = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(over <= 0, '360px 에서 가로 넘침 없음', over);
    await pg.evaluate(function () { localStorage.clear(); });
    await pg.goto(base + 'guide.html');
    ok(/칸 이름/.test(await pg.textContent('main')), '사용법 페이지');

    /* ===================== v1.1 수출입통관통합관리 DashBoard ===================== */
    v10 = passed + failed;
    var XLSX = require('../lib/xlsx.full.min.js');
    ok(/대시보드/.test(await pg.textContent('#g-dash')), '사용법에 대시보드 절');
    await pg.goto(base + 'index.html');
    ok(await pg.isVisible('#go-dash-sample'), '첫 화면에 예제 대시보드 바로 가기');
    await pg.click('#go-dash-sample');
    await pg.waitForSelector('#kpi-trade .kpi[data-k="imp-goods"]', { timeout: 5000 });
    ok(/dashboard\.html#example$/.test(pg.url()), '대시보드로 이동해 예제를 연다');
    ok(await pg.$$eval('#d-sets tr[data-kind]', function (t) { return t.length; }) === 5, '올린 자료 5종(v1.2 결정문 포함)');
    ok(/2024\.01 ~ 2025\.10/.test(await pg.textContent('#d-sets tr[data-kind="import"]')), '데이터 기간 표시');
    // 화면 숫자 = 엔진 계산(하드코딩 없음) — 같은 예제를 엔진으로 다시 계산해 대조한다
    function expect(f) {
      return pg.evaluate(function (fx) {
        var C = Customs, d = {};
        C.sampleFiles().forEach(function (x) { var m = C.mapColumns(x.aoa[0].map(String), x.kind).map; d[x.kind] = C.normalize(C.aoaToRows(x.aoa), x.kind, m).records; });
        var r = { from: '2025-01', to: '2025-10' };
        function F(k) { return C.applyFilter(d[k], k, fx).records; }
        var is = C.importStats(F('import'), r, 'hq'), es = C.exportStats(F('export'), r, 'hq'), fs = C.ftaStats(F('import'), 'import', r, 'hq'), xs = C.errorStats(F('errors'), r, 'kind'), rs = C.refundStats(F('refund'), r);
        return { goods: C.fmtShort(is.goods, '원'), burden: C.fmtPct(is.burden, 2), rate: C.fmtSignedPct(es.rate), util: C.fmtPct(fs.util), err: C.fmtPct(xs.rate, 2), refund: C.fmtShort(rs.amount, '원'), hqs: is.groups.length };
      }, f || {});
    }
    var kv = function (k) { return pg.textContent('.kpi[data-k="' + k + '"] .kpi-v'); };
    var ex = await expect();
    ok(await kv('imp-goods') === ex.goods && await kv('imp-burden') === ex.burden, '수입 물자대·관세부담율 카드 = 엔진 계산', ex.goods + ' ' + ex.burden);
    ok(await kv('exp-rate') === ex.rate && /[+-]\d/.test(ex.rate), '수출 전년 동기 대비 카드 = 엔진 계산', ex.rate);
    ok(/계산: 관세 ÷ 물자대/.test(await pg.textContent('.kpi[data-k="imp-burden"]')), '계산한 값은 계산식 표시');
    ok(await pg.$$eval('#ch-trade svg.chart', function (t) { return t.length; }) === 4, '수출입 실적 그래프 4개');
    ok(await pg.$$eval('#ch-trade svg.chart rect[fill="#154b6e"]', function (t) { return t.length; }) > 10, '막대가 그려진다');
    ok(await pg.$$eval('table.trade-imp tbody tr:not(.sum)', function (t) { return t.length; }) === ex.hqs, '수입 본부별 표 = 본부 수');
    await pg.selectOption('#by-trade', 'hs4');
    var hsKeys = await pg.$$eval('table.trade-imp tbody tr:not(.sum) td:first-child', function (t) { return t.map(function (x) { return x.textContent; }); });
    ok(hsKeys.length > 0 && hsKeys.every(function (t) { return /^\d{4}$/.test(t); }), 'HS 4단위로 묶기', hsKeys.join(','));
    ok(/HS 4단위/.test(await pg.textContent('#tb-trade')), '묶는 기준이 표 제목에');
    var hq1 = await pg.$eval('#f-hq option:nth-child(2)', function (o) { return o.value; });
    await pg.selectOption('#f-hq', hq1);
    var exh = await expect({ hq: hq1 });
    ok(await kv('imp-goods') === exh.goods && exh.goods !== ex.goods, '본부 거르기 → 카드가 그 본부 값으로', hq1 + ' ' + exh.goods);
    await pg.selectOption('#f-hq', '');
    await pg.click('.tab[data-tab="fta"]');
    ok(await pg.isVisible('#t-fta') && await pg.isHidden('#t-trade'), 'FTA 탭');
    ok(await kv('import-util') === ex.util, 'FTA 활용률 카드 = 엔진 계산', ex.util);
    ok(/\d/.test(await kv('export-saving')), '수출 FTA 절감액 카드');
    ok(await pg.$$eval('#ch-fta svg.chart', function (t) { return t.length; }) === 3 && await pg.$('table.fta-import') && await pg.$('table.fta-export'), 'FTA 그래프 3개·표 2개');
    await pg.click('.tab[data-tab="refund"]');
    ok(await kv('ref-amount') === ex.refund, '관세환급 합계 카드 = 엔진 계산', ex.refund);
    ok(await pg.$$eval('table.refund-pivot thead th', function (t) { return t.length; }) === 12, '본부 × 월 표(본부 + 10개월 + 합계)');
    await pg.click('.tab[data-tab="errors"]');
    ok(await kv('err-rate') === ex.err, '오류 비율 카드 = 엔진 계산', ex.err);
    ok(await pg.$$eval('#ch-errors svg.chart polyline', function (t) { return t.length; }) >= 2, '오류 비율 선(수입·수출)');
    await pg.selectOption('#f-from', '2024-01');
    ok(/겹칩니다/.test(await pg.textContent('#f-note')), '12개월을 넘게 고르면 겹침 알림');
    await pg.click('#btn-f-reset');
    ok(/2025\.01 ~ 2025\.10/.test(await pg.textContent('#f-note')), '기간 처음대로');
    var dl = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#btn-dash-xlsx')]);
    var wbx = XLSX.read(fs.readFileSync(await dl[0].path()), { type: 'buffer' });
    ok(/수출입통관_집계_202501-202510\.xlsx$/.test(dl[0].suggestedFilename()), '엑셀 내려받기', dl[0].suggestedFilename());
    ok(['안내', '수입_본부', '수출_국가', '수입_HS4단위', 'FTA_수입_본부', 'FTA_수출_국가', '환급_본부월', '오류_월'].every(function (n) { return wbx.SheetNames.indexOf(n) >= 0; }), '엑셀 탭별 집계 시트', wbx.SheetNames.join(','));
    // 열 이름이 다른 파일 — 못 찾은 열을 사람이 고른다
    function xbuf(aoa) { var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S'); return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })); }
    await pg.setInputFiles('#d-file', { name: '수입실적_오늘.xlsx', mimeType: 'application/octet-stream', buffer: xbuf([['일자', '조직', '나라', '업체', 'HS', '금액', '관세'], ['2025-10-01', '가', '중국', '갑', '8431.49', 1000, 80], ['2025-10-02', '나', '일본', '을', '8482.10', 3000, 90]]) });
    await pg.waitForSelector('#d-sets tr[data-kind="import"].flag', { timeout: 5000 });
    ok(/못 찾은 열 2/.test(await pg.textContent('#d-sets tr[data-kind="import"]')), '못 찾은 열 2개 표시');
    ok(/이전 파일을 새 파일로 바꿈/.test(await pg.textContent('#d-msg')), '같은 종류를 다시 올리면 갱신');
    await pg.click('.tab[data-tab="fta"]');
    ok(/자료 없음/.test(await pg.textContent('#kpi-fta')), '열을 고르기 전에는 수입 집계를 하지 않는다');
    await pg.selectOption('select[data-map="import"][data-f="hq"]', '조직');
    await pg.selectOption('select[data-map="import"][data-f="country"]', '나라');
    ok(/필수 열 모두 찾음/.test(await pg.textContent('#d-sets tr[data-kind="import"]')), '열을 고르면 채워진다');
    await pg.click('.tab[data-tab="trade"]');
    ok(await kv('imp-goods') === '4,000원' && await kv('imp-burden') === '4.25%', '고른 열로 다시 계산(4,000원 · 170/4,000)');
    await pg.setInputFiles('#d-file', { name: '무엇.xlsx', mimeType: 'application/octet-stream', buffer: xbuf([['가', '나', '다'], [1, 2, 3]]) });
    await pg.waitForSelector('select[data-pending="0"]', { timeout: 5000 });
    ok(true, '모르는 파일은 종류를 고르게 한다');
    await pg.click('[data-drop-pending="0"]');
    ok(!(await pg.$('select[data-pending]')), '모르는 파일 빼기');
    // 다시 열면 이 브라우저에 기억한 데이터로
    await pg.goto(base + 'dashboard.html');
    await pg.waitForSelector('#kpi-trade .kpi[data-k="imp-goods"]', { timeout: 5000 });
    ok(/기억한 데이터/.test(await pg.textContent('#d-msg')) && await kv('imp-goods') === '4,000원', '다시 열면 기억한 데이터와 고른 열을 불러온다');
    await pg.click('#btn-dash-clear');
    ok(await pg.isHidden('#d-view'), '저장된 데이터 지우기');
    // 실제 samples/ 엑셀 4종 올리기 — 수입 파일은 맨 위 제목 2줄을 건너뛰고 머리글을 찾는다
    var sdir = path.join(ROOT, 'samples');
    await pg.setInputFiles('#d-file', fs.readdirSync(sdir).filter(function (n) { return /\.xlsx$/.test(n); }).map(function (n) { return path.join(sdir, n); }));
    await pg.waitForSelector('#d-sets tr[data-kind="errors"]', { timeout: 5000 });
    var impRow = await pg.$$eval('#d-sets tr[data-kind="import"] td', function (t) { return t.map(function (x) { return x.textContent; }); });
    ok(impRow[4] === '220' && impRow[5] === '1', 'samples/ 수입 파일 220줄 · 합계 줄 1개 건너뜀', impRow.join('|'));
    ok(await pg.$$eval('#d-sets tr[data-kind].flag', function (t) { return t.length; }) === 0 && await kv('imp-goods') === ex.goods, 'samples/ 4종이 예제와 같은 값', await kv('imp-goods'));
    await pg.setViewportSize({ width: 360, height: 800 });
    for (var tb of ['trade', 'fta', 'refund', 'errors']) {
      await pg.click('.tab[data-tab="' + tb + '"]');
      var ov = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
      ok(ov <= 0, '360px 대시보드 ' + tb + ' 탭 가로 넘침 없음', ov);
    }
    await pg.setViewportSize({ width: 1280, height: 900 });
    // 자료 목록
    await pg.goto(base + 'library.html');
    await pg.click('#btn-lib-add');
    ok(/파일 이름을 적어/.test(await pg.textContent('#l-msg')), '이름 없이 등록하면 알린다');
    await pg.fill('#l-name', '수출 정정 사유서.xlsx'); await pg.selectOption('#l-cat', '사유서'); await pg.fill('#l-loc', '\\\\fs\\통관\\사유서.xlsx'); await pg.fill('#l-desc', '수출신고 정정 때 씀');
    await pg.click('#btn-lib-add');
    ok(await pg.$$eval('table.lib tbody tr', function (t) { return t.length; }) === 1, '자료 등록 1건');
    ok(!!(await pg.$('table.lib [data-copy]')), '공유 폴더 경로는 복사 단추');
    await pg.reload();
    ok(await pg.$$eval('table.lib tbody tr', function (t) { return t.length; }) === 1, '등록하자마자 이 브라우저에 기억한다(다시 열어도 1건)');
    await pg.click('#btn-lib-sample');
    ok(await pg.$$eval('table.lib tbody tr', function (t) { return t.length; }) === 4, '예시 3건 더하기');
    ok(!!(await pg.$('table.lib a[href^="https://"]')), '사내 링크는 링크로');
    await pg.fill('#l-q', '정정');
    ok(await pg.$$eval('table.lib tbody tr', function (t) { return t.length; }) === 2, '찾기');
    await pg.fill('#l-q', '');
    await pg.click('#l-cats button[data-cat="FTA"]');
    ok(await pg.$$eval('table.lib tbody tr', function (t) { return t.length; }) === 1, '분류로 거르기');
    await pg.reload();
    ok(await pg.$$eval('table.lib tbody tr', function (t) { return t.length; }) === 4, '다시 열어도 목록이 남는다');
    var dl2 = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#btn-lib-xlsx')]);
    var lw = XLSX.read(fs.readFileSync(await dl2[0].path()), { type: 'buffer' });
    ok(XLSX.utils.sheet_to_json(lw.Sheets['자료목록']).length === 4, '자료 목록 엑셀 4건');
    await pg.click('table.lib tbody tr:first-child [data-del]');
    ok(await pg.$$eval('table.lib tbody tr', function (t) { return t.length; }) === 3, '지우기');
    await pg.setInputFiles('#l-import', { name: 'list.xlsx', mimeType: 'application/octet-stream', buffer: fs.readFileSync(await dl2[0].path()) });
    await pg.waitForFunction(function () { return /불러왔습니다/.test(document.getElementById('l-msg').textContent); }, null, { timeout: 5000 });
    ok(await pg.$$eval('table.lib tbody tr', function (t) { return t.length; }) === 4, '엑셀에서 불러오기(겹치는 3건은 넘김)');
    await pg.setViewportSize({ width: 360, height: 800 });
    var ovl = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(ovl <= 0, '360px 자료 목록 가로 넘침 없음', ovl);
    await pg.evaluate(function () { localStorage.clear(); });

    /* ===================== v1.2 양식 6절 · 결정문 탭 · 화물 추적 ===================== */
    v11 = passed + failed;
    await pg.goto(base + 'index.html'); await pg.click('#btn-sample'); await pg.waitForSelector('#items tr.pick', { timeout: 5000 });
    ok(/제출서류 목록/.test(await pg.textContent('#sections')), '제출서류 목록 칸 이름');
    await pg.click('#btn-preview');
    var pv = await pg.textContent('#preview');
    ok(/1\. 품명/.test(pv) && /5\. 제출서류 목록/.test(pv) && /6\. 품목분류 의견/.test(pv), '인쇄 양식 1~6절 번호');
    ok(!!(await pg.$('a[href="tracking.html"]')), '상단 메뉴에 화물 추적');
    // 대시보드 — 7항목 표 · 결정문 탭
    await pg.goto(base + 'dashboard.html#example'); await pg.waitForSelector('#kpi-trade .kpi[data-k="imp-goods"]', { timeout: 5000 });
    ok(await pg.$$eval('#d-map table.map7 tbody tr', function (t) { return t.length; }) === 7, '업무 7항목 표');
    ok(await kv('imp-goods') === ex.goods, '결정문 예제를 더해도 수입 카드 값은 그대로(기간 2025-01~2025-10)', await kv('imp-goods'));
    await pg.click('.tab[data-tab="ruling"]');
    ok(await pg.isVisible('#t-ruling') && await pg.isHidden('#t-trade'), '품목분류 결정문 탭');
    var exr = await pg.evaluate(function () {
      var C = Customs, x = C.sampleFiles()[4], m = C.mapColumns(x.aoa[0].map(String), 'ruling').map, n = C.normalize(C.aoaToRows(x.aoa), 'ruling', m).records;
      var s = C.rulingStats(n, { from: '2025-01', to: '2025-10' }, 'product');
      return { n: C.fmtNum(s.n), zero: C.fmtNum(s.zero) + '건', saving: C.fmtShort(s.saving, '원'), g: s.groups.length, list: s.list.length };
    });
    ok(await kv('rul-n') === exr.n && await kv('rul-zero') === exr.zero, '결정문 건수 · 0% 카드 = 엔진 계산', exr.n + ' ' + exr.zero);
    ok(await kv('rul-saving') === exr.saving && /연간 수입액 × \(종전세율 − 결정세율\)/.test(await pg.textContent('.kpi[data-k="rul-saving"]')), '절감 추정 카드 = 엔진 계산 + 계산식', exr.saving);
    ok(await pg.$$eval('table.ruling-by tbody tr:not(.sum)', function (t) { return t.length; }) === exr.g, '완제품별 표 = 완제품 수');
    ok(await pg.$$eval('table.ruling-list tbody tr', function (t) { return t.length; }) === exr.list, '결정문 목록 = 기간 안 건수');
    ok(await pg.$$eval('#ch-ruling svg.chart', function (t) { return t.length; }) === 2, '결정문 그래프 2개');
    await pg.selectOption('#by-ruling', 'broker');
    ok(/관세사별/.test(await pg.textContent('#tb-ruling')), '관세사별로 묶기');
    var dl3 = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#btn-dash-xlsx')]);
    var wb3 = XLSX.read(fs.readFileSync(await dl3[0].path()), { type: 'buffer' });
    ok(['결정문_완제품', '결정문_관세사', '결정문_목록'].every(function (n) { return wb3.SheetNames.indexOf(n) >= 0; }), '결정문 엑셀 시트', wb3.SheetNames.join(','));
    await pg.evaluate(function () { localStorage.clear(); });
    // 화물 추적
    await pg.goto(base + 'tracking.html');
    ok(/등록한 BL 이 없습니다/.test(await pg.textContent('#t-list')), '처음엔 빈 목록');
    await pg.click('#btn-add');
    ok(/BL 번호를 적어/.test(await pg.textContent('#t-msg')), 'BL 없이 등록하면 알린다');
    await pg.fill('#f-bl', 'test-001'); await pg.fill('#f-req-email', 'req@example.com'); await pg.fill('#f-brk-name', '가상관세사'); await pg.fill('#f-brk-email', 'brk@example.com');
    await pg.click('#btn-add');
    ok(await pg.$$eval('table.ships tbody tr', function (t) { return t.length; }) === 1 && /TEST001/.test(await pg.textContent('table.ships')), '등록 1건(BL 정규화 TEST001)');
    await pg.reload();
    ok(await pg.$$eval('table.ships tbody tr', function (t) { return t.length; }) === 1, '다시 열어도 목록이 남는다');
    await pg.click('#btn-xml-sample'); await pg.waitForSelector('#btn-xml-apply', { timeout: 5000 });
    ok(await pg.$$eval('#t-xml-out tbody tr', function (t) { return t.length; }) === 2, 'XML 단계 2건 미리보기');
    await pg.click('#btn-xml-apply');
    var xm = await pg.textContent('#t-xml-msg');
    ok(/새 단계 2건/.test(xm) && /새로 등록한 BL 1건/.test(xm), 'XML 반영 — 새 BL 자동 등록', xm);
    ok(await pg.$$eval('table.ships tbody tr', function (t) { return t.length; }) === 2, '목록 2건');
    ok(await pg.$$eval('.alert-box', function (t) { return t.length; }) === 1 && /입항보고 제출/.test(await pg.textContent('.alert-box h3')), '입항보고 제출 알림 1건');
    ok(/메일 주소가 없습니다/.test(await pg.textContent('.alert-box')), '메일 주소 없는 BL 은 알린다');
    await pg.click('#btn-xlsx-sample'); await pg.waitForSelector('#btn-xlsx-apply', { timeout: 5000 });
    ok(!(await pg.isDisabled('#btn-xlsx-apply')), '예제 엑셀 열 모두 찾음');
    await pg.click('#btn-xlsx-apply');
    var xs2 = await pg.textContent('#t-xlsx-msg');
    ok(/새 단계 2건/.test(xs2) && /이미 있던 단계 1건/.test(xs2), '엑셀 반영 — 같은 단계는 넘김', xs2);
    ok(await pg.$$eval('.alert-box', function (t) { return t.length; }) === 3, '알림 3건');
    ok(await pg.$$eval('.alert-box .tag.ah-t', function (t) { return t.length; }) >= 1 && await pg.$$eval('table.ships .tag.ah-t', function (t) { return t.length; }) >= 1, '시간 외 표시(알림 · 현황)');
    ok(await pg.$$eval('table.ships .chip.done', function (t) { return t.length; }) >= 4, '진행 단계 동그라미');
    await pg.click('.alert-box .al-done');
    ok(await pg.$$eval('.alert-box', function (t) { return t.length; }) === 2, '통보하면 알림에서 빠진다');
    await pg.reload();
    ok(await pg.$$eval('.alert-box', function (t) { return t.length; }) === 2, '통보 기록도 남는다');
    await pg.click('[data-target="unload"]');
    ok(await pg.$$eval('.alert-box', function (t) { return t.length; }) === 3, '하선신고도 대상으로 하면 알림이 는다');
    await pg.click('[data-target="unload"]');
    await pg.fill('#t-sender', '통관담당 테스트'); await pg.dispatchEvent('#t-sender', 'change');
    ok(/통관담당 테스트 드림/.test(await pg.inputValue('.alert-box .al-body')), '보낸 사람이 초안에 들어간다');
    ok(/^mailto:/.test(await pg.getAttribute('.alert-box .al-mailto', 'href')), '메일 앱 링크(mailto)');
    await pg.setInputFiles('#t-file', { name: '진행.xlsx', mimeType: 'application/octet-stream', buffer: xbuf([['번호', '상태', '시각'], ['TEST001', '수입신고', '2026-11-04 10:00']]) });
    await pg.waitForSelector('#t-xlsx-map select[data-xmap="bl"]', { timeout: 5000 });
    ok(await pg.isDisabled('#btn-xlsx-apply'), '못 찾은 열이 있으면 반영 못 함');
    await pg.selectOption('#t-xlsx-map select[data-xmap="bl"]', '번호'); await pg.selectOption('#t-xlsx-map select[data-xmap="at"]', '시각');
    ok(!(await pg.isDisabled('#btn-xlsx-apply')), '열을 고르면 반영할 수 있다');
    await pg.click('#btn-xlsx-apply');
    ok(/새 단계 1건/.test(await pg.textContent('#t-xlsx-msg')), '고른 열로 반영');
    // OpenAPI — 가짜 응답(실제 호출 없음)
    await pg.route('https://unipass.customs.go.kr:38010/**', function (r) { r.fulfill({ status: 200, contentType: 'text/xml', body: '<r><cargCsclPrgsInfoDtlQryVo><prcsDttm>20261104113000</prcsDttm><cargTrcnRelaBsopTpcd>수입신고 수리</cargTrcnRelaBsopTpcd></cargCsclPrgsInfoDtlQryVo></r>' }); });
    await pg.click('#btn-api');
    ok(/인증키를 넣어/.test(await pg.textContent('#api-msg')), '키 없이 조회하면 알린다');
    await pg.fill('#api-key', 'TESTKEY123'); await pg.selectOption('#api-bl', 'TEST001'); await pg.click('#btn-api');
    await pg.waitForFunction(function () { return /새 단계/.test(document.getElementById('api-msg').textContent); }, null, { timeout: 5000 });
    ok(/새 단계 1건/.test(await pg.textContent('#api-msg')), 'OpenAPI 응답을 반영');
    ok(!/TESTKEY123/.test(await pg.textContent('#api-msg')), '화면에 키가 보이지 않는다');
    var dl4 = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#btn-track-xlsx')]);
    var wb4 = XLSX.read(fs.readFileSync(await dl4[0].path()), { type: 'buffer' });
    ok(wb4.SheetNames.join(',') === '현황,진행단계,알림' && XLSX.utils.sheet_to_json(wb4.Sheets['현황']).length === 3, '추적 엑셀 3시트 · 현황 3건', wb4.SheetNames.join(','));
    ok(JSON.stringify(wb4).indexOf('TESTKEY123') < 0, '엑셀에 키 없음');
    await pg.setViewportSize({ width: 360, height: 800 });
    var ovt = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(ovt <= 0, '360px 화물 추적 가로 넘침 없음', ovt);
    await pg.setViewportSize({ width: 1280, height: 900 });
    await pg.goto(base + 'guide.html');
    ok(/화물 추적/.test(await pg.textContent('main')) && /결정문/.test(await pg.textContent('main')), '사용법에 화물 추적 · 결정문 절');
    /* ===================== v1.3 오류점수 ===================== */
    await pg.evaluate(function () { localStorage.clear(); });
    await pg.goto(base + 'errors.html');
    ok(await pg.isHidden('#e-view'), '처음엔 현황이 닫혀 있다');
    await pg.click('#e-sample');
    ok(!(await pg.isHidden('#e-view')), '예제로 현황이 열린다');
    ok(/수입/.test(await pg.textContent('#e-msg')) && /수출/.test(await pg.textContent('#e-msg')), '두 권 읽음');
    var ecalc = await pg.evaluate(function () { var s = window.__err.state.summary; return { i: s.total[9].인천.score, u: s.total[9].울산.score }; });
    ok((await pg.textContent('#e-cards')).indexOf(String(ecalc.i)) >= 0, '카드 = 엔진 계산');
    ok(/점수가 다른 칸 2/.test(await pg.textContent('#e-compare')), '대조: 예제의 어긋난 2칸');
    var u0 = ecalc.u;
    await pg.check('#e-brokers input[data-broker="42158"]');
    var u1 = await pg.evaluate(function () { return window.__err.state.summary.total[9].울산.score; });
    ok(u1 > u0, '부호를 울산으로 고르면 다시 나뉜다', u0 + '→' + u1);
    await pg.uncheck('#e-brokers input[data-broker="42158"]');
    await pg.fill('#e-th', '10'); await pg.dispatchEvent('#e-th', 'change');
    ok(/경계 이상 [1-9]/.test(await pg.textContent('#e-quarters')), '경계를 낮추면 경고');
    await pg.fill('#e-th', '300'); await pg.dispatchEvent('#e-th', 'change');
    await pg.selectOption('#e-scope', '울산');
    ok((await pg.$$('#e-items tbody tr')).length > 0, '항목별 범위');
    await pg.fill('#e-ltable input[data-note="reason"]', '테스트 사유'); await pg.dispatchEvent('#e-ltable input[data-note="reason"]', 'change');
    ok(/테스트 사유/.test(await pg.evaluate(function () { return localStorage.getItem('build-2611-07.err.notes'); })), '대장 사유 저장');
    ok(/9월 수출입 오류관리대장/.test(await pg.inputValue('#e-mbody')), '메일 초안');
    await pg.selectOption('#e-mmonth', '8'); ok(/8월 수출입 오류관리대장/.test(await pg.inputValue('#e-mbody')), '월을 바꾸면 초안도');
    var dl5 = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#e-xlsx')]);
    var wb5 = XLSX.read(fs.readFileSync(await dl5[0].path()), { type: 'buffer' });
    ok(wb5.SheetNames.join(',') === '오류점수요약,발생사유및정정내용,분기,항목별,상세', '엑셀 5시트', wb5.SheetNames.join(','));
    ok(JSON.stringify(XLSX.utils.sheet_to_json(wb5.Sheets['발생사유및정정내용'])).indexOf('테스트 사유') >= 0, '엑셀에 적은 사유');
    await pg.setInputFiles('#e-file', { name: '2026년수입오류.xlsx', mimeType: 'application/octet-stream', buffer: xbuf([['No', '신고번호', '오류점수', '항목명', '정정일자'], [1, '4390826000001M', 3, '관세', '2026-10-05']]) });
    await pg.waitForFunction(function () { return /2026년수입오류/.test(document.getElementById('e-msg').textContent); }, null, { timeout: 5000 });
    ok(/10월/.test(await pg.textContent('#e-table')), '시트 이름이 달라도 머리글로 읽는다');
    await pg.setViewportSize({ width: 360, height: 800 });
    var ove = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(ove <= 0, '360px 오류점수 가로 넘침 없음', ove);
    await pg.setViewportSize({ width: 1280, height: 900 });
    await pg.goto(base + 'guide.html');
    ok(/오류점수 분석/.test(await pg.textContent('main')), '사용법에 오류점수 절');
    await pg.evaluate(function () { localStorage.clear(); });
  } catch (e) { failed++; console.log('  X 예외: ' + e.message); }
  ok(!errs.length, '페이지 오류 없음', errs.join(' | '));
  ok(!outbound.length, '외부로 나간 요청 없음', outbound.join(' '));
  await br.close(); srv.close();
  // 끝의 공통 검사 2개(페이지 오류·외부 요청)는 v1.0 몫으로 센다
  if (v10 != null) console.log('v1.0 ' + (v10 + 2) + ' · v1.1 ' + ((v11 || passed + failed) - v10) + ' · v1.2 ' + (v11 ? passed + failed - v11 - 2 : 0) + '개 검사');
  console.log('\n화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
