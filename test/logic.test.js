/* 규칙 고정 — node test/logic.test.js
 * 이 도구의 값어치는 「빠진 것을 빠졌다고 말하고, HS 를 단정하지 않고, 세율을 싣지 않는 것」에 있다.
 * 손으로 정한 기대값과 대조한다. AI 는 부르지 않는다. */
'use strict';
var D = require('../js/engine.js');
var passed = 0, failed = 0;
function ok(c, label, detail) { if (c) passed++; else { failed++; console.log('  X ' + label + (detail ? '\n      ' + detail : '')); } }
function eq(g, w, label) { ok(JSON.stringify(g) === JSON.stringify(w), label, '기대: ' + JSON.stringify(w) + '  실제: ' + JSON.stringify(g)); }
function has(t, s, label) { ok(String(t).indexOf(s) >= 0, label, '「' + s + '」 없음: ' + String(t).slice(0, 160)); }
function not(t, s, label) { ok(String(t).indexOf(s) < 0, label, '「' + s + '」 있음'); }

// 칸 이름
eq(D.mergeLabels({}).opinion, '품목분류 의견', '기본 칸 이름');
eq(D.mergeLabels({ opinion: '  세번 의견 ' }).opinion, '세번 의견', '칸 이름 바꾸기');
eq(D.mergeLabels({ structure: '' }).structure, '구조 및 형태', '빈 칸 이름은 기본값으로(v1.2 양식 6절 이름)');

// 열 이름 별칭
eq(D.fieldOf('부품명'), 'name', '부품명 → 품명');
eq(D.fieldOf('Part No'), 'model', 'Part No → 모델·품번');
eq(D.fieldOf('HS 코드'), 'hs', 'HS 코드 → HS 후보');
eq(D.fieldOf('적용 기종'), 'machine', '적용 기종 → 적용 장비');
eq(D.fieldOf('담당자'), null, '모르는 열');

// 입력 정리 — 빈 줄은 넘기고, 모르는 열은 알린다
var n = D.normalize([{ 부품명: ' 핀 ', 담당자: '홍길동' }, { 부품명: '', 담당자: '' }, { 품명: '부싱', 관리번호: 'K-9' }]);
eq(n.items.length, 2, '빈 줄 제외 2건');
eq(n.items[0].name, '핀', '앞뒤 공백 정리');
eq(n.items[0].id, 'P-01', '관리번호 없으면 붙인다');
eq(n.items[1].id, 'K-9', '관리번호는 입력값 우선');
eq(n.items[1].row, 4, '엑셀 행 번호 기억');
ok(n.issues.some(function (s) { return s.indexOf('「담당자」') >= 0; }), '모르는 열 알림');
ok(D.normalize([]).issues.length === 1, '빈 파일 알림');

// HS 후보
var h = D.parseHS('8431.49, 7325.99 또는 8431499090');
eq(h.list.map(function (c) { return c.display; }), ['8431.49', '7325.99', '8431.49-9090'], 'HS 세 가지 표기 읽기');
eq(h.list[2].level, 'HSK', '10자리는 HSK');
eq(D.parseHS('8431').list[0].level, '호', '4자리는 호');
eq(D.parseHS('84314, 7700.10, 9999.00, 철판').bad, ['84314', '7700.10', '9999.00', '철판'], '자리수·없는 류·글자는 거른다');
eq(D.parseHS('8431.49; 8431.49').list.length, 1, '같은 후보 중복 제거');

// 조사
eq(D.josa('투스', '으로서', '로서'), '투스로서', '받침 없음 → 로서');
eq(D.josa('베어링', '으로서', '로서'), '베어링으로서', '받침 → 으로서');
eq(D.josa('실린더 레일', '으로서', '로서'), '실린더 레일로서', 'ㄹ 받침 → 로서');
eq(D.josa('HX-220', '이', '가'), 'HX-220이', '숫자 0 은 받침(영)');
eq(D.josa('Pin', '이', '가'), 'Pin(이)가', '한글 아님 → 겸용');

// 예제 — 경고 없이 읽히고, 3건 중 1건은 일부러 제조공정이 비어 있다
var smp = D.normalize(D.sample());
eq(smp.issues, [], '예제 경고 없음');
eq(smp.items.length, 3, '예제 3건');
var checks = smp.items.map(D.check);
eq(checks.map(function (c) { return c.ok; }), [true, true, false], '셋째 건만 누락');
eq(checks[2].missing, ['제조공정'], '누락 항목 = 제조공정');
ok(checks[2].warns.some(function (w) { return w.indexOf('하나뿐') >= 0; }), 'HS 후보 1개 경고');
ok(!checks[0].warns.some(function (w) { return w.indexOf('전용·범용') >= 0; }), '전용이라고 적으면 전용 여부 경고 없음');
ok(checks[1].warns.some(function (w) { return w.indexOf('전용·범용') >= 0; }), '전용 여부 미기재 경고');

// 누락 점검 — 필수 9칸
var empty = D.check({ id: 'X' });
eq(empty.missing.length, 9, '빈 부품은 필수 9칸 누락');
eq(D.check({ name: 'a', model: 'b', machine: 'c', material: 'd', structure: '긴 원통 모양의 구조체', function: '기름을 보내는 일', use: 'e', process: 'f', hs: '철판' }).missing, ['HS 후보'], 'HS 를 못 읽으면 누락으로 센다');
ok(D.check({ basis: '기본세율 8% 적용 예상' }).warns.some(function (w) { return w.indexOf('관세율') >= 0; }), '메모의 세율 경고');
ok(!D.check({ composition: '크롬 1.2%' }).warns.some(function (w) { return w.indexOf('관세율') >= 0; }), '성분 % 는 세율이 아니다');

// 초안
var d0 = D.draft(smp.items[0]);
eq(d0.sections.map(function (s) { return s.label; }), ['구조 및 형태', '기능 및 용도', '성분(함량) 및 제조공정', '제출서류 목록', '품목분류 의견'], '다섯 칸 순서(v1.2 양식 2~6절)');
eq(d0.holes, [], '다 채운 부품은 빈칸 없음');
has(d0.sections[0].text, '22톤급 유압 굴착기에 사용되는 버킷 투스(Bucket Tooth)입니다.', '구조 첫 문장');
has(d0.sections[2].text, '용해 → 주조', '공정 화살표 유지');
has(d0.sections[4].text, '버킷 투스로서', '의견 조사');
has(d0.sections[4].text, '후보 1: 8431.49', 'HS 후보 1');
has(d0.sections[4].text, '후보 2: 7325.99', 'HS 후보 2');
has(d0.sections[4].text, '서로 다른 류(제84류·제73류)', '다른 류 경고 문장');
has(d0.sections[4].text, '제84류 후보가 있으므로', '제16부 주 2 검토 안내');
has(d0.sections[4].text, '최종 품목분류는 담당자 검토', '최종 판단은 담당자');
eq(D.lint(d0.sections[4].text), [], '규칙 의견은 단정·세율 검사에 걸리지 않는다');
var d1 = D.draft(smp.items[1]);
not(d1.sections[4].text, '서로 다른 류', '같은 류 후보면 다른 류 문장 없음');
var d2 = D.draft(smp.items[2]);
eq(d2.holes, ['제조공정'], '빈칸 = 제조공정');
has(d2.sections[2].text, '[확인 필요: 제조공정]', '빈칸 표시를 문장에 남긴다');
not(d2.sections[2].text, '제조사는', '없는 제조사를 지어내지 않는다');
var dx = D.draft({ id: 'Z', name: '핀' });
has(dx.sections[4].text, '[확인 필요: HS 후보]', 'HS 없으면 빈칸');
eq(D.draft(smp.items[0], { opinion: '세번 검토 의견' }).sections[4].label, '세번 검토 의견', '바꾼 칸 이름이 초안에 쓰인다');
has(D.draft({ name: 'a', function: '작동유를 실린더로 보내는 역할을 함.' }).sections[1].text, '보내는 역할을 함.', '문장으로 적은 기능은 그대로 쓴다');
has(D.draft({ name: 'a', process: '절단>용접>도장' }).sections[2].text, '절단 → 용접 → 도장 순서로', '> 를 화살표로');

// 문체
eq(D.detectStyle(D.sampleExample()).style, 'ham', '개조식 예시 → ham');
eq(D.detectStyle('본 물품은 롤러이다. 하중을 지지한다.').style, 'ida', '평서 예시 → ida');
eq(D.detectStyle('본 물품은 롤러입니다. 하중을 지지합니다.').style, 'nida', '존댓말 예시 → nida');
eq(D.detectStyle('').style, 'nida', '예시 없으면 존댓말');
var ham = D.applyStyle(d0, 'ham'), ida = D.applyStyle(d0, 'ida');
ok(ham.sections.every(function (s) { return !/니다/.test(s.text); }), '개조식 변환 뒤 「니다」 없음', ham.sections.map(function (s) { return s.text; }).join(' ').match(/\S*니다/g));
ok(ida.sections.every(function (s) { return !/니다/.test(s.text); }), '평서 변환 뒤 「니다」 없음');
has(ham.sections[0].text, '버킷 투스(Bucket Tooth)임.', '입니다 → 임');
has(ida.sections[2].text, '순서로 이루어진다.', '이루어집니다 → 이루어진다');
eq(D.convertStyle('필요가 있습니다.', 'ham'), '필요가 있음.', '있습니다 → 있음');
eq(D.convertStyle('그대로 둡니다', 'nida'), '그대로 둡니다', 'nida 는 바꾸지 않는다');

// 세율·단정 거르기
var sr = D.scrubRates('본 물품의 관세율은 8%로 예상됩니다. 크롬 1.2%를 함유합니다.');
eq(sr.removed, 1, '세율 문장의 수치만 지운다');
has(sr.text, '[관세율 수치 삭제]', '삭제 표시');
has(sr.text, '크롬 1.2%', '성분 % 는 남긴다');
ok(D.lint('제8431.49호로 분류됩니다.').length === 1, '단정 표현 짚기');

// AI 요청·응답(실제 호출 없이)
var pr = D.buildPrompt(smp.items[0], d0, '예시 문장임.', {});
has(pr.system, '관세율 수치를 쓰지 마세요', '프롬프트: 세율 금지');
has(pr.user, '[과거 작성 사례 — 문체 참고만]', '프롬프트: 문체 예시 칸');
not(D.buildPrompt(smp.items[0], d0, '', {}).user, '과거 작성 사례', '예시 없으면 칸 생략');
var ro = D.buildRequest('openai', 'k1', pr), ra = D.buildRequest('anthropic', 'k2', pr);
eq([ro.url, ro.body.model, ro.headers.Authorization], ['https://api.openai.com/v1/chat/completions', 'gpt-4o-mini', 'Bearer k1'], 'OpenAI 요청');
eq([ra.url, ra.body.model, ra.headers['x-api-key'], ra.headers['anthropic-version'], ra.headers['anthropic-dangerous-direct-browser-access']],
  ['https://api.anthropic.com/v1/messages', 'claude-haiku-5-5', 'k2', '2023-06-01', 'true'], 'Anthropic 요청');
eq(D.extractText('openai', { choices: [{ message: { content: 'A' } }] }), 'A', 'OpenAI 응답 글');
eq(D.extractText('anthropic', { content: [{ type: 'text', text: 'B' }, { type: 'tool_use' }] }), 'B', 'Anthropic 응답 글');
var ai = D.parseAIReply('다음과 같습니다.\n```json\n{"sections":{"structure":"구조 문장","opinion":"관세율은 8%입니다. 제8431호로 확정됩니다."},"missing":["치수"]}\n```');
eq(ai.sections.structure, '구조 문장', 'AI 답 JSON 꺼내기');
not(ai.sections.opinion, '8%', 'AI 답의 세율 삭제');
ok(ai.warns.some(function (w) { return w.indexOf('단정') >= 0; }), 'AI 답의 단정 표현 경고');
eq(ai.missing, ['치수'], 'AI 가 짚은 누락');
ok(!!D.parseAIReply('JSON 없음').error, 'JSON 없으면 오류');

// 내보내기
var entries = smp.items.map(function (it) { return { item: it, sections: D.draft(it).sections, check: D.check(it) }; });
var rows = D.sheetRows(entries, {});
eq(rows.length, 4, '엑셀: 머리줄 + 3건');
eq(rows[0][4], 'HS 후보(검토 필요)', '엑셀: HS 머리말에 검토 필요');
eq(rows[3][rows[0].indexOf('누락 항목')], '제조공정', '엑셀: 누락 항목 열');
eq(rows[1][rows[0].indexOf('작성 구분')], '규칙 초안', '엑셀: 작성 구분');
entries[0].sections = entries[0].sections.map(function (s, i) { return i ? s : Object.assign({}, s, { source: 'ai' }); });
eq(D.sheetRows(entries, {})[1][rows[0].indexOf('작성 구분')], 'AI 초안 반영 — 검토 필요', '엑셀: AI 반영 구분');
var html = D.printHTML(entries, { title: '물품 설명서(질의용)' });
eq((html.match(/<article/g) || []).length, 3, '인쇄: 3건');
has(html, '물품 설명서(질의용)', '인쇄: 바꾼 제목');
has(html, 'AI 초안 반영 — 검토 필요', '인쇄: AI 표시');
has(html, '누락 1건', '인쇄: 누락 표시');
not(D.printHTML([{ item: { id: '<b>' }, sections: [], check: { missing: [], warns: [] } }], {}), '<b>', '인쇄: HTML 이스케이프');


/* ===================== v1.1 수출입통관통합관리 DashBoard — js/customs.js ===================== */
var v10 = passed + failed;
var C = require('../js/customs.js');
// JSON 비교는 Infinity·NaN 을 null 로 적어 버려 0 나누기를 못 잡는다 — null 은 === 로 본다
function isNull(g, label) { ok(g === null, label, '기대: null  실제: ' + g); }
function near(g, w, label) { ok(g != null && Math.abs(g - w) < 1e-9, label, '기대: ' + w + '  실제: ' + g); }

// 열 이름 짝짓기 — 같은 뜻 낱말, 괄호 속 단위, 대소문자·구두점
eq(C.normKey('물자대(원)'), '물자대', '괄호 속 단위를 지운다');
eq(C.normKey('HS CODE'), 'hscode', '공백·대소문자');
var mi = C.mapColumns(['수리일자', '사업본부', '원산지국', '거래처명', 'HS부호', '물자대(원)', '관세액', 'FTA물자대', 'FTA절감액', '담당자'], 'import');
eq(mi.missing, [], '수입: 필수 열을 모두 찾는다');
eq([mi.map.goods, mi.map.ftaGoods, mi.map.duty, mi.map.saving], ['물자대(원)', 'FTA물자대', '관세액', 'FTA절감액'], '수입: 물자대와 물자대_FTA 를 섞지 않는다');
eq(mi.unused, ['담당자'], '쓰지 않은 열을 알린다');
var me = C.mapColumns(['수출신고일', '본부', '목적국', '거래처', 'HS CODE', '수출금액', '물자대_FTA', '절감액'], 'export');
eq([me.map.date, me.map.country, me.map.amount, me.map.ftaGoods], ['수출신고일', '목적국', '수출금액', '물자대_FTA'], '수출: 열 짝짓기');
var mx = C.mapColumns(['일자', '조직', '나라', '업체', 'HS', '금액', '관세'], 'import');
eq(mx.missing, ['본부', '국가'], '못 찾은 필수 열을 이름으로 돌려준다');
var mo = C.mapColumns(['일자', '조직', '나라', '업체', 'HS', '금액', '관세'], 'import', { hq: '조직', country: '나라' });
eq(mo.missing, [], '사람이 고르면 채워진다');
eq(mo.score.hq, 'user', '사람이 고른 짝 표시');
eq(C.mapColumns(['일자', '본부'], 'import', { hq: '' }).map.hq, undefined, '사람이 「없음」을 고르면 자동으로 다시 짝짓지 않는다');
eq(C.mapColumns(['본부', '본부명'], 'refund').map.hq, '본부', '한 열은 한 번만 — 이름이 같은 열이 먼저');

// 머리글 줄 찾기 — 제목·조회 조건 줄이 위에 붙은 ERP 엑셀
eq(C.findHeaderRow([['수입 실적 조회'], ['조회기간: 2025-01-01 ~ 2025-01-31', ''], ['수리일자', '사업본부', '원산지', '물자대'], ['2025-01-02', 'A', '중국', 100]]), 2, '머리글은 셋째 줄');
eq(C.findHeaderRow([['가', '나'], [1, 2]]), 0, '맞는 줄이 없으면 첫 줄');
eq(C.normalize([{ 일자: '' , 본부: 'A', 환급액: 1 }], 'refund', { date: '일자', hq: '본부', amount: '환급액' }, 2).skipped[0].row, 4, '머리글 위 줄 수만큼 엑셀 줄 번호를 민다');

// 파일 종류 알아보기
eq(C.detectKind(['수리일자', '사업본부', '원산지국', '거래처명', 'HS부호', '물자대(원)', '관세액']).kind, 'import', '수입 파일');
eq(C.detectKind(['수출신고일', '본부', '목적국', '거래처', 'HS CODE', '수출금액']).kind, 'export', '수출 파일');
eq(C.detectKind(['환급년월', '본부', '환급금액']).kind, 'refund', '환급 파일');
eq(C.detectKind(['년월', '수출입구분', '신고건수', '오류건수', '오류점수']).kind, 'errors', '오류점수 파일');
eq(C.detectKind(['일자', '본부', '국가', '업체', 'HS', '금액'], '수출실적.xlsx').kind, 'export', '애매하면 찾은 열 수, 그다음 파일 이름');
eq(C.detectKind(['가', '나', '다']).kind, null, '모르는 파일은 종류를 정하지 않는다');

// 값 읽기 — 숫자
eq(C.parseNum('1,234,000'), 1234000, '쉼표 숫자');
eq(C.parseNum('(1,500)'), -1500, '괄호는 음수');
eq(C.parseNum('△200'), -200, '△ 는 음수');
eq(C.parseNum('₩ 3,000원'), 3000, '원 표기');
eq(C.parseNum(''), null, '빈칸은 null');
eq(C.parseNum('-'), null, '「-」는 빈 값');
ok(isNaN(C.parseNum('미정')), '글자는 NaN(읽지 못함)');
eq(C.parseNum(12.5), 12.5, '숫자 그대로');

// 값 읽기 — 날짜
eq(C.parseDate('2025-01-15').date, '2025-01-15', '날짜 2025-01-15');
eq(C.parseDate('2025.1.5').date, '2025-01-05', '날짜 2025.1.5');
eq(C.parseDate('20250115').month, '2025-01', '날짜 20250115');
eq(C.parseDate(202503).month, '2025-03', '숫자 202503 은 년월');
eq(C.parseDate('2025년 3월').month, '2025-03', '2025년 3월');
eq(C.parseDate(45672).date, '2025-01-15', '엑셀 날짜 일련번호 45672 = 2025-01-15');
eq(C.parseDate('2025-02-30'), null, '없는 날짜는 거른다');
eq(C.parseDate('2025-13'), null, '13월은 거른다');
eq(C.parseDate('어제'), null, '글자는 null');

// HS 4단위 자르기
eq(C.hs4('8431.49-9090'), '8431', 'HS 10자리 표기 → 8431');
eq(C.hs4('8431499090'), '8431', '숫자만 10자리 → 8431');
eq(C.hs4(843149), '8431', '숫자 6자리');
eq(C.hs4('402.10'), '0402', '앞의 0 이 빠진 3자리 호 → 0402');
eq(C.hs4(40299), '0402', '홀수 자리(5) → 앞에 0');
eq(C.hs4('84'), null, '4자리 미만은 null');
eq(C.hs4('7700.10'), null, '77류는 없다');
eq(C.hs4('9999'), null, '98류 이상은 없다');

// 정리 — 합계 줄·날짜 없는 줄은 사유와 함께 건너뛰고, 빈 금액은 0 으로 채우지 않는다
var IMP_MAP = { date: '일자', hq: '본부', country: '국가', company: '업체', hs: 'HS', goods: '물자대', duty: '관세', ftaGoods: 'FTA', saving: '절감' };
function ir(d, h, c, co, hs, g, du, f, sv) { return { 일자: d, 본부: h, 국가: c, 업체: co, HS: hs, 물자대: g, 관세: du, FTA: f, 절감: sv }; }
var IMP_ROWS = [
  ir('2025-01-10', 'A본부', '중국', '갑', '8431.49', 1000, 80, '', ''),
  ir('2025-01-20', 'A본부', '독일', '을', '8482.10', 2000, 0, 2000, 160),
  ir('2025-02-03', 'B본부', '중국', '갑', '8431.20', 3000, 150, '', ''),
  ir('2025-02-28', 'B본부', '일본', '병', '4009.42', 1000, '', '', ''),
  ir('', 'B본부', '일본', '병', '4009.42', 500, 40, '', ''),
  ir('2024-01-15', 'A본부', '중국', '갑', '8431.49', 900, 72, '', ''),
  ir('합계', '', '', '', '', 8400, 342, '', ''),
  ir('', '', '', '', '', '', '', '', '')
];
var ni = C.normalize(IMP_ROWS, 'import', IMP_MAP);
eq(ni.records.length, 5, '정리: 5줄 읽음');
eq(ni.skipped.map(function (s) { return s.row; }), [6, 8], '정리: 날짜 빈 줄(6행)과 합계 줄(8행)을 건너뜀');
eq(ni.skipped[1].reason, '합계·소계 줄', '정리: 건너뛴 사유');
eq(ni.records[3].duty, null, '정리: 빈 관세는 null');
ok(ni.issues.some(function (t) { return /관세 빈칸 1칸/.test(t); }), '정리: 빈 필수 칸을 알린다');
ok(!ni.issues.some(function (t) { return /FTA|물자대_FTA/.test(t); }), '정리: 선택 칸(FTA) 빈칸은 알리지 않는다');
eq(ni.period, { from: '2024-01', to: '2025-02' }, '정리: 데이터 기간');
eq(ni.records[0].hs4, '8431', '정리: HS 4단위');

// 기간
eq(C.shiftMonth('2025-03', -12), '2024-03', '12개월 앞');
eq(C.shiftMonth('2025-01', -1), '2024-12', '해 넘김');
eq(C.monthsBetween('2024-11', '2025-02'), ['2024-11', '2024-12', '2025-01', '2025-02'], '달 목록');
eq(C.defaultRange({ from: '2024-01', to: '2025-10' }), { from: '2025-01', to: '2025-10' }, '기본 기간 = 마지막 해 1월~마지막 달');
eq(C.defaultRange({ from: '2025-04', to: '2025-10' }), { from: '2025-04', to: '2025-10' }, '데이터가 늦게 시작하면 그 달부터');
eq(C.prevRange({ from: '2025-01', to: '2025-10' }), { from: '2024-01', to: '2024-10', overlap: false }, '전년 동기');
ok(C.prevRange({ from: '2024-01', to: '2025-10' }).overlap, '12개월을 넘으면 겹침 표시');

// 거르기
var R25 = { from: '2025-01', to: '2025-12' };
eq(C.applyFilter(ni.records, 'import', { from: '2025-02', to: '2025-02' }).records.length, 2, '기간 거르기 — 2월만 2줄');
eq(C.applyFilter(ni.records, 'import', { hq: 'A본부' }).records.length, 3, '본부 거르기');
eq(C.applyFilter(ni.records, 'import', { country: '중국', from: '2025-01' }).records.length, 2, '국가 + 기간');
var fr = C.applyFilter([{ month: '2025-01', hq: 'A', amount: 1 }], 'refund', { country: '중국' });
eq([fr.records.length, fr.ignored], [1, ['국가']], '국가 열이 없는 데이터에는 국가 조건을 걸지 않고 알린다');

// 수입 — 손계산: 2025년 물자대 1000+2000+3000+1000 = 7000, 관세 80+0+150+(빈칸) = 230, 부담율 230/7000
var is = C.importStats(ni.records, R25, 'hq');
eq([is.goods, is.duty, is.n], [7000, 230, 4], '수입 합계(빈 관세는 더하지 않음)');
near(is.burden, 230 / 7000, '관세부담율 = 관세 ÷ 물자대');
eq(is.groups.map(function (g) { return [g.key, g.goods, g.duty]; }), [['B본부', 4000, 150], ['A본부', 3000, 80]], '본부별(물자대 큰 순)');
near(is.groups[1].burden, 80 / 3000, '본부별 부담율');
eq(C.importStats(ni.records, R25, 'hs4').groups.map(function (g) { return g.key; }), ['8431', '8482', '4009'], 'HS 4단위로 묶기(8431.49 와 8431.20 이 하나)');
eq(C.importStats(ni.records, R25, 'country').groups[0], { key: '중국', n: 2, goods: 4000, duty: 230, burden: 230 / 4000 }, '국가별');
eq(is.monthly.slice(0, 3).map(function (m) { return [m.month, m.goods]; }), [['2025-01', 3000], ['2025-02', 4000], ['2025-03', null]], '월별 — 데이터 없는 달은 비움');
isNull(C.importStats([], R25, 'hq').burden, '데이터가 없으면 부담율 null(0 나누기 없음)');
isNull(C.ratio(5, 0), '0 으로 나누면 null');
isNull(C.ratio(null, 3), '빈 값 나누기는 null');

// 수출 — 전년 동기 대비. 손계산: 2025-01~03 = 100+50+300 = 450, 2024-01~03 = 200+100 = 300 → +150, +50%
var EXP_MAP = { date: 'd', hq: 'h', country: 'c', company: 'co', hs: 'hs', amount: 'a' };
function er(d, h, c, a) { return { d: d, h: h, c: c, co: c + '상사', hs: '8429.52', a: a }; }
var ne = C.normalize([er('2025-01-05', 'A', '미국', 100), er('2025-02-05', 'A', '미국', 50), er('2025-03-05', 'B', '호주', 300),
  er('2024-01-05', 'A', '미국', 200), er('2024-03-05', 'B', '브라질', 100), er('2024-06-05', 'B', '호주', 999), er('2023-01-05', 'A', '미국', 7)], 'export', EXP_MAP);
var es = C.exportStats(ne.records, { from: '2025-01', to: '2025-03' }, 'country');
eq([es.amount, es.prev, es.diff], [450, 300, 150], '수출 올해·전년 동기·증감');
near(es.rate, 0.5, '증감률 = (올해 − 전년) ÷ 전년');
eq(es.groups.map(function (g) { return [g.key, g.amount, g.prev, g.diff]; }), [['호주', 300, null, 300], ['미국', 150, 200, -50], ['브라질', null, 100, -100]], '국가별 증감 — 전년에만 있던 국가도 남긴다');
isNull(es.groups[0].rate, '전년이 없으면 증감률 null');
near(es.groups[1].rate, -0.25, '미국 -25%');
near(es.groups[2].rate, -1, '올해 없으면 -100%');
eq(es.monthly.map(function (m) { return [m.month, m.amount, m.prev]; }), [['2025-01', 100, 200], ['2025-02', 50, null], ['2025-03', 300, 100]], '월별 올해·전년');
eq(C.exportStats(ne.records, { from: '2025-01', to: '2025-03' }, 'hq').groups.map(function (g) { return [g.key, g.amount, g.prev]; }), [['B', 300, 100], ['A', 150, 200]], '본부별 증감');

// FTA — 손계산: 수입 2025 물자대 7000, 물자대_FTA 2000(빈칸=미적용), 활용률 2000/7000, 절감액 160
var fs1 = C.ftaStats(ni.records, 'import', R25, 'country', IMP_MAP);
eq([fs1.goods, fs1.ftaGoods, fs1.saving], [7000, 2000, 160], 'FTA 수입 합계');
near(fs1.util, 2000 / 7000, 'FTA 활용률 = 물자대_FTA ÷ 물자대');
eq(fs1.groups.map(function (g) { return [g.key, g.ftaGoods, g.util]; }), [['중국', 0, 0], ['독일', 2000, 1], ['일본', 0, 0]], 'FTA 국가별 — 미적용은 0%');
var fs2 = C.ftaStats(ne.records, 'export', { from: '2025-01', to: '2025-03' }, 'hq', EXP_MAP);
eq([fs2.available, fs2.ftaGoods, fs2.util], [false, null, null], '물자대_FTA 열이 없으면 값을 지어내지 않는다');

// 환급 — 본부 × 월 표
var nr = C.normalize([{ m: '2025-01', h: 'A', a: '1,000', n: 2 }, { m: '2025-01', h: 'B', a: 500, n: 1 }, { m: '2025-03', h: 'A', a: 300, n: '' }, { m: '2024-12', h: 'A', a: 9 }],
  'refund', { date: 'm', hq: 'h', amount: 'a', count: 'n' });
var rs = C.refundStats(nr.records, { from: '2025-01', to: '2025-03' });
eq([rs.amount, rs.count, rs.monthsWithData], [1800, 3, 2], '환급 합계·건수·데이터 있는 달');
eq(rs.monthAvg, 900, '월평균 = 합계 ÷ 데이터 있는 달 수');
eq(rs.pivot.map(function (p) { return [p.hq, p.total, p.months]; }), [['A', 1300, [1000, null, 300]], ['B', 500, [500, null, null]]], '본부 × 월 표');
eq(rs.last.month, '2025-03', '최근 환급 달');

// 오류 — 손계산: 신고 400+200+300 = 900, 오류 4+1+0 = 5, 비율 5/900, 점수 10+3+0
var nx = C.normalize([{ p: '2025년 1월', k: '수입', d: 400, e: 4, s: 10 }, { p: '2025년 1월', k: '수출', d: 200, e: 1, s: 3 }, { p: '2025년 2월', k: '수입', d: 300, e: 0, s: 0 }, { p: '2025년 3월', k: '수출', d: 0, e: 0, s: 0 }],
  'errors', { date: 'p', kind: 'k', decl: 'd', err: 'e', score: 's' });
var xs = C.errorStats(nx.records, { from: '2025-01', to: '2025-03' }, 'kind');
eq([xs.decl, xs.err, xs.score], [900, 5, 13], '오류 합계');
near(xs.rate, 5 / 900, '오류 비율 = 오류건수 ÷ 신고건수');
eq(xs.groups.map(function (g) { return [g.key, g.decl, g.err]; }), [['수입', 700, 4], ['수출', 200, 1]], '구분별');
isNull(xs.monthly[2].rate, '신고 0건인 달은 비율 null');

// 상위 N + 그 밖
var tn = C.topN(is.groups.concat([{ key: 'C본부', n: 1, goods: 10, duty: 1, burden: 0.1 }]), 1);
eq([tn.rows.length, tn.rest.key, tn.rest.goods, tn.rest.duty], [1, '그 밖 2개', 3010, 81], '상위 1 + 그 밖 합계');
near(tn.rest.burden, 81 / 3010, '그 밖의 부담율은 합계로 다시 계산');

// 표기
eq(C.fmtNum(1234567), '1,234,567', '천 단위 쉼표');
eq(C.fmtPct(0.12345), '12.3%', '백분율');
eq(C.fmtPct(null), '—', '빈 값은 —');
eq(C.fmtSignedPct(0.5), '+50.0%', '증가 +');
eq(C.fmtShort(1234000000), '12.3억원', '억 단위');
eq(C.fmtShort(56780000), '5,678만원', '만 단위');
eq(C.fmtShort(1500, '천원'), '1,500 천원', '원이 아니면 줄이지 않는다');

// 엑셀 표
var book = C.exportBook({ range: R25, filter: {}, unit: '원', data: { import: { file: 'a.xlsx', uploadedAt: '2026-11-03', period: ni.period, records: ni.records, map: IMP_MAP, skipped: ni.skipped } } });
eq(book.map(function (b) { return b.name; }), ['안내', '수입_본부', '수입_국가', '수입_업체', '수입_HS4단위', 'FTA_수입_본부', 'FTA_수입_국가'], '엑셀: 올린 데이터만 시트로');
ok(book.every(function (b) { return b.name.length <= 31; }), '엑셀: 시트 이름 31자 이내');
var bs = book[1].aoa;
eq(bs[bs.length - 1], ['합계', 4, 7000, 230, 3.29], '엑셀: 수입 합계 줄(부담율 %)');
has(JSON.stringify(book[0].aoa), '관세부담율 = 관세 ÷ 물자대', '엑셀: 계산식 안내');

// 자료 목록
var la = C.libAdd([], { name: ' 사유서 양식.xlsx ', category: '사유서', location: '\\\\fs\\a.xlsx' }, '2026-11-03T09:00:00');
eq([la.errors, la.list.length, la.list[0].name, la.list[0].added], [[], 1, '사유서 양식.xlsx', '2026-11-03'], '자료 등록');
eq(C.libAdd(la.list, { name: '', category: '기타' }).errors.length, 1, '이름이 없으면 등록하지 않는다');
eq(C.libAdd(la.list, { name: '사유서 양식.xlsx', category: '사유서' }).errors, ['같은 분류에 같은 이름이 이미 있습니다.'], '같은 분류·같은 이름은 거른다');
var lb = C.libAdd(la.list, { name: '환급 매뉴얼.pptx', category: '', desc: '소요량 계산 순서' }, '2026-11-03T09:00:00').list;
eq(lb[1].category, '기타', '분류가 비면 기타');
ok(lb[0].id !== lb[1].id, '번호가 겹치지 않는다');
var lc = C.libAdd(C.libRemove(lb, lb[0].id), { name: '새 자료' }, '2026-11-03T09:00:00').list;
ok(lc[0].id !== lc[1].id, '지운 뒤 다시 넣어도 번호가 겹치지 않는다');
eq(C.libSearch(lb, '소요량').length, 1, '자료 찾기 — 설명 낱말');
eq(C.libSearch(lb, '', '사유서').length, 1, '자료 찾기 — 분류');
eq(C.libSearch(lb, '양식 사유서').length, 1, '자료 찾기 — 낱말 여럿(모두 맞아야)');
eq([C.libLocationKind('https://intra.example.com/a'), C.libLocationKind('\\\\fs\\a'), C.libLocationKind('C:\\a'), C.libLocationKind('3층 캐비닛')], ['url', 'path', 'path', 'text'], '위치 종류(링크·경로·글)');
var lf = C.libFromRows([{ 파일명: 'A.xlsx', 구분: 'FTA', 경로: 'https://x.example.com' }, { 파일명: '', 구분: '' }, { 파일명: 'A.xlsx', 구분: 'FTA' }], [], '2026-11-03');
eq([lf.added, lf.errors.length, lf.list[0].location], [1, 1, 'https://x.example.com'], '엑셀에서 되읽기(빈 줄 넘김·중복 알림)');
eq(C.libToAoa(lb)[0], ['파일 이름', '분류', '설명', '사내 위치', '담당', '등록일'], '자료 목록 엑셀 머리글');

// 예제 4종 — 종류를 알아보고, 열을 다 찾고, 숫자는 계산과 맞는다
var files = C.sampleFiles();
eq(files.map(function (f) { var h = f.aoa[0]; return C.detectKind(h, f.name).kind; }), ['import', 'export', 'refund', 'errors', 'ruling'], '예제 5종 종류 알아보기');
eq(files.map(function (f) { return C.mapColumns(f.aoa[0], f.kind).missing.length; }), [0, 0, 0, 0, 0], '예제 5종 필수 열 모두 찾음');
var sn = files.map(function (f) { return C.normalize(C.aoaToRows(f.aoa), f.kind, C.mapColumns(f.aoa[0], f.kind).map); });
eq(sn.slice(0, 4).map(function (n) { return n.period; }), [0, 1, 2, 3].map(function () { return { from: '2024-01', to: '2025-10' }; }), '예제 기간 2024-01~2025-10');
eq([sn[0].skipped.length, sn[0].skipped[0].reason], [1, '합계·소계 줄'], '예제 수입: 합계 줄 1개를 건너뜀');
var sis = C.importStats(sn[0].records, C.defaultRange(sn[0].period), 'hq');
eq(sis.groups.reduce(function (t, g) { return t + g.goods; }, 0), sis.goods, '예제: 본부별 합 = 전체');
var ses = C.exportStats(sn[1].records, { from: '2025-01', to: '2025-10' }, 'country');
ok(ses.hasPrev && ses.groups.some(function (g) { return g.prev == null && g.amount > 0; }), '예제 수출: 올해 새로 생긴 국가(전년 없음)가 있다');
ok(JSON.stringify(files).indexOf('(가상)') > 0, '예제 업체·본부에 「가상」 표기');
// samples/ 의 실제 엑셀이 sampleFiles() 와 같은지(tools/make-samples.mjs 로 다시 만든다) — 수입 파일은 제목 2줄이 위에 있다
var XLSX = require('../lib/xlsx.full.min.js'), fsx = require('fs'), px = require('path');
files.forEach(function (f, i) {
  var wb = XLSX.read(fsx.readFileSync(px.join(__dirname, '..', 'samples', f.name)), { type: 'buffer' });
  var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }), hr = C.findHeaderRow(aoa);
  var n = C.normalize(C.aoaToRows(aoa.slice(hr)), f.kind, C.mapColumns(aoa[hr].map(String), f.kind).map, hr);
  eq([hr, n.records.length, C.sum(n.records, f.kind === 'import' ? 'goods' : f.kind === 'errors' ? 'decl' : 'amount')],
    [f.kind === 'import' ? 2 : 0, sn[i].records.length, C.sum(sn[i].records, f.kind === 'import' ? 'goods' : f.kind === 'errors' ? 'decl' : 'amount')], 'samples/ ' + f.name + ' = 예제 정의');
});
eq(sn[0].skipped[0].row, 222, '예제 수입 합계 줄 = 엑셀 222행(머리글 1행 + 220줄 다음)');

/* ===================== v1.2 — 양식 6절 · 결정문 현황 · 수입보세화물 추적 ===================== */
var v11 = passed + failed;
var G = require('../js/cargo.js');

// 물품설명서 — 양식 6절(1절 품명은 머리글, 2~6절 다섯 칸)
eq(D.SECTIONS, ['structure', 'function', 'composition', 'docs', 'opinion'], '양식 2~6절 순서');
eq(D.mergeLabels({}).docs, '제출서류 목록', '제출서류 목록 칸');
var it6 = D.normalize(D.sample()).items[0]; it6.docs = '카탈로그, 도면'; it6.supplierHs = '8431.49-9090';
var d6 = D.draft(it6), docsText = d6.sections[3].text;
has(docsText, '1. 카탈로그', '제출서류를 번호 목록으로'); has(docsText, '2. 도면', '제출서류 둘째');
has(docsText, '8431.49-9090', '공급자 HS 참고 표기'); has(docsText, '참고용', '공급자 HS 는 참고');
var d6b = D.draft(D.normalize(D.sample()).items[2]);
has(d6b.sections[3].text, '붙임 자료: 없음', '제출서류 없으면 안내만'); ok(d6b.holes.indexOf('제출서류') < 0, '제출서류는 필수 칸이 아니다');
eq(D.fieldOf('첨부서류'), 'docs', '첨부서류 → 제출서류'); eq(D.fieldOf('해외공급자 HS'), 'supplierHs', '해외공급자 HS → 공급자 HS'); eq(D.fieldOf('상표명'), 'brand', '상표명 → 상표');
var ph = D.printHTML([{ item: it6, sections: d6.sections, check: D.check(it6) }]);
has(ph, '1. 품명', '인쇄 양식 1절 품명'); has(ph, '5. 제출서류 목록', '인쇄 양식 5절'); has(ph, '6. 품목분류 의견', '인쇄 양식 6절');
eq(D.sheetRows([{ item: it6, sections: d6.sections, check: D.check(it6) }])[0].length, 13, '엑셀 머리글 13칸(다섯 칸 양식)');
eq(D.parseAIReply('{"sections":{"docs":"카탈로그 1부"},"missing":[]}').sections.docs, '카탈로그 1부', 'AI 답의 docs 칸');
has(D.buildPrompt(it6, d6, '', {}).system, '"docs"', 'AI 지시문에 docs 칸');

// 결정문 현황 — 관세율 읽기
eq(C.parseRate('8'), { rate: 8, code: '' }, '관세율 8'); eq(C.parseRate('FCN0'), { rate: 0, code: 'FCN' }, '협정 부호 FCN0');
eq(C.parseRate(' 0 % '), { rate: 0, code: '' }, '0 %'); isNull(C.parseRate(''), '빈 관세율은 null'); eq(C.parseRate('면세'), undefined, '못 읽는 관세율은 undefined');
var RM = { product: 'p', item: 'i', hs: 'h', date: 'd', rate: 'r', broker: 'b', prevRate: 'pr', goods: 'g', docNo: 'n' }, RR = { from: '2025-01', to: '2025-12' };
var nr = C.normalize([
  { p: 'EXCAVATOR', i: 'PIN', h: '8431.43-0000', d: '2025-03-10', r: '0', b: 'A', pr: '8', g: 1000000, n: '4과-1' },
  { p: 'EXCAVATOR', i: 'HORN', h: '8512.30-0000', d: '2025-04-02', r: '8', b: 'B', pr: '8', g: 500000, n: '3과-2' },
  { p: 'Wheel Loader', i: 'PIN', h: '8431.43', d: '2025-04-20', r: 'FCN0', b: 'A', pr: '', g: '', n: '' },
  { p: '천공기', i: 'PIPE', h: '7304.31-0000', d: '2024-12-01', r: '', b: 'A', pr: '8', g: 200000, n: '' },
  { p: 'EXCAVATOR', i: '합계', h: '', d: '', r: '', b: '', pr: '', g: '', n: '' }
], 'ruling', RM);
eq(nr.records.length, 4, '결정문 4건(합계 줄 제외)'); eq([nr.records[2].rate, nr.records[2].rateCode, nr.records[2].hs4], [0, 'FCN', '8431'], 'FCN0 → 0% · 부호 · HS 4단위');
isNull(nr.records[3].rate, '빈 관세율');
var rs = C.rulingStats(nr.records, RR, 'product');
eq([rs.n, rs.zero], [3, 2], '기간 안 3건 · 0% 2건'); near(rs.zeroRate, 2 / 3, '0% 비율');
eq([rs.withPrev, rs.lowered], [2, 1], '종전세율 있는 2건 중 낮아진 1건');
eq([rs.saving, rs.savingN], [80000, 2], '절감 추정 = 수입액 × (종전 − 결정)/100, 세 값이 다 있는 건만');
eq(rs.groups.map(function (g) { return [g.key, g.n, g.zero, g.saving]; }), [['EXCAVATOR', 2, 1, 80000], ['Wheel Loader', 1, 1, null]], '완제품별');
eq(C.rulingStats(nr.records, RR, 'broker').groups.map(function (g) { return g.key; }), ['A', 'B'], '관세사별');
eq(C.rulingStats(nr.records, RR, 'hs4').groups[0].key, '8431', 'HS 4단위로 묶기');
eq(rs.rates.map(function (r) { return r.key; }), ['0%', '8%', 'FCN 0%'], '세율별 분포');
eq(rs.list.map(function (r) { return r.date; }), ['2025-04-20', '2025-04-02', '2025-03-10'], '목록은 최근 시행 순');
eq(rs.monthly.filter(function (m) { return m.n; }).map(function (m) { return [m.month, m.n]; }), [['2025-03', 1], ['2025-04', 2]], '월별 시행 건수');
var rs0 = C.rulingStats(nr.records.map(function (r) { return Object.assign({}, r, { prevRate: null }); }), RR, 'product');
isNull(rs0.saving, '종전세율 없으면 절감 추정 null'); eq(rs0.withPrev, 0, '종전세율 있는 건 0');
var rm = C.mapColumns(['연번', '완제품', '품명', '결정세번', '품목분류사전심사결정문번호', '시행일자', '관세율', '관세사(해동,유니원)'], 'ruling');
eq(rm.missing, [], '기획자 파일 열 이름 모두 찾음'); eq([rm.map.docNo, rm.map.broker], ['품목분류사전심사결정문번호', '관세사(해동,유니원)'], '결정문번호 · 관세사 열');
eq(C.detectKind(['연번', '완제품', '품명', '결정세번', '시행일자', '관세율'], 'x.xlsx').kind, 'ruling', '결정문 파일 알아보기');
eq(C.detectKind(C.sampleFiles()[0].aoa[0], 'a').kind, 'import', '수입 파일은 여전히 수입');
var bk = C.exportBook({ range: RR, filter: {}, unit: '원', data: { ruling: { file: 'r.xlsx', uploadedAt: '', period: nr.period, records: nr.records, map: RM, skipped: nr.skipped } } });
eq(bk.map(function (b) { return b.name; }), ['안내', '결정문_완제품', '결정문_관세사', '결정문_HS4단위', '결정문_목록'], '결정문 엑셀 시트');
eq(bk[1].aoa[bk[1].aoa.length - 1], ['합계', 3, 2, 66.67, 80000], '결정문 합계 줄');
eq(C.applyFilter(nr.records, 'ruling', { hq: 'X' }).ignored, ['본부'], '본부 조건은 결정문에 걸지 않는다');

// 화물 추적 — 처리단계 이름
eq(G.classifyStage('수입신고 수리').key, 'cleared', '긴 별칭이 먼저(수입신고 수리 ≠ 수입신고)'); eq(G.classifyStage('수입신고').key, 'declared', '수입신고');
eq(G.classifyStage('입항보고제출').key, 'arrival', '입항보고제출'); eq(G.classifyStage('하선신고수리').key, 'unload', '하선신고수리');
eq(G.classifyStage('보세구역 반입').key, 'in', '반입'); eq(G.classifyStage('반출신고 수리').key, 'out', '반출');
eq(G.classifyStage('적하목록 제출').key, 'other', '모르는 단계는 그 밖'); eq(G.classifyStage('').key, 'other', '빈 단계');
// 일시
eq(G.parseDateTime('20261103194000'), '2026-11-03 19:40', '14자리 일시'); eq(G.parseDateTime('2026-11-03 19:40:12'), '2026-11-03 19:40', '초는 버린다');
eq(G.parseDateTime('2026.11.03'), '2026-11-03 00:00', '날짜만'); eq(G.parseDateTime(46329.5), '2026-11-03 12:00', '엑셀 일련번호(소수 = 시각)'); isNull(G.parseDateTime('어제'), '못 읽는 일시');
// 시간 외
eq(G.isAfterHours('2026-11-03 19:40'), true, '퇴근 후'); eq(G.isAfterHours('2026-11-03 10:00'), false, '근무 시간'); eq(G.isAfterHours('2026-11-03 08:59'), true, '출근 전');
eq(G.isAfterHours('2026-11-03 18:00'), true, '18:00 은 시간 외'); eq(G.isAfterHours('2026-11-01 10:00'), true, '토요일');
eq(G.isAfterHours('2026-11-01 10:00', { start: '09:00', end: '18:00', weekend: false }), false, '주말 보기 끄기'); isNull(G.isAfterHours('x'), '일시가 아니면 null');
// 등록
var L = G.add([], { bl: ' abcd-1234 ', requester: { name: '홍', email: 'a@b.co' }, broker: { name: '관', email: 'c@d.co' } }, '2026-11-04 09:00');
eq([L.errors, L.item.bl, L.item.id], [[], 'ABCD1234', 'S001'], 'BL 정규화 · 번호');
eq(G.add(L.list, { bl: 'ABCD1234' }).errors, ['이미 등록된 BL 번호입니다: ABCD1234'], '같은 BL 거름');
eq(G.add([], { bl: '' }).errors, ['BL 번호를 적어 주세요.'], 'BL 없음');
eq(G.add([], { bl: 'Z1', requester: { email: 'nope' } }).errors.length, 1, '메일 형식 검사'); eq(G.add([], { bl: 'Z1', eta: '언젠가' }).errors.length, 1, '입항예정일 검사');
// 반영
var M = G.merge(L.list, [
  { bl: 'ABCD1234', stage: '입항보고 제출', at: '20261103194000', place: 'A' },
  { bl: 'ABCD1234', stage: '입항보고 제출', at: '20261103194000', place: 'A' },
  { bl: 'ABCD1234', stage: '하선신고 수리', at: '2026-11-04 07:10' },
  { bl: '', stage: '수입신고', at: '2026-11-04 08:00' },
  { bl: 'NEW1', stage: '수입신고', at: '2026-11-04 08:30', ship: '가상호' },
  { bl: 'ABCD1234', stage: '반입신고', at: '' }
], '2026-11-04 09:00');
eq(M.added.length, 3, '새 단계 3건(같은 것은 한 번)'); eq(M.skipped.map(function (x) { return x.reason; }), ['BL 번호 없음', '처리일시를 읽지 못함: '], '건너뛴 사유');
eq(M.created, ['NEW1'], '모르는 BL 은 새로 만든다'); eq(M.list.length, 2, '목록 2건');
eq(M.list[0].events.map(function (e) { return e.key; }), ['arrival', 'unload'], '시간순'); eq(G.latest(M.list[0]).key, 'unload', '최신 단계'); eq(G.progress(M.list[0]).order, 2, '진행 2/6');
eq(G.merge(L.list, [{ bl: 'NEW2', stage: '수입신고', at: '2026-11-04 08:30' }], '', { autoAdd: false }).skipped[0].reason, '등록되지 않은 BL: NEW2', 'autoAdd 끄면 모르는 BL 은 건너뜀');
ok(L.list[0].events.length === 0, '원본 목록은 바뀌지 않는다');
// 알림
var A = G.alerts(M.list);
eq(A.map(function (a) { return [a.bl, a.key, a.afterHours]; }), [['NEW1', 'declared', true], ['ABCD1234', 'arrival', true]], '알림 = 입항보고·수입신고, 최근 순, 시간 외(08:30·19:40)');
eq(G.alerts(M.list, ['unload']).map(function (a) { return a.key; }), ['unload'], '대상 단계 바꾸기');
var M2 = G.markNotified(M.list, M.list[0].id, A[1].evKey, '2026-11-04 09:05');
eq(G.alerts(M2).length, 1, '통보하면 알림에서 빠진다'); eq(G.notifiedCount(M2[0]), 1, '통보 건수'); eq(G.alerts(M.list).length, 2, '통보 전 목록은 그대로');
// 메일 초안
var dr = G.mailDraft(M.list[0], M.list[0].events[0], {}, '통관담당');
eq(dr.to, ['c@d.co', 'a@b.co'], '받는 사람 = 관세사 · 요청자'); has(dr.subject, 'ABCD1234', '제목에 BL'); has(dr.body, '2026-11-03 19:40', '본문에 처리일시'); has(dr.body, '통관담당 드림', '보낸 사람');
eq(dr.missing, ['선명', '입항예정'], '빈 자리 알림(메모 제외)'); ok(/^mailto:c@d\.co,a@b\.co\?subject=/.test(dr.mailto), 'mailto 링크');
var dr2 = G.mailDraft(M.list[1], M.list[1].events[0], { declared: { subject: '{BL} {단계}', body: '{없는자리} {선명}' } }, '');
eq([dr2.subject, dr2.body, dr2.to], ['NEW1 수입신고', '{없는자리} 가상호', []], '틀 바꾸기 · 모르는 자리는 그대로 · 메일 없음');
eq(G.kakaoText(M.list[1], M.list[1].events[0]), '[통관] BL NEW1(가상호) 수입신고 2026-11-04 08:30', '카톡용 한 줄');
eq(G.mergeTemplates({ arrival: { subject: ' ' } }).arrival.subject, G.DEFAULT_TEMPLATES.arrival.subject, '빈 틀은 기본값');
// 유니패스 XML
var X = G.parseUnipassXML(G.sampleXML(new Date(2026, 10, 4)));
eq([X.bl, X.ship, X.events.length], ['GASANG2611003', '가상 3호(VIRTUAL SUN)', 2], 'XML 머리·단계 2건');
eq(X.events.map(function (e) { return G.classifyStage(e.stage).key; }), ['arrival', 'unload'], 'XML 단계 읽기'); eq(G.parseDateTime(X.events[0].at), '2026-11-04 06:50', 'XML 처리일시'); eq(X.events[0].place, '가상항 보세구역 C', 'XML 장치장');
eq(G.parseUnipassXML('').error, '붙여 넣은 내용이 없습니다.', '빈 XML'); eq(G.parseUnipassXML('hello').events.length, 0, 'XML 아님'); has(G.parseUnipassXML('<a><tCnt>0</tCnt></a>').error, '0건', '0건 응답');
eq(G.parseUnipassXML('<r><row><처리일시>2026-11-04 10:00</처리일시><처리단계>수입신고</처리단계></row></r>').events.length, 1, '한글 태그·row 도 읽는다');
// OpenAPI 주소
var u = G.apiUrl({ key: 'SECRETKEY', bl: 'ab-1', year: '2026' });
has(u, 'hblNo=AB1', 'House BL'); has(u, 'blYy=2026', 'BL 연도'); has(u, 'crkyCn=SECRETKEY', '키'); eq(G.maskKey(u).indexOf('SECRETKEY'), -1, '키 가림'); has(G.maskKey(u), 'SE…EY', '가린 모양'); has(G.apiUrl({ key: 'k', bl: 'x', kind: 'mbl' }), 'mblNo=X', 'Master BL');
// ERP 엑셀 열
var mh = G.mapHeaders(['B/L번호', '선명', '입항예정일', '처리단계', '처리일시', '장치장', '현업담당', '관세사']);
eq(mh.missing, [], 'ERP 열 모두 찾음'); eq([mh.map.bl, mh.map.requester], ['B/L번호', '현업담당'], 'BL · 요청자 열');
eq(G.mapHeaders(['번호', '상태']).missing, ['BL 번호', '처리일시'], '못 찾은 필수 열');
var SR = G.sampleRows(new Date(2026, 10, 4)), ev = G.eventsFromRows(SR.slice(1).map(function (r) { var o = {}; SR[0].forEach(function (h, i) { o[h] = r[i]; }); return o; }), mh.map);
eq([ev.length, ev[0].bl], [3, 'GASANG2611003'], '엑셀 줄 → 단계');
// 예제 · 엑셀 표
var S = G.sample(new Date(2026, 10, 4, 9, 0));
eq(S.length, 3, '예제 3건'); eq(G.alerts(S).map(function (a) { return [a.bl, a.key]; }), [['GASANG2611002', 'declared'], ['GASANG2611001', 'arrival']], '예제: 미통보 2건(2번 입항보고는 통보 완료)');
eq(G.alerts(S)[1].afterHours, true, '예제 1번 입항보고는 시간 외(19:40)');
var EB = G.exportBook(S);
eq(EB.map(function (b) { return b.name; }), ['현황', '진행단계', '알림'], '추적 엑셀 3시트'); eq([EB[0].aoa.length, EB[2].aoa.length], [4, 3], '현황 3건 · 알림 2건'); ok(JSON.stringify(EB).indexOf('crkyCn') < 0, '엑셀에 키 없음');

/* ===================== v1.3 — 수출입 오류점수 분석(기획자 메일 「4. 수출입통관오류점수분석」) ===================== */
var v12 = passed + failed;
var ES = require('../js/errscore.js');
eq(ES.campusOf('4390826000001M'), '울산', '43908 → 울산'); eq(ES.campusOf('4215826000001M'), '인천', '그 밖 → 인천'); eq(ES.campusOf('없음'), null, '신고번호가 아니면 없음');
eq(ES.campusOf('9999926000001M', { ulsan: ['43908', '99999'] }), '울산', '부호 목록을 바꾼다');
eq(ES.parseDeclNo('4215826604300M').kind, '수입', 'M = 수입'); eq(ES.parseDeclNo('4390826007806X').kind, '수출', 'X = 수출'); eq(ES.parseDeclNo('2237126813187X').seq, '813187', '고유번호 6자리'); eq(ES.parseDeclNo('42158-26-604300M').broker, '42158', '구분선'); 
eq(ES.parseDeclNo('4215826604300M').year, 2026, '신고년도'); eq(ES.monthOfName('귀책사유자별오류상세목록_9월 '), 9, '시트 이름의 월'); eq(ES.classifySheet('귀책사유자별오류현황목록_9월'), 'status', '현황'); eq(ES.classifySheet('귀책사유자별오류상세목록_9월'), 'detail', '상세'); eq(ES.classifySheet('요약'), 'summary', '요약');
// 실제 파일과 같은 모양(값은 가짜)
var HD = ['No', '귀책사유자부호', '신고번호', '란번호', '정정일자 및 시간', '수리구분', '정정구분', '항목코드', '항목명', '오류점수', '변경 후 오류점수', '정정전내역', '정정후내역'];
var IMP = { name: '테스트.xlsx', sheets: [
  { name: '요약', aoa: [['▣ 2026년 수입오류점수 현황'], ['구분', '9월', '', '', '', '8월', '', '', '', '합계'], ['', '수입건수', '오류건수', '오류점수', '비율', '수입건수', '오류건수', '오류점수', '비율'], ['종합', 1000, 3, 12.5, 0.0125, 800, 0, 0, 0], [], ['인천', 600, 1, 2, 0.003, 500, 0, 0, 0], ['울산', 400, 2, 10.5, 0.026, 300, 0, 0, 0]] },
  { name: '귀책사유자별오류현황목록_9월', aoa: [['No', '귀책사유자부호', '귀책사유자상호', '관할지세관부호', '관할지세관', '총신고건', '오류점수', '비율'], [1, '가짜', '가짜(주)', '012', '세관', 1000, 12.5, 1.3]] },
  { name: '귀책사유자별오류상세목록_9월', aoa: [HD, [1, '가짜', '4390826000001M', 0, '2026-09-14  14:53:05', '수리후', '정정', 'A807', '결제금액', 5, 5, '10', '20'], [2, '가짜', '4390826000001M', 0, '2026-09-14  14:53:05', '수리후', '정정', 'A809', '과세가격원화총액', 5.5, 5.5, '1', '2'], [3, '가짜', '4390826000002M', 0, '2026-09-20', '수리전', '정정', 'A807', '결제금액', 0, 0, '1', '2'], [4, '가짜', '4215826000003M', 0, '2026-09-21', '수리후', '정정', 'A100', '관세', 2, 2, '3', '4'], ['합계', '', '', '', '', '', '', '', '', '', '', '', '']] },
  { name: '귀책사유자별오류현황목록_8월', aoa: [['No', '총신고건', '오류점수'], [1, 800, 0]] },
  { name: '귀책사유자별오류상세목록_8월', aoa: [] }
] };
var B = ES.readWorkbook(IMP.sheets, IMP.name);
eq(B.kind, '수입', '요약 제목으로 수입 판정'); eq(B.rows.length, 4, '상세 4줄'); eq(B.notes, [], '빈 시트는 알림 없음'); eq(B.skipped, 1, '합계 줄 건너뜀'); eq(B.months, [9], '오류 있는 달'); eq(B.status[9].total, 1000, '총신고건'); eq(B.hand[9].인천.decl, 600, '요약의 인천 건수'); eq(B.hand[9].울산.score, 10.5, '요약의 울산 점수');
eq(ES.readWorkbook([{ name: '귀책사유자별오류상세목록_1월', aoa: [HD, [1, '', '4390826000001X', 0, '2026-01-02', '', '', '', '품명', 1, 1, '', '']] }], '무명.xlsx').kind, '수출', '끝 글자로 수출 판정');
eq(ES.readWorkbook([{ name: 'S', aoa: [['a'], [1]] }], 'x.xlsx').rows.length, 0, '상세 없으면 0줄'); has(ES.readWorkbook([{ name: 'S', aoa: [['a'], [1]] }], 'x.xlsx').notes[0], '상세목록', '상세 없음 알림');
var S = ES.summarize([B], ES.countsFromBooks([B])), M9 = S.kinds.수입.months[9];
eq(M9.종합, { decl: 1000, err: 3, score: 12.5, rate: 1.25 }, '종합: 동일 신고번호 1건 · 비율 = 점수 ÷ 건수');
eq(M9.인천, { decl: 600, err: 1, score: 2, rate: 0.33 }, '인천 건수는 요약에서'); eq(M9.울산, { decl: 400, err: 2, score: 10.5, rate: 2.63 }, '울산 = 총신고건 − 인천');
var S0 = ES.summarize([B], {}); eq(S0.kinds.수입.months[9].인천.decl, null, '인천 건수를 모르면 비움(짐작 금지)'); eq(S0.kinds.수입.months[9].인천.rate, null, '비율도 비움'); eq(S0.kinds.수입.months[9].종합.decl, 1000, '종합은 현황에서'); eq(S0.kinds.수입.months[9].울산.decl, null, '인천을 모르면 울산 건수도 비움');
var CMP = ES.compare([B], S); eq(CMP.scoreDiffs.length, 0, '대조: 점수 같음'); 
var B2 = JSON.parse(JSON.stringify(B)); B2.hand[9].인천.score = 7; var C2 = ES.compare([B2], S); eq(C2.scoreDiffs.length, 1, '대조: 어긋난 칸을 잡는다'); eq(C2.scoreDiffs[0].scoreDiff, -5, '차이 값');
ES.applyRule([B2], { ulsan: ['43908', '42158'] }); eq(ES.summarize([B2], {}).kinds.수입.months[9].인천.score, 0, '부호를 바꾸면 다시 나뉜다');
eq(ES.brokers(B.rows).map(function (x) { return [x.broker, x.err, x.score, x.campus]; }), [['42158', 1, 2, '인천'], ['43908', 2, 10.5, '울산']], '부호별 표');
// 분기
var qs = ES.quarters(S, 10); var q3 = qs.filter(function (q) { return q.kind === '수입' && q.campus === '울산' && q.q === 3; })[0]; eq(q3.score, 10.5, '3분기 울산'); eq(q3.over, true, '경계 이상'); var q4 = ES.quarters(S, 11).filter(function (q) { return q.kind === '수입' && q.campus === '울산'; })[0]; eq([q4.over, q4.near], [false, true], '80% 이상'); eq(ES.quarters(S, 10.5).filter(function (q) { return q.kind === '수입' && q.campus === '울산'; })[0].over, true, '경계와 같으면 이상');
eq(ES.THRESHOLD, 300, '기본 경계 300'); eq(S.quarters[0].threshold, 300, '기본값 적용');
// 항목 · 신고번호 · 대장
var TI = ES.topItems(B.rows); eq(TI[0].item, '과세가격원화총액', '점수 큰 항목 먼저'); eq(TI.filter(function (t) { return t.item === '결제금액'; })[0].err, 2, '항목의 신고번호 수'); eq(TI[0].share, 44, '비중');
var DC = ES.byDecl(B.rows); eq(DC.length, 3, '신고번호 3건'); eq(DC[0].score, 10.5, '점수 큰 순'); eq(DC[0].fixedAt, '2026-09-14', '정정일'); 
var LD = ES.ledger(DC, {}); eq(LD.length, 2, '0점 신고는 대장에서 뺀다'); eq(LD[0].length, ES.LEDGER_HEAD.length, '대장 칸 수'); has(LD[0][7], '결제금액 10 → 20', '사유가 비면 정정 내역'); eq(ES.ledger(DC, { '4390826000001M': { reason: '단가 오기', blame: '화주' } })[0][7], '단가 오기', '사유를 적으면 그 글'); eq(ES.ledger(DC, {}, { all: true }).length, 3, '전체 보기');
// 메일 — 기획자 메일의 1) 줄은 인천 기준
var ML = ES.mailDraft(S, 9, { top: TI }); eq(ML.subject, '(9월) 수출입 오류점수 현황 및 오류관리대장 공유', '제목');
has(ML.body, '(오류점수) 2점 =>', '1) 줄은 인천'); has(ML.body, '수입(인천) : (신고건수) 600건, (오류건수) 1건, (오류점수) 2점, (오류비율) 0.3%', '수입 인천 줄'); has(ML.body, '울산캠퍼스 9월 수입오류 점수는 10.5점', '울산 줄'); has(ML.body, '과세가격원화총액', '항목'); has(ML.body, '수출신고후 7일이내', 'Next Step');
var EB = ES.exportBook({ summary: S, rows: B.rows, decls: DC, notes: {} }); eq(EB.map(function (x) { return x.name; }), ['오류점수요약', '발생사유및정정내용', '분기', '항목별', '상세'], '엑셀 시트'); eq(EB[4].aoa.length, 5, '상세 줄');
// 예제
var SB = ES.sampleBooks().map(function (b) { return ES.readWorkbook(b.sheets, b.name); }); eq(SB.map(function (b) { return b.kind; }), ['수입', '수출'], '예제 2권'); var SS = ES.summarize(SB, ES.countsFromBooks(SB)); eq(SS.months, [7, 8, 9], '예제 3개월'); var SC = ES.compare(SB, SS); eq(SC.scoreDiffs.length, 2, '예제의 어긋난 달 인천·울산 2칸'); not(JSON.stringify(SB), '에이치디', '예제에 회사 이름 없음');

/* ───────────── v1.4 워드(.docx) 내보내기 ───────────── */
var v13 = passed + failed;
(function () {
  var Doc = D;
  var items = Doc.normalize(Doc.sample()).items;
  var en = items.map(function (it) { var d = Doc.draft(it); return { item: it, check: Doc.check(it), sections: d.sections }; });
  var xml = Doc.docxDocument(en), plain = xml.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n');
  ok(/^<\?xml[^>]*\?><w:document /.test(xml) && /<\/w:body><\/w:document>$/.test(xml), 'v1.4 문서 XML 머리 · 꼬리');
  ok((xml.match(/<w:p>/g) || []).length === (xml.match(/<\/w:p>/g) || []).length && (xml.match(/<w:r>/g) || []).length === (xml.match(/<\/w:r>/g) || []).length, 'v1.4 여는 태그와 닫는 태그 수가 같다');
  ok((plain.match(/물 품 설 명 서/g) || []).length === 3 && (xml.match(/<w:pageBreakBefore\/>/g) || []).length === 2, 'v1.4 부품 3건 — 제목 3번, 둘째부터 새 쪽');
  ['1. 품명(모델, 규격 등 포함)', '2. 구조 및 형태', '3. 기능 및 용도', '4. 성분(함량) 및 제조공정', '5. 제출서류 목록', '6. 품목분류 의견'].forEach(function (h) { ok(plain.split(h).length === 4, 'v1.4 절 제목 「' + h + '」가 부품마다'); });
  ok(/<w:sz w:val="40"\/>/.test(xml) && /<w:sz w:val="32"\/>/.test(xml) && /<w:sz w:val="24"\/>/.test(xml) && /<w:jc w:val="center"\/>/.test(xml), 'v1.4 양식 글자 크기 — 제목 20pt · 절 16pt · 본문 12pt, 제목 가운데');
  ok(/w:w="11906" w:h="16838"/.test(xml) && /w:top="1701" w:right="1440" w:bottom="1440" w:left="1440"/.test(xml), 'v1.4 A4 · 양식과 같은 여백');
  ok(plain.indexOf('☞ Invoice 품명, 거래품명, 상표명, 모델, 타입, 규격, HS CODE 등') > 0 && (plain.match(/☞ /g) || []).length === 3 * 10, 'v1.4 양식의 작성 안내 줄(부품마다 10줄)');
  ok((Doc.docxDocument(en, null, { guide: false }).match(/☞/g) || []).length === 0, 'v1.4 작성 안내 줄을 뺄 수 있다');
  var e0 = en[0], st = e0.sections[0].text;
  ok(plain.indexOf(st.split('\n')[0]) > 0 && plain.indexOf('품명 : ' + e0.item.name) > 0 && plain.indexOf('HS 후보(검토 필요) : ') > 0, 'v1.4 초안 문장 · 품명 · HS 후보가 그대로 들어간다');
  var ed = [{ item: Object.assign({}, e0.item, { name: 'A & B <테스트>', brand: '', size: '' }), check: e0.check, sections: e0.sections.map(function (s, i) { return i ? s : Object.assign({}, s, { text: '첫 줄\n\n셋째 줄 <b> & 끝', source: 'ai' }); }) }];
  var x2 = Doc.docxDocument(ed, { opinion: '세번 검토 의견' });
  ok(/A &amp; B &lt;테스트&gt;/.test(x2) && /셋째 줄 &lt;b&gt; &amp; 끝/.test(x2) && !/<b>/.test(x2), 'v1.4 & < > 는 글자로 넣는다(문서가 깨지지 않게)');
  ok(/>첫 줄<\/w:t><\/w:r><\/w:p><w:p><w:pPr>[^]*?<\/w:pPr><\/w:p><w:p>[^]*?셋째 줄/.test(x2), 'v1.4 줄바꿈은 문단으로, 빈 줄도 남긴다');
  ok(/AI 초안 반영 — 검토 필요/.test(x2) && /6\. 세번 검토 의견/.test(x2) && !/상표 : /.test(x2) && !/규격 : /.test(x2), 'v1.4 AI 반영 표시 · 바꾼 칸 이름 · 빈 값은 줄을 만들지 않는다');
  var miss = Doc.normalize([{ 관리번호: 'M-1', 품명: '이름만' }]).items, em = miss.map(function (it) { var d = Doc.draft(it); return { item: it, check: Doc.check(it), sections: d.sections }; });
  ok(/누락 \d+건\(/.test(Doc.docxDocument(em)) && /\[확인 필요/.test(Doc.docxDocument(em)), 'v1.4 누락 건수와 「확인 필요」 표시가 워드에도 남는다');
  var f = Doc.docxFiles(en);
  eq(Object.keys(f).sort(), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'], 'v1.4 docx 안의 파일 5개');
  ok(/맑은 고딕/.test(f['word/styles.xml']) && /word\/document\.xml/.test(f['[Content_Types].xml']) && !/\d+(\.\d+)?\s*%/.test(f['word/document.xml'].replace(/<[^>]+>/g, '')), 'v1.4 글꼴 맑은 고딕 · 관세율 수치 없음');
  ok(Doc.docxDocument([]).indexOf('<w:sectPr>') > 0, 'v1.4 부품이 없어도 열리는 문서');
})();
console.log('v1.4 ' + (passed + failed - v13) + '개 검사');
console.log('v1.3 ' + (v13 - v12) + '개 검사');
console.log('v1.0 ' + v10 + ' · v1.1 ' + (v11 - v10) + ' · v1.2 ' + (v12 - v11) + '개 검사');
console.log('\n통과 ' + passed + ' · 실패 ' + failed);
process.exit(failed ? 1 : 0);
