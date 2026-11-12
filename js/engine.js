/* 물품설명서 작성 자동화 — 엔진
 *
 * 화면(app.js)은 판정하지 않는다. 입력 정리·누락 점검·HS 후보 읽기·초안 문장·문체 바꾸기·
 * AI 요청/응답 정리·내보내기 표는 전부 여기서 만들고 test/logic.test.js 로 고정한다.
 * 브라우저(window.Doc)와 node(require) 양쪽에서 읽힌다.
 *
 * 지키는 것
 *   - HS 코드는 언제나 「후보 · 검토 필요」로 쓴다. 단정하지 않는다.
 *   - 관세율 수치는 싣지 않는다. AI 응답에 섞여 오면 지운다(scrubRates).
 *   - 입력에 없는 값은 지어내지 않고 「[확인 필요: 칸 이름]」으로 남긴다.
 *   - 칸 이름(양식 제목·다섯 칸)은 설정으로 바꾼다. 기본값은 기획자가 보낸 물품설명서 양식(2026-11-04, 6절)이다 —
 *     1 품명(머리글) · 2 구조 및 형태 · 3 기능 및 용도 · 4 성분(함량) 및 제조공정 · 5 제출서류 목록 · 6 품목분류 의견.
 */
(function (root) {
  'use strict';

  /* ---------- 입력 칸 ---------- */
  // 열 이름이 조금 달라도 읽는다. 늘릴 때는 코드가 아니라 이 표를 늘린다.
  var FIELDS = [
    { key: 'id', label: '관리번호', aliases: ['번호', 'no', '순번', '관리no'] },
    { key: 'name', label: '품명', req: true, aliases: ['부품명', '물품명', '품목명', 'name', 'item'] },
    { key: 'nameEn', label: '영문 품명', aliases: ['영문품명', '영문명', 'englishname', 'description'] },
    { key: 'brand', label: '상표', aliases: ['상표명', '브랜드', 'brand'] },
    { key: 'model', label: '모델·품번', req: true, aliases: ['모델', '품번', '모델명', 'partno', 'model', 'pn'] },
    { key: 'machine', label: '적용 장비', req: true, aliases: ['적용장비', '적용기종', '장비', '기종', '사용장비'] },
    { key: 'material', label: '재질', req: true, aliases: ['소재', 'material'] },
    { key: 'structure', label: '구조·형태', req: true, aliases: ['구조', '형태', '구조형태', '외형'] },
    { key: 'size', label: '치수·중량', aliases: ['치수', '중량', '크기', '치수중량'] },
    { key: 'function', label: '기능', req: true, aliases: ['작동', 'function', '작동원리'] },
    { key: 'use', label: '용도', req: true, aliases: ['사용처', 'use', 'usage'] },
    { key: 'composition', label: '성분', aliases: ['구성', '성분비', '조성', '구성품'] },
    { key: 'process', label: '제조공정', req: true, aliases: ['공정', '제조방법', 'process'] },
    { key: 'maker', label: '제조사', aliases: ['제조자', '공급사', 'maker', 'manufacturer'] },
    { key: 'origin', label: '원산지', aliases: ['제조국', 'origin'] },
    { key: 'hs', label: 'HS 후보', req: true, aliases: ['hs', 'hs코드', 'hscode', '세번', '세번후보', '품목번호', 'hsk'] },
    { key: 'supplierHs', label: '공급자 HS', aliases: ['해외공급자hs', '공급자제시hs', '공급자hs번호', '해외공급자hs품목번호', '공급자세번', '해외공급자품목번호'] },
    { key: 'docs', label: '제출서류', aliases: ['첨부서류', '제출서류목록', '붙임', '첨부', '첨부자료', '상세자료'] },
    { key: 'basis', label: '분류 근거 메모', aliases: ['근거', '분류근거', '의견', '메모', '비고'] }
  ];
  var BYKEY = {}; FIELDS.forEach(function (f) { BYKEY[f.key] = f; });

  // 양식 칸 이름 — 기본값은 기획자가 보낸 물품설명서 양식(2026-11-04)의 6절 가운데 2~6절이다(1절 품명은 머리글로 찍는다).
  // 양식이 바뀌면 화면 설정에서 바꾼다. 공식 서식을 이 도구가 정한 것은 아니다.
  var SECTIONS = ['structure', 'function', 'composition', 'docs', 'opinion'];
  var DEFAULT_LABELS = {
    title: '물품설명서',
    structure: '구조 및 형태',
    function: '기능 및 용도',
    composition: '성분(함량) 및 제조공정',
    docs: '제출서류 목록',
    opinion: '품목분류 의견'
  };
  function mergeLabels(custom) {
    var out = {};
    Object.keys(DEFAULT_LABELS).forEach(function (k) {
      var v = custom && custom[k] != null ? String(custom[k]).trim() : '';
      out[k] = v || DEFAULT_LABELS[k];
    });
    return out;
  }

  function normKey(s) { return String(s == null ? '' : s).replace(/[\s.·_\-/()]/g, '').toLowerCase(); }
  var HEAD = {};
  FIELDS.forEach(function (f) {
    HEAD[normKey(f.label)] = f.key; HEAD[normKey(f.key)] = f.key;
    f.aliases.forEach(function (a) { HEAD[normKey(a)] = f.key; });
  });
  function fieldOf(header) { return HEAD[normKey(header)] || null; }

  function clean(v) {
    if (v == null) return '';
    return String(v).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
  }

  // 엑셀 행(열 이름 → 값) 배열을 부품 목록으로. 모르는 열은 버리지 않고 알린다.
  function normalize(rows) {
    var items = [], issues = [], unknown = {};
    (rows || []).forEach(function (row, i) {
      var it = {}, any = false;
      Object.keys(row || {}).forEach(function (h) {
        var k = fieldOf(h), v = clean(row[h]);
        if (!k) { if (v && !/^__EMPTY/.test(h)) unknown[h] = true; return; }
        if (v) { any = true; it[k] = it[k] ? it[k] + ' ' + v : v; }
      });
      if (!any) return;                                       // 완전히 빈 줄만 조용히 넘긴다
      if (!it.id) it.id = 'P-' + String(items.length + 1).padStart(2, '0');
      it.row = i + 2;                                         // 엑셀 머리줄 다음이 2행
      items.push(it);
    });
    Object.keys(unknown).forEach(function (h) { issues.push('모르는 열 「' + h + '」은 읽지 않았습니다. 열 이름을 양식에 맞춰 주세요.'); });
    if (!items.length) issues.push('읽을 수 있는 부품 줄이 없습니다.');
    return { items: items, issues: issues };
  }

  /* ---------- HS 후보 ---------- */
  // 「8431.49, 7326.19」·「8431499090」·「8431.49-9090 또는 8412.21」을 읽는다.
  // 자리수는 4(호)·6(소호)·10(HSK)만 받는다. 류(앞 2자리)는 01~97, 77은 비어 있는 류라 거른다.
  function parseHS(text) {
    var out = [], bad = [];
    String(text == null ? '' : text).split(/[,;\n/]|또는|or/i).forEach(function (tok) {
      tok = tok.trim(); if (!tok) return;
      var dg = tok.replace(/[^\d]/g, '');
      if (!dg) { bad.push(tok); return; }
      var ch = +dg.slice(0, 2);
      if ([4, 6, 10].indexOf(dg.length) < 0 || ch < 1 || ch > 97 || ch === 77) { bad.push(tok); return; }
      var disp = dg.length === 4 ? dg : dg.length === 6 ? dg.slice(0, 4) + '.' + dg.slice(4) : dg.slice(0, 4) + '.' + dg.slice(4, 6) + '-' + dg.slice(6);
      if (out.some(function (c) { return c.code === dg; })) return;
      out.push({ code: dg, display: disp, chapter: dg.slice(0, 2), heading: dg.slice(0, 4), level: dg.length === 4 ? '호' : dg.length === 6 ? '소호' : 'HSK' });
    });
    return { list: out, bad: bad };
  }

  /* ---------- 누락 점검 ---------- */
  var RATE_RE = /\d+(?:\.\d+)?\s*(?:%|퍼센트)/;
  var RATE_CTX = /세율|관세율|관세는|관세가|과세|FTA\s*세율/;
  var ASSERT_RE = /확정|틀림없|분류된다|분류됩니다|분류됨\b|해당한다\.|해당합니다\.|해당함\./;
  function check(item) {
    var missing = [], warns = [];
    FIELDS.forEach(function (f) { if (f.req && !clean(item[f.key])) missing.push(f.label); });
    if (item.hs) {
      var hs = parseHS(item.hs);
      if (hs.bad.length) warns.push('HS 후보를 읽지 못한 값: ' + hs.bad.join(', ') + ' (4·6·10자리 숫자로 적어 주세요)');
      if (!hs.list.length && missing.indexOf(BYKEY.hs.label) < 0) missing.push(BYKEY.hs.label);
      if (hs.list.length === 1) warns.push('HS 후보가 하나뿐입니다. 비교 검토한 다른 후보도 적으면 의견이 단단해집니다.');
    }
    if (item.function && clean(item.function).length < 8) warns.push('기능 설명이 짧습니다. 무엇을 어떻게 하는지 한 문장으로 적어 주세요.');
    if (item.structure && clean(item.structure).length < 8) warns.push('구조·형태 설명이 짧습니다. 모양·구성 부품을 적어 주세요.');
    if (item.use && !/전용|에만|만\s*사용|범용|공용/.test(item.use)) warns.push('다른 장비에도 쓰이는지(전용·범용 여부)를 용도에 적으면 품목분류 의견의 근거가 됩니다.');
    if (!item.composition && item.material) warns.push('성분(구성비·구성품)이 비어 있어 재질만으로 성분 칸을 씁니다.');
    ['basis', 'function', 'use'].forEach(function (k) {
      if (hasRate(item[k])) warns.push(BYKEY[k].label + '에 관세율 수치가 있습니다. 물품설명서에는 세율을 싣지 않습니다.');
    });
    return { missing: missing, warns: warns, ok: !missing.length };
  }
  function hasRate(t) {
    return splitSentences(t).some(function (s) { return RATE_CTX.test(s) && RATE_RE.test(s); });
  }
  function splitSentences(t) { return String(t == null ? '' : t).split(/(?<=[.!?。])\s+|\n+/).filter(Boolean); }

  /* ---------- 한국어 조사 ---------- */
  function lastHangul(w) {
    var s = String(w).replace(/[\s)\]」'"]+$/, ''), c = s.charCodeAt(s.length - 1);
    return c >= 0xac00 && c <= 0xd7a3 ? c : null;
  }
  // 받침 있음 → a, 없음 → b. 「으로/로」는 ㄹ 받침도 b.  한글이 아니면 「a/b」 겸용 표기.
  function josa(w, a, b) {
    var c = lastHangul(w);
    if (c == null) {
      if (/\d$/.test(String(w).trim())) {                     // 숫자로 끝나면 읽는 소리로
        var d = String(w).trim().slice(-1), bat = '0136780'.indexOf(d) >= 0, rieul = '178'.indexOf(d) >= 0;
        return w + ((a === '으로' || a === '으로서') ? (bat && !rieul ? a : b) : (bat ? a : b));
      }
      return w + '(' + a + ')' + b;
    }
    var jong = (c - 0xac00) % 28;
    if (a === '으로' || a === '으로서') return w + (jong && jong !== 8 ? a : b);
    return w + (jong ? a : b);
  }

  /* ---------- 초안 문장 ---------- */
  function hole(key) { return '[확인 필요: ' + BYKEY[key].label + ']'; }
  // 입력이 이미 문장이면(…다. / …음. / …함.) 그대로 쓰고, 명사구면 틀에 끼운다.
  function isSentence(t) { return /(다|음|함|임|됨|요)\.?$/.test(clean(t)) && clean(t).length > 12; }
  function endDot(t) { t = clean(t); return /[.!?]$/.test(t) ? t : t + '.'; }

  function draft(item, labels) {
    labels = mergeLabels(labels);
    var miss = {};
    function v(k) { var x = clean(item[k]); if (!x) { miss[k] = true; return hole(k); } return x; }
    function opt(k) { return clean(item[k]); }
    var name = v('name'), machine = v('machine');
    var nameFull = name + (opt('nameEn') ? '(' + opt('nameEn') + ')' : '');

    // 1. 구조·형태
    var st = [];
    st.push('본 물품은 ' + machine + '에 사용되는 ' + nameFull + '입니다.');
    st.push('모델(품번)은 ' + v('model') + '입니다.');
    var s = opt('structure');
    st.push(s ? (isSentence(s) ? endDot(s) : '구조·형태는 ' + s + '입니다.') : '구조·형태는 ' + v('structure') + '입니다.');
    if (opt('size')) st.push('치수·중량은 ' + opt('size') + '입니다.');

    // 2. 기능 및 용도
    var fn = [], f = opt('function');
    fn.push(f ? (isSentence(f) ? endDot(f) : '본 물품은 ' + f + ' 기능을 합니다.') : '본 물품은 ' + v('function') + ' 기능을 합니다.');
    var u = opt('use');
    fn.push(u ? (isSentence(u) ? endDot(u) : '용도는 ' + u + '입니다.') : '용도는 ' + v('use') + '입니다.');

    // 3. 성분 및 제조공정
    var cp = [];
    cp.push('주 재질은 ' + v('material') + '입니다.');
    if (opt('composition')) cp.push('성분(구성)은 ' + opt('composition') + '입니다.');
    var p = opt('process');
    if (!p) cp.push('제조공정은 ' + v('process') + '입니다.');
    else if (isSentence(p)) cp.push(endDot(p));
    else if (/→|->|>|,/.test(p)) cp.push('제조공정은 ' + p.replace(/\s*(->|>)\s*/g, ' → ') + ' 순서로 이루어집니다.');
    else cp.push('제조공정은 ' + p + '입니다.');
    if (opt('maker') || opt('origin')) {
      cp.push([opt('maker') ? '제조사는 ' + opt('maker') : '', opt('origin') ? '원산지는 ' + opt('origin') : ''].filter(Boolean).join(', ') + '입니다.');
    }

    // 5. 제출서류 목록 — 입력에 적힌 것만 나열한다. 없으면 어떤 자료를 붙일 수 있는지 안내만 한다(필수 칸이 아니다).
    var dc = [];
    if (opt('docs')) {
      dc.push('붙임으로 제출하는 자료는 다음과 같습니다.');
      opt('docs').split(/[,;\n/·]|및/).map(clean).filter(Boolean).forEach(function (d, i) { dc.push((i + 1) + '. ' + d); });
    } else dc.push('붙임 자료: 없음 (제조사 카탈로그, 성분표, 제조사양 설명서, 용도설명서, 설계도면 등 상세자료가 있으면 붙임으로 첨부합니다.)');
    if (opt('supplierHs')) {
      var sh = parseHS(opt('supplierHs'));
      dc.push('해외 공급자가 제시한 HS품목번호: ' + (sh.list.length ? sh.list.map(function (c) { return c.display; }).join(', ') : opt('supplierHs')) + ' (참고용이며 아래 의견의 후보와 함께 검토합니다.)');
    }

    // 6. 품목분류 의견 — 규칙 초안. 단정하지 않는다. 세율은 쓰지 않는다.
    var op = [], hs = parseHS(item.hs);
    var fShort = f ? clean(f).replace(/[.。]$/, '').replace(/(합니다|한다|함|함\.|하는 것임)$/, '') : null;
    op.push('본 물품은 ' + josa(machine + '에 사용되는 ' + name, '으로서', '로서') + ', ' +
      (fShort && !isSentence(f) ? fShort + ' 기능을 하는 부분품으로 보입니다.' : '구조와 기능상 해당 장비의 부분품으로 보입니다.'));
    if (hs.list.length) {
      op.push('검토한 품목분류 후보는 다음과 같습니다(후보 · 검토 필요).');
      hs.list.forEach(function (c, i) { op.push('후보 ' + (i + 1) + ': ' + c.display + ' (제' + c.chapter + '류 · ' + c.level + ' 단위)'); });
      var chs = hs.list.map(function (c) { return c.chapter; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
      if (chs.length > 1) op.push('후보가 서로 다른 류(' + chs.map(function (c) { return '제' + c + '류'; }).join('·') + ')에 걸쳐 있어, 장비 전용 부분품인지 다른 용도로도 쓰이는 범용 물품인지를 판단할 근거가 필요합니다.');
      var mc = chs.filter(function (c) { return c === '84' || c === '85'; });
      if (mc.length) op.push(mc.map(function (c) { return '제' + c + '류'; }).join('·') + ' 후보가 있으므로 부분품의 분류에 관한 규정(제16부 주 2 등)의 적용 여부를 함께 검토할 필요가 있습니다.');
    } else {
      op.push('품목분류 후보는 ' + hole('hs') + '입니다.');
    }
    if (opt('basis')) op.push('작성자 검토 메모: ' + endDot(scrubRates(opt('basis')).text));
    op.push('위 의견은 작성 보조 도구의 초안이며, 최종 품목분류는 담당자 검토와 관세평가분류원 회신에 따릅니다.');

    var texts = { structure: st, function: fn, composition: cp, docs: dc, opinion: op };
    return {
      id: item.id,
      sections: SECTIONS.map(function (k) { return { key: k, label: labels[k], text: texts[k].join('\n'), source: 'rule' }; }),
      holes: Object.keys(miss).map(function (k) { return BYKEY[k].label; }),
      hs: hs.list
    };
  }

  /* ---------- 문체 ---------- */
  // 과거 작성 사례(붙여넣은 글)의 문장 끝을 세어 문체를 고른다.
  //   nida = …입니다/합니다   ida = …이다/한다   ham = …임/함(개조식)
  function detectStyle(text) {
    var t = String(text || ''), n = { nida: 0, ida: 0, ham: 0 };
    n.nida = (t.match(/[니습]다[.\s]|니다$/gm) || []).length;
    n.ida = (t.match(/[^니습]다(?=[.\n]|$)/gm) || []).length;
    n.ham = (t.match(/(임|함|됨|음|있음|없음)(?=[.\n]|$)/gm) || []).length;
    var best = 'nida';
    if (n.ida > n[best]) best = 'ida';
    if (n.ham > n[best]) best = 'ham';
    return { style: t.trim() ? best : 'nida', counts: n };
  }
  var ENDINGS = [
    // [존댓말, 평서, 개조식] — 초안 틀이 쓰는 끝맺음만 둔다. 틀을 늘리면 이 표도 늘린다.
    ['이루어집니다', '이루어진다', '이루어짐'],
    ['따릅니다', '따른다', '따름'],
    ['같습니다', '같다', '같음'],
    ['있습니다', '있다', '있음'],
    ['보입니다', '보인다', '보임'],
    ['됩니다', '된다', '됨'],
    ['합니다', '한다', '함'],
    ['입니다', '이다', '임']
  ];
  function convertStyle(text, style) {
    if (!style || style === 'nida') return text;
    var col = style === 'ida' ? 1 : 2;
    return String(text).split('\n').map(function (line) {
      ENDINGS.forEach(function (e) {
        line = line.replace(new RegExp(e[0] + '(?=[.(]|\\s|$)', 'g'), e[col]);
      });
      return line;
    }).join('\n');
  }
  function applyStyle(d, style) {
    return Object.assign({}, d, { style: style, sections: d.sections.map(function (s) { return Object.assign({}, s, { text: convertStyle(s.text, style) }); }) });
  }

  /* ---------- 단정·세율 거르기 ---------- */
  function scrubRates(text) {
    var removed = 0;
    var out = splitSentences(text).map(function (s) {
      if (!RATE_CTX.test(s)) return s;
      return s.replace(new RegExp(RATE_RE.source, 'g'), function () { removed++; return '[관세율 수치 삭제]'; });
    }).join(' ');
    return { text: removed ? out : String(text == null ? '' : text), removed: removed };
  }
  function lint(text) {
    var w = [];
    if (ASSERT_RE.test(text)) w.push('단정하는 표현이 있습니다. 「후보」「검토 필요」로 바꿔 주세요.');
    if (hasRate(text)) w.push('관세율 수치가 들어 있습니다. 물품설명서에는 세율을 싣지 않습니다.');
    return w;
  }

  /* ---------- AI(선택) ---------- */
  var PROVIDERS = {
    openai: { label: 'OpenAI', model: 'gpt-4o-mini', url: 'https://api.openai.com/v1/chat/completions' },
    anthropic: { label: 'Anthropic', model: 'claude-haiku-5-5', url: 'https://api.anthropic.com/v1/messages' }
  };
  function buildPrompt(item, d, example, labels) {
    labels = mergeLabels(labels);
    var system = [
      '당신은 수입물품 품목분류 질의용 물품설명서 작성을 돕는 보조자입니다.',
      '규칙:',
      '1. 입력에 없는 사실(치수·성분비·제조사 등)을 지어내지 마세요. 모르는 것은 missing 에 적으세요.',
      '2. HS 코드는 「후보 · 검토 필요」로만 쓰고, 분류를 확정하는 표현을 쓰지 마세요.',
      '3. 관세율 수치를 쓰지 마세요.',
      '4. 「[확인 필요: …]」 표시는 지우지 말고 그대로 두세요.',
      '5. 문체 참고 예시가 있으면 그 문장 끝맺음과 어휘를 따르세요. 예시의 내용(물품·수치)은 옮기지 마세요.',
      '6. 반드시 JSON 하나만 답하세요: {"sections":{"structure":"","function":"","composition":"","docs":"","opinion":""},"missing":["빠진 정보"],"notes":"검토자에게 남길 말"}'
    ].join('\n');
    var fields = FIELDS.filter(function (f) { return clean(item[f.key]); }).map(function (f) { return '- ' + f.label + ': ' + clean(item[f.key]); }).join('\n');
    var user = '[양식 칸 이름]\n' + SECTIONS.map(function (k) { return k + ' = ' + labels[k]; }).join('\n') +
      '\n\n[부품 정보]\n' + fields +
      '\n\n[규칙 초안 — 다듬을 대상]\n' + d.sections.map(function (s) { return '## ' + s.key + '\n' + s.text; }).join('\n\n') +
      (clean(example) ? '\n\n[과거 작성 사례 — 문체 참고만]\n' + clean(example).slice(0, 4000) : '') +
      '\n\n문장을 자연스럽게 다듬고, 품목분류 판단에 빠진 정보를 missing 에 적어 주세요.';
    return { system: system, user: user };
  }
  function buildRequest(provider, key, prompt) {
    var p = PROVIDERS[provider];
    if (!p) throw new Error('모르는 제공자: ' + provider);
    if (provider === 'openai') return {
      url: p.url,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: { model: p.model, temperature: 0.2, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] }
    };
    return {
      url: p.url,
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: { model: p.model, max_tokens: 2000, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }
    };
  }
  function extractText(provider, json) {
    if (!json) return '';
    if (provider === 'openai') return (((json.choices || [])[0] || {}).message || {}).content || '';
    return (json.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  }
  // AI 답을 믿지 않는다 — JSON 만 꺼내고, 세율을 지우고, 단정 표현을 짚는다.
  function parseAIReply(text) {
    var t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return { error: 'AI 답에서 JSON 을 찾지 못했습니다.' };
    var j; try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { return { error: 'AI 답의 JSON 을 읽지 못했습니다: ' + e.message }; }
    var sec = j.sections || {}, out = {}, warns = [], removed = 0;
    SECTIONS.forEach(function (k) {
      if (typeof sec[k] !== 'string' || !sec[k].trim()) return;
      var r = scrubRates(sec[k].trim()); removed += r.removed;
      out[k] = r.text;
      lint(r.text).forEach(function (w) { warns.push(k + ': ' + w); });
    });
    if (removed) warns.push('AI 답에 있던 관세율 수치 ' + removed + '곳을 지웠습니다.');
    return { sections: out, missing: Array.isArray(j.missing) ? j.missing.map(String) : [], notes: j.notes ? String(j.notes) : '', warns: warns };
  }

  /* ---------- 내보내기 ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // entries: [{ item, sections:[{key,label,text,source}], check }]
  function sheetRows(entries, labels) {
    labels = mergeLabels(labels);
    var head = ['관리번호', '품명', '모델·품번', '적용 장비', 'HS 후보(검토 필요)'].concat(SECTIONS.map(function (k) { return labels[k]; }), ['작성 구분', '누락 항목', '확인할 점']);
    return [head].concat(entries.map(function (e) {
      var by = {}; e.sections.forEach(function (s) { by[s.key] = s; });
      var src = e.sections.some(function (s) { return s.source === 'ai'; }) ? 'AI 초안 반영 — 검토 필요' : e.sections.some(function (s) { return s.source === 'edit'; }) ? '규칙 초안 + 직접 수정' : '규칙 초안';
      return [e.item.id, e.item.name || '', e.item.model || '', e.item.machine || '', parseHS(e.item.hs).list.map(function (c) { return c.display; }).join(', ')]
        .concat(SECTIONS.map(function (k) { return by[k] ? by[k].text : ''; }), [src, e.check.missing.join(', '), e.check.warns.join(' / ')]);
    }));
  }
  function printHTML(entries, labels) {
    labels = mergeLabels(labels);
    return entries.map(function (e, i) {
      var it = e.item, ai = e.sections.some(function (s) { return s.source === 'ai'; });
      var hs = parseHS(it.hs).list.map(function (c) { return c.display; }).join(', ');
      return '<article class="doc"' + (i ? ' style="page-break-before:always"' : '') + '>' +
        '<h1>' + esc(labels.title) + '</h1>' +
        '<p class="doc-flag">' + (ai ? 'AI 초안 반영 — 검토 필요' : '규칙 초안 — 검토 필요') + (e.check.missing.length ? ' · 누락 ' + e.check.missing.length + '건' : '') + '</p>' +
        '<table class="doc-t"><tbody>' +
        '<tr><th rowspan="4">1. 품명<br><small>(모델, 규격 등 포함)</small></th><th>품명</th><td colspan="2">' + esc(it.name || '') + (it.nameEn ? ' (' + esc(it.nameEn) + ')' : '') + '</td></tr>' +
        '<tr><th>모델·품번</th><td>' + esc(it.model || '') + '</td><td>관리번호 ' + esc(it.id) + '</td></tr>' +
        '<tr><th>상표 · 규격</th><td>' + esc(it.brand || '') + '</td><td>' + esc(it.size || '') + '</td></tr>' +
        '<tr><th>적용 장비 · HS 후보</th><td>' + esc(it.machine || '') + '</td><td>' + esc(hs) + ' <small>검토 필요</small></td></tr>' +
        e.sections.map(function (s, si) { return '<tr><th>' + (si + 2) + '. ' + esc(s.label) + '</th><td colspan="3" class="doc-body">' + esc(s.text) + '</td></tr>'; }).join('') +
        '</tbody></table>' +
        '<p class="doc-foot">이 문서는 작성 보조 도구의 초안입니다. 품목분류의 최종 판단은 담당자가 합니다. 칸 이름은 첨부 양식에 맞춰 바꿀 수 있습니다.</p>' +
        '</article>';
    }).join('');
  }

  /* ---------- 워드(.docx) — 기획자가 보낸 「물품설명서양식_워드」와 같은 짜임 ----------
   * A4 · 여백 위 30mm 나머지 25.4mm · 맑은 고딕. 제목 「물 품 설 명 서」(20pt 굵게 가운데) →
   * 절마다 제목(16pt 굵게) · 작성 안내 「☞ …」(12pt) · 본문(12pt). 부품마다 새 쪽에서 시작한다.
   * 양식 원본 파일은 저장소에 두지 않고, 같은 짜임을 여기서 만든다. */
  var DOCX_GUIDE = {
    name: ['Invoice 품명, 거래품명, 상표명, 모델, 타입, 규격, HS CODE 등'],
    structure: ['내부적 주요 구성요소, 구성요소별 기능, 내부구조도, 블럭 다이어그램(흐름도)', '사진(Image), 재질 등'],
    function: ['작동 원리, 주요 기능, 연결되는 주변기기와의 연관도', '주요 용도, 일반적 용도 등 상세설명서'],
    composition: ['구성 성분 또는 제조사의 성분표, 구성 성분의 역할', '해당 물품의 제조방법, 제조공정 등'],
    docs: ['해외 공급자 등이 제공한 HS품목번호', '제조사 카탈로그, 성분표, 제조사양 설명서, 용도설명서, 설계도면 등 (상세자료 붙임으로 첨부)'],
    opinion: ['신청인이 해당 물품에 대한 분류의견을 갖고 있을 경우 HS품목번호와 그 사유 등을 자유롭게 기술']
  };
  function xesc(s) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function wRun(text, o) {
    o = o || {};
    var rpr = '<w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕"/>' + (o.bold ? '<w:b/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '') + '<w:sz w:val="' + (o.size || 24) + '"/><w:szCs w:val="' + (o.size || 24) + '"/></w:rPr>';
    return '<w:r>' + rpr + '<w:t xml:space="preserve">' + xesc(text) + '</w:t></w:r>';
  }
  function wPara(text, o) {
    o = o || {};
    var ppr = '<w:pPr>' + (o.pageBreak ? '<w:pageBreakBefore/>' : '') + (o.keep ? '<w:keepNext/>' : '') + '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 60 : o.after) + '"/>' + (o.indent ? '<w:ind w:left="' + o.indent + '"/>' : '') + (o.center ? '<w:jc w:val="center"/>' : '') + '</w:pPr>';
    return '<w:p>' + ppr + (text === '' ? '' : wRun(text, o)) + '</w:p>';
  }
  /** 본문 한 칸 → 문단들. 줄바꿈은 문단으로, 빈 줄도 그대로 둔다 */
  function wBody(text) { var t = String(text == null ? '' : text).replace(/\r\n?/g, '\n'); return (t === '' ? [''] : t.split('\n')).map(function (l) { return wPara(l, { indent: 200 }); }).join(''); }
  /**
   * entries → word/document.xml 문자열. opt.guide === false 면 「☞」 작성 안내 줄을 뺀다.
   * 1절 품명에는 입력한 값만 넣는다(없는 칸은 줄을 만들지 않는다). HS 는 후보라고 적는다.
   */
  function docxDocument(entries, labels, opt) {
    labels = mergeLabels(labels); opt = opt || {};
    var guide = function (k) { return opt.guide === false ? '' : (DOCX_GUIDE[k] || []).map(function (g) { return wPara('☞ ' + g, { color: '555555', after: 40 }); }).join(''); };
    var head = function (n, t) { return wPara(n + '. ' + t, { size: 32, bold: true, before: 280, after: 100, keep: true }); };
    var body = entries.map(function (e, i) {
      var it = e.item, ai = e.sections.some(function (s) { return s.source === 'ai'; });
      var hs = parseHS(it.hs).list.map(function (c) { return c.display; }).join(', ');
      var l1 = [['품명', (it.name || '') + (it.nameEn ? ' (' + it.nameEn + ')' : '')], ['모델 · 품번', it.model], ['상표', it.brand], ['규격', it.size], ['적용 장비', it.machine], ['HS 후보(검토 필요)', hs], ['관리번호', it.id]].filter(function (x) { return String(x[1] == null ? '' : x[1]).trim() !== ''; });
      return wPara(labels.title.length <= 6 ? labels.title.split('').join(' ') : labels.title, { size: 40, bold: true, center: true, after: 120, pageBreak: i > 0 }) +
        wPara((ai ? 'AI 초안 반영 — 검토 필요' : '규칙 초안 — 검토 필요') + (e.check.missing.length ? ' · 누락 ' + e.check.missing.length + '건(' + e.check.missing.join(', ') + ')' : ''), { size: 18, color: '8A4B00', center: true, after: 160 }) +
        head(1, '품명(모델, 규격 등 포함)') + guide('name') + (l1.map(function (x) { return wPara(x[0] + ' : ' + x[1], { indent: 200 }); }).join('') || wPara('', {})) +
        e.sections.map(function (s, si) { return head(si + 2, labels[s.key] || s.label) + guide(s.key) + wBody(s.text); }).join('');
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      wPara('이 문서는 작성 보조 도구의 초안입니다. 품목분류의 최종 판단은 담당자가 합니다.', { size: 16, color: '777777', before: 300 }) +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>';
  }
  /** .docx 안에 들어갈 파일들(경로 → 내용). 묶기(zip)는 화면에서 한다 */
  function docxFiles(entries, labels, opt) {
    return {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'word/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:pPr><w:wordWrap w:val="0"/><w:jc w:val="left"/></w:pPr></w:style></w:styles>',
      'word/document.xml': docxDocument(entries, labels, opt)
    };
  }

  /* ---------- 예제 — 가짜 굴착기 부품 3건(실제 사내 데이터가 아닙니다) ---------- */
  function sample() {
    return [
      { 관리번호: 'EX-001', 품명: '버킷 투스', '영문 품명': 'Bucket Tooth', '모델·품번': 'HX-BT220 (가상)', '적용 장비': '22톤급 유압 굴착기',
        재질: '저합금 주강(경화 처리)', '구조·형태': '앞이 뾰족한 쐐기 모양의 블록으로, 뒤쪽에 어댑터가 끼워지는 빈 홈과 고정 핀 구멍이 있는 형태',
        '치수·중량': '길이 약 300mm, 중량 약 9kg', 기능: '버킷 날 끝에 끼워져 토사·암반을 파고드는', 용도: '굴착기 버킷 어댑터 전용 부품으로, 굴착 작업 때 마모되는 날 끝을 보호하고 교체하는 소모 부품',
        성분: '탄소·크롬·몰리브덴을 소량 함유한 저합금강', 제조공정: '용해 → 주조 → 열처리(담금질·뜨임) → 쇼트블라스트 → 도장',
        제조사: '가상부품(주)', 원산지: '중국', 'HS 후보': '8431.49, 7325.99', '분류 근거 메모': '굴착기 버킷 전용 형상이라 부분품 후보를 우선 검토함.' },
      { 관리번호: 'EX-002', 품명: '선회 베어링', '영문 품명': 'Swing Bearing', '모델·품번': 'HX-SB220 (가상)', '적용 장비': '22톤급 유압 굴착기',
        재질: '베어링강 및 기계구조용 탄소강', '구조·형태': '안쪽에 기어 이가 깎인 큰 링 두 개 사이에 강구가 한 줄로 들어간 원형 구조',
        '치수·중량': '외경 약 1,100mm, 중량 약 250kg', 기능: '상부 회전체를 하부 주행체 위에서 360도 회전시키면서 하중을 지지하는',
        용도: '굴착기 상부와 하부를 연결하는 선회 장치의 회전 지지 부품', 성분: '내륜·외륜·강구·리테이너·실',
        제조공정: '링 단조 → 선반 가공 → 기어 가공 → 고주파 경화 → 연삭 → 조립 → 그리스 주입', 원산지: '대한민국',
        'HS 후보': '8482.10, 8431.49' },
      { 관리번호: 'EX-003', 품명: '유압 호스 어셈블리', '영문 품명': 'Hydraulic Hose Assembly', '모델·품번': 'HX-HA330 (가상)', '적용 장비': '유압 굴착기 붐 실린더 배관',
        재질: '합성고무 및 강선 보강층, 강재 피팅', '구조·형태': '고무 호스 양 끝에 나사식 금속 피팅이 압착 결합된 형태',
        기능: '유압 펌프의 작동유를 붐 실린더로 보내는', 용도: '굴착기 유압 회로 배관용',
        'HS 후보': '4009.42' }
    ];
  }
  function sampleExample() {
    return '본 물품은 지게차 마스트에 장착되는 체인 가이드 롤러임.\n' +
      '외륜과 내륜 사이에 니들 롤러가 들어간 원통형 구조로, 축 방향 하중을 지지함.\n' +
      '제조공정은 단조 후 열처리와 연삭을 거쳐 조립됨.\n' +
      '(문체 참고용 가상 예시 — 실제 작성 사례가 아닙니다)';
  }

  var api = {
    FIELDS: FIELDS, SECTIONS: SECTIONS, DEFAULT_LABELS: DEFAULT_LABELS, PROVIDERS: PROVIDERS,
    mergeLabels: mergeLabels, fieldOf: fieldOf, normalize: normalize, parseHS: parseHS, check: check,
    josa: josa, draft: draft, detectStyle: detectStyle, convertStyle: convertStyle, applyStyle: applyStyle,
    scrubRates: scrubRates, lint: lint, buildPrompt: buildPrompt, buildRequest: buildRequest,
    extractText: extractText, parseAIReply: parseAIReply, sheetRows: sheetRows, printHTML: printHTML,
    DOCX_GUIDE: DOCX_GUIDE, docxDocument: docxDocument, docxFiles: docxFiles,
    sample: sample, sampleExample: sampleExample, esc: esc
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Doc = api;
})(this);
