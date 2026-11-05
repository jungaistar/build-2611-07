// 예제 엑셀 4종 만들기 — node tools/make-samples.mjs [폴더=samples]
// js/customs.js 의 sampleFiles() 로 실제 xlsx 를 쓴다. 가짜 데이터입니다(실제 사내 데이터가 아닙니다).
// 대시보드의 「예제로 해보기」와 같은 내용이다. 수입 파일은 ERP 처럼 맨 위에 제목·조회 조건 줄을 붙인다.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const XLSX = require(join(ROOT, 'lib/xlsx.full.min.js'));
const C = require(join(ROOT, 'js/customs.js'));

const dir = process.argv[2] || join(ROOT, 'samples');
mkdirSync(dir, { recursive: true });
for (const f of C.sampleFiles()) {
  const aoa = f.kind === 'import'
    ? [['수입 통관 실적 조회(예제 — 가짜 데이터)'], ['조회기간: 2024-01-01 ~ 2025-10-31']].concat(f.aoa)
    : f.aoa;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '데이터');
  wb.Props = { Title: '예제(가짜 데이터)', CreatedDate: new Date(Date.UTC(2026, 10, 3)) };
  writeFileSync(join(dir, f.name), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }));
  console.log('썼습니다:', f.name, (aoa.length - 1) + '줄');
}
