/* 수입보세화물 Tracking — 엔진 (v1.2)
 *
 * 화면(track.js)은 판정하지 않는다. 처리단계 이름 읽기·유니패스 조회 결과(XML) 읽기·ERP 엑셀 열 짝짓기·
 * 새 단계 찾기·시간 외 판정·알림 대상 고르기·메일 초안·엑셀 표는 전부 여기서 만들고 test/logic.test.js 로 고정한다.
 * 브라우저(window.Cargo)와 node(require) 양쪽에서 읽힌다.
 *
 * 지키는 것
 *   - 메일을 보내지 않는다. 초안을 만들고 메일 앱으로 넘길 뿐이다(mailto). 보내는 것은 사람이다.
 *   - 관세청 유니패스에 몰래 접속하지 않는다. 조회 결과를 붙여 넣거나, 키를 넣은 사람이 「조회」를 눌렀을 때만 부른다.
 *   - 같은 단계를 두 번 알리지 않는다. 통보한 단계는 BL · 단계 · 처리일시로 기억한다.
 *   - 처리단계 이름이 달라도 받는다. 늘릴 때는 코드가 아니라 STAGES 의 aliases 표를 늘린다.
 *   - 인증키는 화면에 보이지 않게 가린다(maskKey). 엑셀 내보내기에도 넣지 않는다.
 */
(function (root) {
  'use strict';

  /* ---------- 처리단계 ---------- */
  // 유니패스 「수입화물 진행정보」의 처리구분 이름을 단계 키로 옮긴다. 긴 별칭부터 맞춘다(「수입신고 수리」가 「수입신고」에 먼저 걸리지 않게).
  var STAGES = [
    { key: 'arrival', label: '입항보고 제출', order: 1, aliases: ['입항보고제출', '입항보고 수리', '입항보고수리', '입항보고', '입항'] },
    { key: 'unload', label: '하선신고', order: 2, aliases: ['하선신고 수리', '하선신고수리', '하선신고 제출', '하선신고제출', '하기신고', '하선'] },
    { key: 'in', label: '반입신고', order: 3, aliases: ['반입신고 수리', '반입신고수리', '보세구역 반입', '보세구역반입', '반입'] },
    { key: 'declared', label: '수입신고', order: 4, aliases: ['수입신고 제출', '수입신고제출', '수입신고서 제출', '수입(사용소비)신고', '수입신고접수'] },
    { key: 'cleared', label: '수입신고 수리', order: 5, aliases: ['수입신고수리', '신고수리', '수리', '통관완료', '통관 완료'] },
    { key: 'out', label: '반출신고', order: 6, aliases: ['반출신고 수리', '반출신고수리', '보세구역 반출', '보세구역반출', '반출'] }
  ];
  var BYKEY = {}; STAGES.forEach(function (s) { BYKEY[s.key] = s; });
  var DEFAULT_TARGETS = ['arrival', 'declared'];     // 기획: 「입항보고제출과 수입신고 표시 시 관세사와 요청자에게 전달」
  function normText(s) { return String(s == null ? '' : s).replace(/[\s()\[\]·_\-/.]/g, '').toLowerCase(); }
  function classifyStage(text) {
    var t = normText(text); if (!t) return { key: 'other', label: '', order: 0 };
    var best = null;
    STAGES.forEach(function (s) {
      [s.label].concat(s.aliases).forEach(function (a) {
        var n = normText(a);
        if (n && (t === n || t.indexOf(n) >= 0) && (!best || n.length > best.len)) best = { s: s, len: n.length };
      });
    });
    if (!best) return { key: 'other', label: String(text).trim(), order: 0 };
    return { key: best.s.key, label: best.s.label, order: best.s.order };
  }
  function stageLabel(key) { return BYKEY[key] ? BYKEY[key].label : key; }

  /* ---------- 값 읽기 ---------- */
  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDT(y, m, d, hh, mm) {
    if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    if (!(hh >= 0 && hh <= 23) || !(mm >= 0 && mm <= 59)) return null;
    return y + '-' + pad2(m) + '-' + pad2(d) + ' ' + pad2(hh) + ':' + pad2(mm);
  }
  // 「20261103194000」 · 「2026-11-03 19:40」 · 「2026.11.03 19:40:12」 · 「2026/11/03」(시각 없으면 00:00) · 엑셀 일련번호(소수는 시각) · Date
  function parseDateTime(v) {
    if (v instanceof Date) return isNaN(v) ? null : fmtDT(v.getFullYear(), v.getMonth() + 1, v.getDate(), v.getHours(), v.getMinutes());
    if (typeof v === 'number') {
      if (v >= 20000 && v < 80000) { var t = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)); return fmtDT(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes()); }
      v = String(v);
    }
    var s = clean(v); if (!s) return null;
    var m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/);
    if (m) return fmtDT(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
    m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?(?:[\sT]*(\d{1,2})\s*[:시]\s*(\d{1,2})?)?/);
    if (m) return fmtDT(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
    if (/^\d+(\.\d+)?$/.test(s)) return parseDateTime(Number(s));
    return null;
  }
  function parseDate(v) { var t = parseDateTime(v); return t ? t.slice(0, 10) : null; }
  function normBL(s) { return clean(s).toUpperCase().replace(/[\s\-/]/g, ''); }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function splitEmails(s) { return clean(s).split(/[,;\s]+/).filter(Boolean); }

  /* ---------- 시간 외 ---------- */
  // 퇴근 후(18:00 이후)·출근 전(09:00 전)·토·일은 「시간 외」. 공휴일은 모른다 — 달력을 넣지 않았다.
  var DEFAULT_HOURS = { start: '09:00', end: '18:00', weekend: true };
  function isAfterHours(at, hours) {
    hours = hours || DEFAULT_HOURS;
    var m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/); if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]), dow = d.getDay(), hm = m[4] + ':' + m[5];
    if (hours.weekend !== false && (dow === 0 || dow === 6)) return true;
    return hm < (hours.start || '09:00') || hm >= (hours.end || '18:00');
  }

  /* ---------- 화물(BL) 목록 ---------- */
  // item = { id, bl, ship, eta, requester:{name,email}, broker:{name,email}, memo, createdAt, events:[{key,label,at,place,raw}], notified:{ 'key@at': 시각 } }
  function validate(e, list, selfId) {
    var errors = [], bl = normBL(e.bl);
    if (!bl) errors.push('BL 번호를 적어 주세요.');
    else if ((list || []).some(function (x) { return x.bl === bl && x.id !== selfId; })) errors.push('이미 등록된 BL 번호입니다: ' + bl);
    [['requester', '요청자'], ['broker', '관세사']].forEach(function (p) {
      var em = e[p[0]] && e[p[0]].email ? splitEmails(e[p[0]].email) : [];
      em.forEach(function (x) { if (!EMAIL_RE.test(x)) errors.push(p[1] + ' 메일 주소 형식이 아닙니다: ' + x); });
    });
    if (e.eta && !parseDate(e.eta)) errors.push('입항예정일을 날짜로 읽지 못했습니다: ' + clean(e.eta));
    return errors;
  }
  function nextId(list) { var n = 0; (list || []).forEach(function (x) { var k = +String(x.id).replace(/\D/g, ''); if (k > n) n = k; }); return 'S' + String(n + 1).padStart(3, '0'); }
  function makeItem(e, list, now) {
    return {
      id: nextId(list), bl: normBL(e.bl), ship: clean(e.ship), eta: e.eta ? parseDate(e.eta) : '',
      requester: { name: clean(e.requester && e.requester.name), email: clean(e.requester && e.requester.email) },
      broker: { name: clean(e.broker && e.broker.name), email: clean(e.broker && e.broker.email) },
      memo: clean(e.memo), createdAt: (now || '').slice(0, 16), events: [], notified: {}
    };
  }
  function add(list, e, now) {
    var errors = validate(e, list);
    if (errors.length) return { list: list, errors: errors, item: null };
    var item = makeItem(e, list, now);
    return { list: (list || []).concat([item]), errors: [], item: item };
  }
  function remove(list, id) { return (list || []).filter(function (x) { return x.id !== id; }); }
  function find(list, bl) { var n = normBL(bl); return (list || []).filter(function (x) { return x.bl === n; })[0] || null; }

  /* ---------- 단계 반영 ---------- */
  // events: [{ bl, stage(원문), at, place, ship, eta, requester, broker }] → 목록에 새 단계를 더한다.
  // 같은 BL · 같은 단계 · 같은 처리일시는 두 번 넣지 않는다. 모르는 BL 은 autoAdd 면 새로 만든다.
  function evKey(ev) { return (ev.key === 'other' ? 'other:' + normText(ev.raw || ev.label) : ev.key) + '@' + ev.at; }
  function merge(list, events, now, opts) {
    opts = opts || {};
    var out = (list || []).map(function (x) { return Object.assign({}, x, { events: x.events.slice(), notified: Object.assign({}, x.notified) }); });
    var added = [], skipped = [], created = [];
    (events || []).forEach(function (e, i) {
      var bl = normBL(e.bl), at = parseDateTime(e.at), st = classifyStage(e.stage);
      if (!bl) { skipped.push({ row: e.row || i + 1, reason: 'BL 번호 없음' }); return; }
      if (!at) { skipped.push({ row: e.row || i + 1, reason: '처리일시를 읽지 못함: ' + clean(e.at) }); return; }
      if (!clean(e.stage)) { skipped.push({ row: e.row || i + 1, reason: '처리단계 없음' }); return; }
      var it = out.filter(function (x) { return x.bl === bl; })[0];
      if (!it) {
        if (opts.autoAdd === false) { skipped.push({ row: e.row || i + 1, reason: '등록되지 않은 BL: ' + bl }); return; }
        it = makeItem({ bl: bl, ship: e.ship, eta: e.eta, requester: { name: e.requester }, broker: { name: e.broker } }, out, now); out.push(it); created.push(bl);
      }
      if (!it.ship && clean(e.ship)) it.ship = clean(e.ship);
      if (!it.eta && e.eta && parseDate(e.eta)) it.eta = parseDate(e.eta);
      var ev = { key: st.key, label: st.key === 'other' ? clean(e.stage) : st.label, at: at, place: clean(e.place), raw: clean(e.stage) };
      if (it.events.some(function (x) { return evKey(x) === evKey(ev); })) return;
      it.events.push(ev); it.events.sort(byAt);
      added.push({ id: it.id, bl: bl, key: ev.key, label: ev.label, at: at });
    });
    return { list: out, added: added, skipped: skipped, created: created };
  }
  function byAt(a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : (BYKEY[a.key] ? BYKEY[a.key].order : 0) - (BYKEY[b.key] ? BYKEY[b.key].order : 0); }
  function latest(item) { return item.events.length ? item.events[item.events.length - 1] : null; }
  // 진행: 알려진 단계 중 가장 앞선 순서 / 6
  function progress(item) {
    var o = 0; item.events.forEach(function (e) { var s = BYKEY[e.key]; if (s && s.order > o) o = s.order; });
    return { order: o, total: STAGES.length, pct: o / STAGES.length, done: STAGES.map(function (s) { return item.events.some(function (e) { return e.key === s.key; }); }) };
  }

  /* ---------- 알림 ---------- */
  // targets 에 든 단계 중 아직 통보하지 않은 것. 최근 것부터.
  function alerts(list, targets, hours) {
    targets = targets || DEFAULT_TARGETS;
    var out = [];
    (list || []).forEach(function (it) {
      it.events.forEach(function (ev) {
        if (targets.indexOf(ev.key) < 0) return;
        var k = evKey(ev); if (it.notified && it.notified[k]) return;
        out.push({ id: it.id, bl: it.bl, ship: it.ship, key: ev.key, label: ev.label, at: ev.at, place: ev.place, afterHours: isAfterHours(ev.at, hours), evKey: k,
          hasMail: !!(it.broker.email || it.requester.email) });
      });
    });
    return out.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  }
  function markNotified(list, id, evk, now) {
    return (list || []).map(function (x) { if (x.id !== id) return x; var n = Object.assign({}, x.notified); n[evk] = (now || '').slice(0, 16) || true; return Object.assign({}, x, { notified: n }); });
  }
  function notifiedCount(item) { return Object.keys(item.notified || {}).length; }

  /* ---------- 메일 초안 ---------- */
  // 변수: {BL} {선명} {단계} {처리일시} {장치장} {요청자} {관세사} {입항예정} {메모} {보낸사람}
  var VARS = ['BL', '선명', '단계', '처리일시', '장치장', '요청자', '관세사', '입항예정', '메모', '보낸사람'];
  var DEFAULT_TEMPLATES = {
    arrival: {
      subject: '[입항 안내] BL {BL} 입항보고 제출 — {처리일시}',
      body: '{관세사} 님, {요청자} 님\n\nBL {BL}({선명}) 화물의 입항보고가 제출되었습니다.\n- 처리일시: {처리일시}\n- 장치장: {장치장}\n- 입항예정: {입항예정}\n\n통관 요청 건이므로 수입신고 준비를 부탁드립니다.\n{메모}\n\n{보낸사람} 드림'
    },
    declared: {
      subject: '[수입신고 안내] BL {BL} 수입신고 — {처리일시}',
      body: '{관세사} 님, {요청자} 님\n\nBL {BL}({선명}) 화물의 수입신고가 접수되었습니다.\n- 처리일시: {처리일시}\n- 장치장: {장치장}\n\n수리 뒤 반출 일정은 다시 안내드리겠습니다.\n{메모}\n\n{보낸사람} 드림'
    },
    other: {
      subject: '[통관 진행 안내] BL {BL} {단계} — {처리일시}',
      body: '{관세사} 님, {요청자} 님\n\nBL {BL}({선명}) 화물이 「{단계}」 단계로 처리되었습니다.\n- 처리일시: {처리일시}\n- 장치장: {장치장}\n{메모}\n\n{보낸사람} 드림'
    }
  };
  function mergeTemplates(custom) {
    var out = {};
    Object.keys(DEFAULT_TEMPLATES).forEach(function (k) {
      var c = custom && custom[k] || {};
      out[k] = { subject: clean(c.subject) || DEFAULT_TEMPLATES[k].subject, body: (c.body && String(c.body).trim()) ? String(c.body) : DEFAULT_TEMPLATES[k].body };
    });
    return out;
  }
  function fill(tpl, vars) {
    var missing = {};
    var text = String(tpl || '').replace(/\{([^{}]+)\}/g, function (m, k) {
      if (!Object.prototype.hasOwnProperty.call(vars, k)) return m;        // 모르는 이름은 그대로 둔다
      var v = clean(vars[k]); if (!v) missing[k] = true; return v;
    });
    return { text: text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'), missing: Object.keys(missing) };
  }
  function varsOf(item, ev, sender) {
    return { BL: item.bl, '선명': item.ship, '단계': ev.label, '처리일시': ev.at, '장치장': ev.place, '요청자': item.requester.name, '관세사': item.broker.name,
      '입항예정': item.eta, '메모': item.memo, '보낸사람': sender || '' };
  }
  function mailDraft(item, ev, templates, sender) {
    var T = mergeTemplates(templates), t = T[ev.key] || T.other, v = varsOf(item, ev, sender);
    var s = fill(t.subject, v), b = fill(t.body, v);
    var to = splitEmails(item.broker.email).concat(splitEmails(item.requester.email)).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var missing = s.missing.concat(b.missing).filter(function (x, i, a) { return a.indexOf(x) === i && x !== '메모'; });
    return { to: to, subject: s.text, body: b.text, missing: missing,
      mailto: 'mailto:' + to.join(',') + '?subject=' + encodeURIComponent(s.text) + '&body=' + encodeURIComponent(b.text) };
  }
  function kakaoText(item, ev) { return '[통관] BL ' + item.bl + (item.ship ? '(' + item.ship + ')' : '') + ' ' + ev.label + ' ' + ev.at + (ev.place ? ' · ' + ev.place : ''); }

  /* ---------- 유니패스 조회 결과(XML) ---------- */
  // 관세청 OpenAPI 「수입화물 진행정보 조회」 응답. 태그 이름은 연계가이드마다 다를 수 있어 표로 둔다 — 늘릴 때는 이 표를 늘린다.
  var TAGS = {
    detail: ['cargCsclPrgsInfoDtlQryVo', 'dtlQryVo', 'row', 'item'],     // 대소문자는 가리지 않는다 · 앞의 이름으로 찾으면 뒤는 보지 않는다
    time: ['prcsDttm', 'prcsDt', 'rlbrDttm', 'prcsDtm', '처리일시'],
    stage: ['cargTrcnRelaBsopTpcd', 'prcsStts', 'csclPrgsStts', 'bsopTpcd', '처리단계', '처리구분'],
    place: ['shedNm', 'shedSgn', '장치장명', '장치장'],
    bl: ['hblNo', 'mblNo', 'blNo', 'BL번호'],
    ship: ['shipNm', 'vsslNm', '선명'],
    eta: ['etprDt', 'etprDttm', '입항일'],
    status: ['prgsStts', 'csclPrgsStts', '진행상태'],
    count: ['tCnt', 'totalCount'],
    error: ['ntceInfo', 'errMsg', 'resultMsg']
  };
  function tagVal(xml, names) {
    for (var i = 0; i < names.length; i++) {
      var m = String(xml).match(new RegExp('<' + names[i] + '(?:\\s[^>]*)?>([^<]*)<\\/' + names[i] + '>', 'i'));
      if (m && clean(m[1])) return clean(m[1]).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }
    return '';
  }
  function parseUnipassXML(xml) {
    var s = String(xml || '').trim();
    if (!s) return { error: '붙여 넣은 내용이 없습니다.', events: [] };
    if (s[0] !== '<') return { error: 'XML 이 아닙니다. 유니패스 OpenAPI 응답(XML)을 그대로 붙여 넣어 주세요.', events: [] };
    var details = [], rest = s;
    for (var ti = 0; ti < TAGS.detail.length && !details.length; ti++) {
      var re = new RegExp('<' + TAGS.detail[ti] + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + TAGS.detail[ti] + '>', 'gi'), m;
      while ((m = re.exec(s))) { details.push(m[1]); }
      if (details.length) rest = rest.replace(re, '');
    }
    var head = { bl: tagVal(rest, TAGS.bl), ship: tagVal(rest, TAGS.ship), eta: tagVal(rest, TAGS.eta), status: tagVal(rest, TAGS.status), error: tagVal(rest, TAGS.error) };
    var events = details.map(function (d, i) {
      return { bl: head.bl || tagVal(d, TAGS.bl), stage: tagVal(d, TAGS.stage), at: tagVal(d, TAGS.time), place: tagVal(d, TAGS.place), ship: head.ship, eta: head.eta, row: i + 1 };
    }).filter(function (e) { return e.stage || e.at; });
    var cnt = tagVal(s, TAGS.count);
    if (!events.length) return { bl: head.bl, ship: head.ship, eta: head.eta, status: head.status, events: [], error: head.error || (cnt === '0' ? '조회 결과가 0건입니다(BL 번호·연도를 확인해 주세요).' : '진행 단계 항목을 찾지 못했습니다. 응답 전체를 붙여 넣었는지 확인해 주세요.') };
    return { bl: head.bl, ship: head.ship, eta: head.eta, status: head.status, events: events, error: head.error && !events.length ? head.error : '' };
  }
  // 조회 주소 — 키를 넣은 사람이 「조회」를 눌렀을 때만 쓴다. 로그·화면에는 maskKey 로 가린다.
  var API_BASE = 'https://unipass.customs.go.kr:38010/ext/rest/cargCsclPrgsInfoQry/retrieveCargCsclPrgsInfo';
  function apiUrl(o) {
    var bl = normBL(o.bl), kind = o.kind === 'mbl' ? 'mblNo' : 'hblNo';
    var year = /^\d{4}$/.test(String(o.year || '')) ? String(o.year) : String(new Date().getFullYear());
    return API_BASE + '?crkyCn=' + encodeURIComponent(clean(o.key)) + '&' + kind + '=' + encodeURIComponent(bl) + '&blYy=' + year;
  }
  function maskKey(url) { return String(url).replace(/(crkyCn=)([^&]*)/, function (m, a, b) { return a + (b.length > 4 ? b.slice(0, 2) + '…' + b.slice(-2) : '****'); }); }

  /* ---------- ERP 엑셀(수입화물 진행현황) ---------- */
  var EFIELDS = [
    { key: 'bl', label: 'BL 번호', req: true, aliases: ['bl번호', 'blno', 'bl', 'hbl', 'hblno', 'mbl', 'mblno', 'b/l번호', '하우스bl', '선하증권번호', '화물관리번호'] },
    { key: 'stage', label: '처리단계', req: true, aliases: ['진행단계', '처리구분', '진행상태', '처리상태', '상태', '단계', '통관단계', '화물진행상태'] },
    { key: 'at', label: '처리일시', req: true, aliases: ['처리일자', '처리시각', '일시', '처리일', '발생일시', '진행일시', '등록일시'] },
    { key: 'place', label: '장치장', aliases: ['장치장명', '보세구역', '보세구역명', '창고', '장치장소'] },
    { key: 'ship', label: '선명', aliases: ['선박명', '선기명', '선박', 'vessel'] },
    { key: 'eta', label: '입항예정일', aliases: ['입항예정', '입항일', '입항예정일시', 'eta', '도착예정일'] },
    { key: 'requester', label: '요청자', aliases: ['현업담당', '현업담당자', '담당자', '요청부서', '통관요청자'] },
    { key: 'broker', label: '관세사', aliases: ['통관관세사', '관세사명', '관세법인'] }
  ];
  function mapHeaders(headers) {
    var map = {}, used = {};
    // 같은 이름 → 같은 뜻 낱말 → 낱말 포함, 순서대로. 한 열은 한 번만.
    [function (h, f) { return normText(h) === normText(f.label); }, function (h, f) { return f.aliases.some(function (a) { return normText(h) === normText(a); }); },
      function (h, f) { return [f.label].concat(f.aliases).some(function (a) { var n = normText(a); return n.length >= 2 && normText(h).indexOf(n) >= 0; }); }]
      .forEach(function (test) {
        EFIELDS.forEach(function (f) { if (map[f.key]) return; (headers || []).forEach(function (h) { if (!map[f.key] && !used[h] && clean(h) && test(h, f)) { map[f.key] = h; used[h] = true; } }); });
      });
    return { map: map, missing: EFIELDS.filter(function (f) { return f.req && !map[f.key]; }).map(function (f) { return f.label; }) };
  }
  function eventsFromRows(rows, map) {
    var out = [];
    (rows || []).forEach(function (r, i) {
      var e = { row: i + 2 }; EFIELDS.forEach(function (f) { if (map[f.key]) e[f.key] = r[map[f.key]]; });
      if (EFIELDS.every(function (f) { return clean(e[f.key]) === ''; })) return;
      out.push(e);
    });
    return out;
  }

  /* ---------- 엑셀 표 ---------- */
  function exportBook(list, targets, hours) {
    var al = alerts(list, targets, hours);
    var stat = [['BL 번호', '선명', '입항예정', '최신 단계', '처리일시', '장치장', '시간 외', '진행(단계/6)', '요청자', '요청자 메일', '관세사', '관세사 메일', '통보한 단계', '미통보 알림', '메모', '등록']];
    (list || []).forEach(function (it) {
      var l = latest(it), p = progress(it);
      stat.push([it.bl, it.ship, it.eta, l ? l.label : '', l ? l.at : '', l ? l.place : '', l ? (isAfterHours(l.at, hours) ? '시간 외' : '') : '', p.order + '/' + p.total,
        it.requester.name, it.requester.email, it.broker.name, it.broker.email, notifiedCount(it), al.filter(function (a) { return a.id === it.id; }).length, it.memo, it.createdAt]);
    });
    var ev = [['BL 번호', '단계', '처리일시', '장치장', '시간 외', '원문', '통보']];
    (list || []).forEach(function (it) { it.events.forEach(function (e) { ev.push([it.bl, e.label, e.at, e.place, isAfterHours(e.at, hours) ? '시간 외' : '', e.raw, it.notified[evKey(e)] ? String(it.notified[evKey(e)]) : '']); }); });
    var an = [['BL 번호', '선명', '단계', '처리일시', '장치장', '시간 외', '메일 주소 있음']].concat(al.map(function (a) { return [a.bl, a.ship, a.label, a.at, a.place, a.afterHours ? '시간 외' : '', a.hasMail ? '있음' : '없음']; }));
    return [{ name: '현황', aoa: stat }, { name: '진행단계', aoa: ev }, { name: '알림', aoa: an }];
  }

  /* ---------- 예제(가짜 BL 3건 — 실제 화물이 아닙니다) ---------- */
  function shift(now, days, hm) { var d = new Date(now.getTime()); d.setDate(d.getDate() + days); var p = hm.split(':'); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + p[0] + ':' + p[1]; }
  function sample(now) {
    now = now || new Date();
    var nowS = shift(now, 0, pad2(now.getHours()) + ':' + pad2(now.getMinutes()));
    var items = [
      { bl: 'GASANG2611001', ship: '가상호(VIRTUAL STAR)', eta: shift(now, -1, '00:00').slice(0, 10), requester: { name: '현업담당(가상)', email: 'req1@example.com' }, broker: { name: '가상관세법인', email: 'broker@example.com' }, memo: '야간 입항 예정 건' },
      { bl: 'GASANG2611002', ship: '가상 2호(VIRTUAL MOON)', eta: shift(now, -3, '00:00').slice(0, 10), requester: { name: '자재담당(가상)', email: 'req2@example.com' }, broker: { name: '가상관세법인', email: 'broker@example.com' }, memo: '' },
      { bl: 'GASANG2611003', ship: '가상 3호(VIRTUAL SUN)', eta: shift(now, 2, '00:00').slice(0, 10), requester: { name: '생산담당(가상)', email: '' }, broker: { name: '가상관세법인', email: 'broker@example.com' }, memo: '요청자 메일 주소 받아야 함' }
    ];
    var list = [];
    items.forEach(function (e) { list = add(list, e, nowS).list; });
    var m = merge(list, [
      { bl: 'GASANG2611001', stage: '입항보고 제출', at: shift(now, -1, '19:40'), place: '가상항 보세구역 A' },
      { bl: 'GASANG2611001', stage: '하선신고 수리', at: shift(now, 0, '07:10'), place: '가상항 보세구역 A' },
      { bl: 'GASANG2611002', stage: '입항보고 제출', at: shift(now, -3, '10:00'), place: '가상항 보세구역 B' },
      { bl: 'GASANG2611002', stage: '하선신고 수리', at: shift(now, -2, '14:20'), place: '가상항 보세구역 B' },
      { bl: 'GASANG2611002', stage: '반입신고 수리', at: shift(now, -2, '16:05'), place: '가상 보세창고' },
      { bl: 'GASANG2611002', stage: '수입신고', at: shift(now, 0, '08:30'), place: '가상 보세창고' }
    ], nowS);
    var out = m.list;
    // 2번 BL 의 입항보고는 이미 통보한 것으로 둔다
    var it2 = out.filter(function (x) { return x.bl === 'GASANG2611002'; })[0];
    out = markNotified(out, it2.id, evKey(it2.events[0]), shift(now, -3, '10:30'));
    return out;
  }
  function sampleXML(now) {
    now = now || new Date();
    return '<cargCsclPrgsInfoQryRtnVo>\n  <tCnt>2</tCnt>\n  <cargCsclPrgsInfoQryVo>\n    <hblNo>GASANG2611003</hblNo>\n    <shipNm>가상 3호(VIRTUAL SUN)</shipNm>\n    <etprDt>' + shift(now, 0, '00:00').slice(0, 10).replace(/-/g, '') + '</etprDt>\n    <prgsStts>반입</prgsStts>\n  </cargCsclPrgsInfoQryVo>\n' +
      '  <cargCsclPrgsInfoDtlQryVo>\n    <prcsDttm>' + shift(now, 0, '06:50').replace(/[-: ]/g, '') + '00</prcsDttm>\n    <cargTrcnRelaBsopTpcd>입항보고 제출</cargTrcnRelaBsopTpcd>\n    <shedNm>가상항 보세구역 C</shedNm>\n  </cargCsclPrgsInfoDtlQryVo>\n' +
      '  <cargCsclPrgsInfoDtlQryVo>\n    <prcsDttm>' + shift(now, 0, '09:15').replace(/[-: ]/g, '') + '00</prcsDttm>\n    <cargTrcnRelaBsopTpcd>하선신고 수리</cargTrcnRelaBsopTpcd>\n    <shedNm>가상항 보세구역 C</shedNm>\n  </cargCsclPrgsInfoDtlQryVo>\n</cargCsclPrgsInfoQryRtnVo>';
  }
  function sampleRows(now) {
    now = now || new Date();
    return [['B/L번호', '선명', '입항예정일', '처리단계', '처리일시', '장치장', '현업담당', '관세사'],
      ['GASANG2611003', '가상 3호(VIRTUAL SUN)', shift(now, 2, '00:00').slice(0, 10), '입항보고 제출', shift(now, 0, '06:50'), '가상항 보세구역 C', '생산담당(가상)', '가상관세법인'],
      ['GASANG2611004', '가상 4호(VIRTUAL SEA)', shift(now, 1, '00:00').slice(0, 10), '입항보고제출', shift(now, -1, '22:15'), '가상항 보세구역 D', '구매담당(가상)', '가상관세법인'],
      ['GASANG2611004', '가상 4호(VIRTUAL SEA)', shift(now, 1, '00:00').slice(0, 10), '수입신고', shift(now, 0, '08:05'), '가상항 보세구역 D', '구매담당(가상)', '가상관세법인']];
  }

  var api = {
    STAGES: STAGES, DEFAULT_TARGETS: DEFAULT_TARGETS, DEFAULT_HOURS: DEFAULT_HOURS, DEFAULT_TEMPLATES: DEFAULT_TEMPLATES, VARS: VARS, EFIELDS: EFIELDS, TAGS: TAGS, API_BASE: API_BASE,
    classifyStage: classifyStage, stageLabel: stageLabel, parseDateTime: parseDateTime, parseDate: parseDate, normBL: normBL, splitEmails: splitEmails, isAfterHours: isAfterHours,
    validate: validate, add: add, remove: remove, find: find, merge: merge, evKey: evKey, latest: latest, progress: progress,
    alerts: alerts, markNotified: markNotified, notifiedCount: notifiedCount,
    mergeTemplates: mergeTemplates, fill: fill, varsOf: varsOf, mailDraft: mailDraft, kakaoText: kakaoText,
    parseUnipassXML: parseUnipassXML, apiUrl: apiUrl, maskKey: maskKey, mapHeaders: mapHeaders, eventsFromRows: eventsFromRows,
    exportBook: exportBook, sample: sample, sampleXML: sampleXML, sampleRows: sampleRows
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cargo = api;
})(this);
