import { unzipSync, zipSync } from 'fflate';
import { distribute } from './qna';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
// Pick each new fill as far as possible from the colors already assigned.
// Oklab distance is closer to how people perceive color than hue spacing alone.
function colorPoint(hue, saturation, lightness) {
  const s = saturation / 100, l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [0, 8, 4].map(channel);
  const x = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const y = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const z = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * x + .793617785 * y - .0040720468 * z,
    1.9779984951 * x - 2.428592205 * y + .4505937099 * z,
    .0259040371 * x + .7827717662 * y - .808675766 * z];
}

function distinctPalette() {
  const candidates = [59, 73, 86].flatMap((lightness) =>
    Array.from({ length: 36 }, (_, i) => {
      const hue = i * 10, saturation = lightness === 86 ? 72 : 80;
      return { css: `hsl(${hue} ${saturation}% ${lightness}%)`, point: colorPoint(hue, saturation, lightness) };
    }));
  const chosen = [candidates.find((item) => item.css === 'hsl(210 80% 73%)')];
  const remaining = candidates.filter((item) => item !== chosen[0]);
  while (chosen.length < 50) {
    let best = null, bestDistance = -1;
    for (const candidate of remaining) {
      const distance = Math.min(...chosen.map((item) => item.point.reduce((sum, coordinate, i) =>
        sum + (coordinate - candidate.point[i]) ** 2, 0)));
      if (distance > bestDistance) { best = candidate; bestDistance = distance; }
    }
    chosen.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }
  return chosen.map((item) => item.css);
}

const palette = distinctPalette();

export function colorFor(index) {
  if (index < palette.length) return palette[index];
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 80% ${[59, 73, 86][index % 3]}%)`;
}

function hexColor(css) {
  if (css.startsWith('#')) return css.slice(1).toUpperCase();
  const [, h, s, l] = css.match(/hsl\((\d+) (\d+)% (\d+)%\)/).map(Number);
  const a = s / 100 * Math.min(l / 100, 1 - l / 100);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return `${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function parseXml(text, label) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`No se pudo leer ${label} del archivo.`);
  return doc;
}

function xmlFromZip(zip, path) {
  const bytes = zip[path];
  if (!bytes) throw new Error(`El Excel no contiene ${path}.`);
  return parseXml(decoder.decode(bytes), path);
}

function nodes(parent, name) { return [...parent.getElementsByTagNameNS(NS, name)]; }
function child(parent, name) { return [...parent.children].find((x) => x.localName === name); }
function colToNumber(ref) { return [...ref.match(/^[A-Z]+/)[0]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0); }
function numberToCol(number) { let s = ''; while (number) { number--; s = String.fromCharCode(65 + number % 26) + s; number = Math.floor(number / 26); } return s; }
function cellAt(row, col) { return [...row.children].find((c) => c.localName === 'c' && colToNumber(c.getAttribute('r')) === col); }
function rowAt(sheetData, number) { return [...sheetData.children].find((r) => Number(r.getAttribute('r')) === number); }

function sharedStrings(zip) {
  if (!zip['xl/sharedStrings.xml']) return [];
  const doc = xmlFromZip(zip, 'xl/sharedStrings.xml');
  return nodes(doc, 'si').map((si) => nodes(si, 't').map((t) => t.textContent).join(''));
}

function cellValue(cell, strings) {
  if (!cell) return '';
  if (cell.getAttribute('t') === 's') return strings[Number(child(cell, 'v')?.textContent)] ?? '';
  if (cell.getAttribute('t') === 'inlineStr') return nodes(cell, 't').map((t) => t.textContent).join('');
  return child(cell, 'v')?.textContent ?? '';
}

function inspectSheet(zip, path, strings) {
  const doc = xmlFromZip(zip, path);
  const sheetData = nodes(doc, 'sheetData')[0];
  if (!sheetData) return null;
  const rows = [...sheetData.children].filter((r) => r.localName === 'row');
  let header = null;
  let folioColumns = [];
  for (const row of rows) {
    const matches = [...row.children].filter((c) => c.localName === 'c' && cellValue(c, strings).trim().toUpperCase() === 'FOLIO').map((c) => colToNumber(c.getAttribute('r')));
    if (matches.length > folioColumns.length) { header = Number(row.getAttribute('r')); folioColumns = matches; }
  }
  if (!header || !folioColumns.length) return null;
  const slots = [];
  for (const folioCol of folioColumns) {
    for (const row of rows) {
      const rowNumber = Number(row.getAttribute('r'));
      if (rowNumber <= header) continue;
      const numberCell = cellAt(row, folioCol - 2);
      const rfcCell = cellAt(row, folioCol - 1);
      const folioCell = cellAt(row, folioCol);
      const number = cellValue(numberCell, strings).trim();
      const rfc = cellValue(rfcCell, strings).trim();
      const folio = cellValue(folioCell, strings).trim();
      if (!/^\d+$/.test(number) || !rfc || !folio) continue;
      if (child(rfcCell, 'f') || child(folioCell, 'f')) throw new Error('Hay fórmulas en RFC o folio; este archivo requiere revisión manual antes de ordenarlo.');
      slots.push({ row, rowNumber, numberCell, rfcCell, folioCell, rfc, folio, number: Number(number), col: folioCol });
    }
  }
  if (!slots.length) return null;
  slots.sort((a, b) => a.number - b.number || a.col - b.col || a.rowNumber - b.rowNumber);
  return { doc, sheetData, slots, path, sheetName: path.split('/').pop().replace('.xml', '') };
}

export function readBook(bytes) {
  let zip;
  try { zip = unzipSync(bytes); } catch { throw new Error('No se pudo abrir el archivo. Elige un Excel .xlsx válido.'); }
  const strings = sharedStrings(zip);
  const paths = Object.keys(zip).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort((a, b) => Number(a.match(/sheet(\d+)/)[1]) - Number(b.match(/sheet(\d+)/)[1]));
  for (const path of paths) {
    const sheet = inspectSheet(zip, path, strings);
    if (sheet) return { zip, sheet };
  }
  throw new Error('No encontré columnas de RFC y FOLIO con registros en este archivo.');
}

function setContent(target, source) {
  target.removeAttribute('t');
  if (source.getAttribute('t')) target.setAttribute('t', source.getAttribute('t'));
  for (const node of [...target.children]) target.removeChild(node);
  for (const node of [...source.children]) target.appendChild(target.ownerDocument.importNode(node, true));
}

function makeInlineCell(doc, ref, value, style) {
  const cell = doc.createElementNS(NS, 'c');
  cell.setAttribute('r', ref);
  cell.setAttribute('t', 'inlineStr');
  if (style != null) cell.setAttribute('s', String(style));
  const is = doc.createElementNS(NS, 'is');
  const t = doc.createElementNS(NS, 't');
  t.textContent = value;
  is.appendChild(t);
  cell.appendChild(is);
  return cell;
}

function makeStyledBlank(doc, ref, style) {
  const cell = doc.createElementNS(NS, 'c');
  cell.setAttribute('r', ref);
  cell.setAttribute('s', String(style));
  return cell;
}

function stylePainter(zip) {
  const doc = xmlFromZip(zip, 'xl/styles.xml');
  const fills = nodes(doc, 'fills')[0];
  const xfs = nodes(doc, 'cellXfs')[0];
  if (!fills || !xfs) throw new Error('El archivo no tiene estilos de Excel compatibles.');
  const originalXfs = [...xfs.children];
  const cache = new Map();
  const fillIds = new Map();
  function styled(baseId, color, wrap = false) {
    const key = `${baseId}:${color}:${wrap}`;
    if (cache.has(key)) return cache.get(key);
    if (!fillIds.has(color)) {
      const fill = doc.createElementNS(NS, 'fill');
      const pattern = doc.createElementNS(NS, 'patternFill');
      pattern.setAttribute('patternType', 'solid');
      const fg = doc.createElementNS(NS, 'fgColor');
      fg.setAttribute('rgb', `FF${color}`);
      const bg = doc.createElementNS(NS, 'bgColor');
      bg.setAttribute('indexed', '64');
      pattern.append(fg, bg); fill.appendChild(pattern); fills.appendChild(fill);
      fillIds.set(color, fills.children.length - 1);
    }
    const base = originalXfs[Number(baseId)] || originalXfs[0];
    const xf = base.cloneNode(true);
    xf.setAttribute('fillId', String(fillIds.get(color)));
    xf.setAttribute('applyFill', '1');
    if (wrap) {
      let alignment = child(xf, 'alignment');
      if (!alignment) { alignment = doc.createElementNS(NS, 'alignment'); xf.appendChild(alignment); }
      alignment.setAttribute('wrapText', '1');
      alignment.setAttribute('vertical', 'center');
      xf.setAttribute('applyAlignment', '1');
    }
    xfs.appendChild(xf);
    const id = xfs.children.length - 1;
    cache.set(key, id);
    return id;
  }
  return { doc, styled, finalize() { fills.setAttribute('count', String(fills.children.length)); xfs.setAttribute('count', String(xfs.children.length)); } };
}

export function generateBook(book, names) {
  const zip = { ...book.zip };
  const { path } = book.sheet;
  const { doc, sheetData, slots } = inspectSheet(zip, path, sharedStrings(zip));
  const styles = stylePainter(zip);
  const sorted = slots.map((slot) => ({ rfc: slot.rfc, folio: slot.folio, rfcCell: slot.rfcCell.cloneNode(true), folioCell: slot.folioCell.cloneNode(true) }))
    .sort((a, b) => a.rfc.localeCompare(b.rfc, 'es', { sensitivity: 'base' }) || a.folio.localeCompare(b.folio, 'es', { numeric: true }));
  const sizes = distribute(slots.length, names.length);
  let owner = 0, nextBoundary = sizes[0];
  slots.forEach((slot, i) => {
    while (i >= nextBoundary) nextBoundary += sizes[++owner];
    setContent(slot.rfcCell, sorted[i].rfcCell);
    setContent(slot.folioCell, sorted[i].folioCell);
    const color = hexColor(colorFor(owner));
    for (const cell of [slot.numberCell, slot.rfcCell, slot.folioCell]) {
      cell.setAttribute('s', String(styles.styled(cell.getAttribute('s') || '0', color)));
    }
  });

  const lastExisting = Math.max(...[...sheetData.children].filter((r) => r.localName === 'row').map((r) => Number(r.getAttribute('r'))));
  const headingRow = lastExisting + 3;
  const heading = doc.createElementNS(NS, 'row');
  heading.setAttribute('r', String(headingRow));
  heading.appendChild(makeInlineCell(doc, `A${headingRow}`, 'DISTRIBUCIÓN POR PERSONA', slots[0].numberCell.getAttribute('s')));
  sheetData.appendChild(heading);
  const merges = nodes(doc, 'mergeCells')[0];
  function addMerge(ref) {
    if (!merges) return;
    const merge = doc.createElementNS(NS, 'mergeCell');
    merge.setAttribute('ref', ref);
    merges.appendChild(merge);
  }
  addMerge(`A${headingRow}:D${headingRow}`);
  names.forEach((name, i) => {
    const rowNumber = headingRow + i + 1;
    const row = doc.createElementNS(NS, 'row');
    row.setAttribute('r', String(rowNumber));
    row.setAttribute('ht', '30');
    row.setAttribute('customHeight', '1');
    const color = hexColor(colorFor(i));
    const base = slots[0].numberCell.getAttribute('s') || '0';
    const style = styles.styled(base, color, true);
    row.appendChild(makeInlineCell(doc, `A${rowNumber}`, `${i + 1}. ${name}`, style));
    row.appendChild(makeStyledBlank(doc, `B${rowNumber}`, style));
    row.appendChild(makeStyledBlank(doc, `C${rowNumber}`, style));
    row.appendChild(makeInlineCell(doc, `D${rowNumber}`, `${sizes[i]} registros`, style));
    sheetData.appendChild(row);
    addMerge(`A${rowNumber}:C${rowNumber}`);
  });
  if (merges) merges.setAttribute('count', String(merges.children.length));
  const lastRow = headingRow + names.length;
  const dimension = nodes(doc, 'dimension')[0];
  if (dimension) dimension.setAttribute('ref', dimension.getAttribute('ref').replace(/\d+$/, String(lastRow)));
  styles.finalize();
  zip['xl/styles.xml'] = encoder.encode(new XMLSerializer().serializeToString(styles.doc));
  zip[path] = encoder.encode(new XMLSerializer().serializeToString(doc));
  if (zip['xl/workbook.xml']) {
    const workbook = xmlFromZip(zip, 'xl/workbook.xml');
    for (const defined of nodes(workbook, 'definedName')) {
      if (defined.getAttribute('name') === '_xlnm.Print_Area') defined.textContent = defined.textContent.replace(/\$\d+$/, `$${lastRow}`);
    }
    zip['xl/workbook.xml'] = encoder.encode(new XMLSerializer().serializeToString(workbook));
  }
  return zipSync(zip, { level: 6 });
}
