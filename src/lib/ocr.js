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

function parseDate(raw) {
  const text = String(raw || '').toUpperCase().replace(/O/g, '0');
  const match = text.match(/(?:19|20)\d{2}\s*[/.\-]?\s*\d{2}\s*[/.\-]?\s*\d{2}/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, '');
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}

function findFolio(raw, records = []) {
  const numbers = [...new Set(String(raw || '').replace(/[OQ]/gi, '0').match(/\b\d{3,12}\b/g) || [])];
  const known = numbers.filter((number) => records.some((record) => String(record.folio).match(/^\d+/)?.[0] === number));
  return known.length === 1 ? known[0] : numbers.length === 1 ? numbers[0] : null;
}

function findLevel(raw) {
  const excluded = new Set(['PROCEDENCIA', 'NO', 'DE', 'DEL', 'DOCUMENTO', 'FECHA', 'ESTATAL', 'FEDERAL', 'MUNICIPAL']);
  return (String(raw || '').toUpperCase().match(/\b[A-ZÁÉÍÓÚÑ]{2,20}\b/g) || [])
    .filter((word) => !excluded.has(word)).at(-1) || '';
}

export function parseScanText(raw, records = []) {
  const text = String(raw || '').toUpperCase().replace(/\r/g, '');
  const lines = text.split('\n').map((line) => line.replace(/[^A-Z0-9ÁÉÍÓÚÑ/.: -]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const documentDate = parseDate(text);
  const withoutDate = text.replace(/(?:19|20)\d{2}[/.\-]?\d{2}[/.\-]?\d{2}/, ' ');
  const folio = findFolio(withoutDate, records);
  const sourceLine = lines.find((line) => line.includes('PROCEDENCIA')) || '';
  const procedencia = sourceLine.match(/\b(ESTATAL|FEDERAL|MUNICIPAL)\b/)?.[0]
    || text.match(/\b(ESTATAL|FEDERAL|MUNICIPAL)\b/)?.[0] || '';
  const documentLine = lines.findIndex((line) => /DOCUMENTO/.test(line));
  const nearby = documentLine >= 0 ? lines.slice(Math.max(0, documentLine - 2), documentLine + 2).join(' ') : lines.join(' ');
  const nivel = findLevel(nearby);
  return { procedencia, nivel, folio, documentDate, raw: text };
}

const regions = {
  procedencia: [.60, .02, .38, .34],
  nivel: [.60, .30, .38, .27],
  folio: [.60, .48, .38, .27],
  documentDate: [.60, .70, .38, .29],
};

function cropRegion(bitmap, [left, top, width, height]) {
  const canvas = document.createElement('canvas');
  const sourceWidth = Math.round(bitmap.width * width);
  const sourceHeight = Math.round(bitmap.height * height);
  canvas.width = Math.max(1, sourceWidth * 2);
  canvas.height = Math.max(1, sourceHeight * 2);
  const context = canvas.getContext('2d');
  context.filter = 'grayscale(1) contrast(1.5)';
  context.drawImage(bitmap, Math.round(bitmap.width * left), Math.round(bitmap.height * top),
    sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function readDocumentFields(image, records = []) {
  const worker = await getDocumentWorker();
  const Tesseract = await import('tesseract.js');
  let bitmap;
  try { bitmap = await createImageBitmap(image); }
  catch { const { data } = await worker.recognize(image); return parseScanText(data.text, records); }
  const parts = {};
  try {
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE });
    for (const [key, area] of Object.entries(regions)) {
      const { data } = await worker.recognize(cropRegion(bitmap, area));
      parts[key] = data.text.trim();
    }
  } finally {
    bitmap.close?.();
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  }
  const structured = {
    procedencia: parts.procedencia.match(/\b(ESTATAL|FEDERAL|MUNICIPAL)\b/i)?.[0]?.toUpperCase() || '',
    nivel: findLevel(parts.nivel),
    folio: findFolio(parts.folio, records),
    documentDate: parseDate(parts.documentDate),
    raw: Object.values(parts).join(' | '),
  };
  if (structured.procedencia && structured.nivel && structured.folio && structured.documentDate) return structured;
  const { data } = await worker.recognize(image);
  const full = parseScanText(data.text, records);
  return { procedencia: structured.procedencia || full.procedencia,
    nivel: structured.nivel || full.nivel, folio: structured.folio || full.folio,
    documentDate: structured.documentDate || full.documentDate, raw: `${structured.raw} | ${full.raw}` };
}
