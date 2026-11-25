import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/lib/ocr.js', import.meta.url), 'utf8');
const { findLevel, parseScanText, confidentLevel, DOCUMENT_LEVELS, selectLevel, parseValueColumn } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('rejects corrupted document labels rather than storing them as levels', () => {
  for (const value of ['OEOOOMEM', 'OEOOOMEM DOCUMENTO', 'DOCUMENTO', 'AD6E', '']) assert.equal(findLevel(value), '');
});
test('recognizes exact levels without being replaced by label noise', () => {
  assert.equal(findLevel('ADGE OEOOOMEM'), 'ADGE');
  assert.equal(findLevel('PREPARATORIA 166369'), 'PREPARATORIA');
  assert.equal(findLevel('ADGE PREPARATORIA'), '');
});
test('keeps folio and date when a level cannot be validated', () => {
  const result = parseScanText('ESTATAL\nOEOOOMEM\n42111\n2025/06/03', [{ folio: '42111' }]);
  assert.equal(result.nivel, ''); assert.equal(result.folio, '42111'); assert.equal(result.documentDate, '2025-06-03');
});

test('recognizes all seven authorized levels and rejects truncated words', () => {
  for (const level of DOCUMENT_LEVELS) assert.equal(findLevel(level + ' 42111'), level);
  for (const value of ['PREPARATOR', 'PRIMARIA', 'FISICA', 'BASICA', 'XPREE', 'ADGEX']) assert.equal(findLevel(value), '');
  assert.equal(findLevel('básica   b'), 'BASICA B');
});
test('requires confidence in both words of BASICA B', () => {
  const data = { text: 'BASICA B', words: [{ text: 'BASICA', confidence: 90 }, { text: 'B', confidence: 90 }] };
  assert.equal(confidentLevel(data), 'BASICA B');
  data.words[1].confidence = 40;
  assert.equal(confidentLevel(data), '');
});

test('accepts agreeing exact levels from two crops despite low OCR confidence', () => {
 const reading = { text: 'ADGE', words: [{ text: 'ADGE', confidence: 50 }] };
 assert.equal(selectLevel([reading]), '');
 assert.equal(selectLevel([reading, reading]), 'ADGE');
 assert.equal(selectLevel([reading, {text: 'PREE'}]), '');
 assert.equal(selectLevel([{text:'OEOOOMEM'}, {text:'OEOOOMEM'}]), '');
});

test('reads four ordered values without labels and does not mistake date for folio', () => {
 const result = parseValueColumn('ESTATAL\nBASICA B\n42111\n2025 / 06 / 03');
 assert.equal(result.procedencia, 'ESTATAL'); assert.equal(result.nivel, 'BASICA B');
 assert.equal(result.folio, '42111'); assert.equal(result.documentDate, '2025-06-03');
 assert.equal(parseValueColumn('ESTATAL\nADGE\n2025 / 06 / 03').folio, null);
});
