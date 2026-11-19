let documentWorker;
let folioWorker;

export async function getDocumentWorker() {
  if (!documentWorker) {
    const Tesseract = await import('tesseract.js');
    documentWorker = await Tesseract.createWorker('eng');
    await documentWorker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  }
  return documentWorker;
}

export async function getFolioWorker() {
  if (!folioWorker) {
    const Tesseract = await import('tesseract.js');
    folioWorker = await Tesseract.createWorker('eng');
    await folioWorker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  }
  return folioWorker;
}

export function parseScanText(raw, records = []) {
  const text = String(raw || '').toUpperCase().replace(/\r/g, '');
  const lines = text.split('\n').map((line) => line.replace(/[^A-Z0-9ÁÉÍÓÚÑ/.: -]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const dateMatch = text.match(/(?:19|20)\d{2}[\/.\-]\d{1,2}[\/.\-]\d{1,2}/);
  let documentDate = null;
  if (dateMatch) {
    const [year, month, day] = dateMatch[0].replace(/[.\-]/g, '/').split('/').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day)
      documentDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const withoutDate = dateMatch ? text.replace(dateMatch[0], ' ') : text;
  const numbers = [...new Set(withoutDate.match(/\b\d{3,12}\b/g) || [])];
  const known = numbers.filter((number) => records.some((record) => String(record.folio).match(/^\d+/)?.[0] === number));
  const folio = known.length === 1 ? known[0] : numbers.length === 1 ? numbers[0] : null;
  const sourceLine = lines.find((line) => line.includes('PROCEDENCIA')) || '';
  let procedencia = sourceLine.replace(/^.*?PROCEDENCIA\s*[:.-]?\s*/, '').replace(/[^A-ZÁÉÍÓÚÑ ]/g, '').trim();
  if (!procedencia) {
    const candidate = lines.find((line) => /\b(ESTATAL|FEDERAL|MUNICIPAL)\b/.test(line));
    procedencia = candidate?.match(/\b(ESTATAL|FEDERAL|MUNICIPAL)\b/)?.[0] || '';
  }
  const documentLine = lines.findIndex((line) => /DOCUMENTO/.test(line));
  const nearby = documentLine >= 0 ? lines.slice(documentLine, documentLine + 3).join(' ') : lines.join(' ');
  const excluded = new Set(['PROCEDENCIA', 'NO', 'DE', 'DEL', 'DOCUMENTO', 'FECHA', 'ESTATAL', 'FEDERAL', 'MUNICIPAL', ...procedencia.split(' ')]);
  const words = nearby.match(/\b[A-ZÁÉÍÓÚÑ]{2,15}\b/g) || [];
  const nivel = words.find((word) => !excluded.has(word)) || '';
  return { procedencia, nivel, folio, documentDate, raw: text };
}
