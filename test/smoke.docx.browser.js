/* v1.4 워드 내보내기를 브라우저에서 실제로 받아 본다 — node test/smoke.docx.browser.js (playwright 가 없으면 건너뜀)
 * 전체 화면 테스트(smoke.browser.js)가 길어 워드만 따로 둔다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { try { chromium = require('playwright-core').chromium; } catch (e2) { console.log('playwright 가 없어 워드 화면 테스트를 건너뜁니다.'); process.exit(0); } }
var XLSX = require('../lib/xlsx.full.min.js');
var ROOT = path.join(__dirname, '..');
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
var srv = http.createServer(function (q, s) { var p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, function (e, b) { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(b); }); });
var passed = 0, failed = 0;
function ok(c, label, d) { if (c) passed++; else { failed++; console.log('  X ' + label + (d != null ? '  ' + d : '')); } }
function docText(file) { var z = XLSX.CFB.read(fs.readFileSync(file), { type: 'buffer' }), i = z.FullPaths.findIndex(function (p) { return /word\/document\.xml$/.test(p); }); return { n: z.FullPaths.filter(function (p) { return /\.(xml|rels)$/.test(p); }).length, xml: Buffer.from(z.FileIndex[i].content).toString('utf8') }; }
srv.listen(0, async function () {
  var base = 'http://127.0.0.1:' + srv.address().port + '/';
  var br = await chromium.launch(); var ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  var pg = await ctx.newPage(), errs = []; pg.on('pageerror', function (e) { errs.push(e.message); });
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b07-docx-'));
  try {
    await pg.goto(base); await pg.click('#btn-sample'); await pg.waitForSelector('#sections textarea', { timeout: 8000 });
    ok(await pg.isVisible('#btn-docx') && await pg.isChecked('#docx-guide'), '4. 내보내기에 워드 단추 · 작성 안내 줄 넣기(기본 켬)');
    await pg.fill('#sections textarea[data-sec="structure"]', '직접 고친 첫 줄\n둘째 줄 <확인> & 끝'); await pg.dispatchEvent('#sections textarea[data-sec="structure"]', 'input'); await pg.dispatchEvent('#sections textarea[data-sec="structure"]', 'change');
    var d1 = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), pg.click('#btn-docx')]), f1 = path.join(tmp, 'a.docx'); await d1[0].saveAs(f1);
    ok(/^물품설명서_초안_\d{4}-\d{2}-\d{2}\.docx$/.test(d1[0].suggestedFilename()) && fs.statSync(f1).size > 2500, '워드 파일 내려받기', d1[0].suggestedFilename() + ' ' + fs.statSync(f1).size);
    var a = docText(f1), plain = a.xml.replace(/<[^>]+>/g, '\n');
    ok(a.n === 5 && fs.readFileSync(f1).slice(0, 2).toString() === 'PK', 'docx(zip) 안에 파일 5개');
    ok((plain.match(/물 품 설 명 서/g) || []).length === 3 && (a.xml.match(/<w:pageBreakBefore\/>/g) || []).length === 2, '부품 3건 — 부품마다 새 쪽');
    ok(/1\. 품명\(모델, 규격 등 포함\)/.test(plain) && /6\. 품목분류 의견/.test(plain) && (plain.match(/☞ /g) || []).length === 30, '양식의 1~6절과 작성 안내 줄');
    ok(/직접 고친 첫 줄/.test(plain) && /둘째 줄 &lt;확인&gt; &amp; 끝/.test(a.xml), '화면에서 고친 문장이 그대로 들어간다(특수문자 포함)');
    await pg.uncheck('#docx-guide');
    var d2 = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), pg.click('#btn-docx')]), f2 = path.join(tmp, 'b.docx'); await d2[0].saveAs(f2);
    ok(!/☞/.test(docText(f2).xml) && /2\. 구조 및 형태/.test(docText(f2).xml), '작성 안내 줄을 끄면 빠진다');
    var dx = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), pg.click('#btn-xlsx')]);
    ok(/\.xlsx$/.test(dx[0].suggestedFilename()), '엑셀 내보내기는 그대로');
    await pg.setViewportSize({ width: 360, height: 800 });
    ok((await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; })) <= 1, '360px 가로 넘침 없음');
    ok(errs.length === 0, '페이지 오류 없음', errs.join(' | '));
  } catch (e) { failed++; console.log('  X 중단: ' + e.message.split('\n')[0]); if (errs.length) console.log('    ' + errs.join(' | ')); }
  await br.close(); srv.close();
  console.log('워드 화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
