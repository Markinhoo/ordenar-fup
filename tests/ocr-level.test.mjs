import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/lib/ocr.js', import.meta.url), 'utf8');
const { findLevel, parseScanText } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('rejects corrupted document labels rather than storing them as levels', () => {
  for (const value of ['OEOOOMEM', 'OEOOOMEM DOCUMENTO', 'DOCUMENTO', 'AD6E', '']) assert.equal(findLevel(value), '');
});
test('recognizes exact levels without being replaced by label noise', () => {
  assert.equal(findLevel('ADGE OEOOOMEM'), 'ADGE');
  assert.equal(findLevel('PREPARATOR 166369'), 'PREPARATOR');
  assert.equal(findLevel('ADGE PREPARATOR'), '');
});
test('keeps folio and date when a level cannot be validated', () => {
  const result = parseScanText('ESTATAL\nOEOOOMEM\n42111\n2025/06/03', [{ folio: '42111' }]);
  assert.equal(result.nivel, ''); assert.equal(result.folio, '42111'); assert.equal(result.documentDate, '2025-06-03');
});
