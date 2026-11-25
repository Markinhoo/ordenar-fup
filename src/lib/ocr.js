let documentWorker;
let folioWorker;

function localOcrOptions() {
  const assetPath = new URL('/ocr/', location.origin).href.replace(/\/$/, '');
  return { workerPath: `${assetPath}/worker.min.js`, corePath: assetPath,
    langPath: assetPath, workerBlobURL: false };
}

export async function getDocumentWorker() {
  if (!documentWorker) {
    const Tesseract = await import('tesseract.js');
    documentWorker = await Tesseract.createWorker('eng', 1, localOcrOptions());
    await documentWorker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  }
  return documentWorker;
}

export async function getFolioWorker() {
  if (!folioWorker) {
    const Tesseract = await import('tesseract.js');
    folioWorker = await Tesseract.createWorker('eng', 1, localOcrOptions());
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

// Authorized document levels. Do not guess from arbitrary OCR words.
export const DOCUMENT_LEVELS = ['PREE', 'PRIMARIAE', 'SECUNDARIA', 'BASICA B', 'ADGE', 'FISICAE', 'PREPARATORIA'];
export function findLevel(raw) {
  const text = String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
  const matches = DOCUMENT_LEVELS.filter((level) => new RegExp('\\b' + level + '\\b').test(text));
  return matches.length === 1 ? matches[0] : '';
}

export function confidentLevel(data) {
  const level = findLevel(data.text);
  const confidentText = (data.words || []).map((word) => word.confidence >= 75 ? word.text : '?').join(' ');
  return level && findLevel(confidentText) === level ? level : '';
}

export function selectLevel(readings) {
  const levels = readings.map((data) => findLevel(data.text)).filter(Boolean);
  const unique = [...new Set(levels)];
  if (unique.length !== 1) return '';
  return levels.length >= 2 || readings.some((data) => confidentLevel(data) === unique[0]) ? unique[0] : '';
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
  const nearby = documentLine >= 0 ? lines.slice(Math.max(0, documentLine - 1), documentLine + 3).join(' ') : lines.filter((line) => !/PROCEDENCIA|FECHA|ESTATAL|FEDERAL|MUNICIPAL/.test(line)).join(' ');
  const nivel = findLevel(nearby);
  return { procedencia, nivel, folio, documentDate, raw: text };
}

const regions = {
  procedencia: [.50, .03, .48, .32],
  nivel: [.50, .30, .48, .25],
  folio: [.50, .31, .48, .43],
  documentDate: [.50, .68, .48, .30],
};

function cropRegion(bitmap, [left, top, width, height]) {
  const canvas = document.createElement('canvas');
  const sourceWidth = Math.round(bitmap.width * width);
  const sourceHeight = Math.round(bitmap.height * height);
  canvas.width = Math.max(1, sourceWidth * 2);
  canvas.height = Math.max(1, sourceHeight * 2);
  const context = canvas.getContext('2d');
  context.filter = 'grayscale(1) contrast(1.15)';
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
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
    const { data } = await worker.recognize(image);
    const full = parseScanText(data.text, records);
    // Level and folio are two lines in the same cell; read the entire value column.
    const column = await worker.recognize(cropRegion(bitmap, [.46, .02, .54, .96]));
    const columnFields = parseScanText(column.data.text, records);
    for (const field of ['procedencia', 'nivel', 'folio', 'documentDate']) {
      if (!full[field]) full[field] = columnFields[field];
    }
    await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
    const folioRead = await worker.recognize(cropRegion(bitmap, regions.folio));
    parts.folio = folioRead.data.text.trim();
    const targetFolio = findFolio(parts.folio, records);
    const knownFolio = [targetFolio, full.folio].find((folio) => records.some((record) =>
      String(record.folio).match(/^\d+/)?.[0] === folio));
    // The right column excludes the document labels and accommodates different framing.
    const levelReadings = [column.data];
    let result = { ...full, nivel: selectLevel(levelReadings), folio: knownFolio || targetFolio || full.folio };
    if (!result.procedencia || !result.nivel || !result.documentDate) {
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE });
      if (!result.procedencia) {
        const sourceRead = await worker.recognize(cropRegion(bitmap, regions.procedencia));
        parts.procedencia = sourceRead.data.text.trim();
        result.procedencia = parts.procedencia.match(/\b(ESTATAL|FEDERAL|MUNICIPAL)\b/i)?.[0]?.toUpperCase() || '';
      }
      if (!result.nivel) {
        await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
        const levelRead = await worker.recognize(cropRegion(bitmap, [.48, .23, .52, .43]));
        levelReadings.push(levelRead.data);
        parts.nivel = levelRead.data.text.trim();
        result.nivel = selectLevel(levelReadings);
        if (!result.nivel) {
          await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE });
          const focused = await worker.recognize(cropRegion(bitmap, regions.nivel));
          levelReadings.push(focused.data);
          result.nivel = selectLevel(levelReadings);
        }
        await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE });
      }
      if (!result.documentDate) {
        const dateRead = await worker.recognize(cropRegion(bitmap, regions.documentDate));
        parts.documentDate = dateRead.data.text.trim();
        result.documentDate = parseDate(parts.documentDate);
      }
    }
    return { ...result, raw: [data.text, ...Object.values(parts)].filter(Boolean).join(' | ') };
  } finally {
    bitmap.close?.();
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  }
}
