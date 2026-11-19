import { unzipSync } from 'fflate';

export function parseRosterExcel(bytes) {
  let zip;
  try { zip = unzipSync(bytes); } catch { throw new Error('No se pudo abrir el Excel .xlsx.'); }
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const decoder = new TextDecoder();
  const xml = (path) => {
    if (!zip[path]) throw new Error(`El Excel no contiene ${path}.`);
    const doc = new DOMParser().parseFromString(decoder.decode(zip[path]), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('El Excel tiene XML inválido.');
    return doc;
  };
  const nodes = (root, name) => [...root.getElementsByTagNameNS(ns, name)];
  const child = (root, name) => [...root.children].find((item) => item.localName === name);
  const col = (ref) => [...ref.match(/^[A-Z]+/)[0]].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0);
  const strings = zip['xl/sharedStrings.xml'] ? nodes(xml('xl/sharedStrings.xml'), 'si').map((item) => nodes(item, 't').map((t) => t.textContent).join('')) : [];
  const value = (cell) => !cell ? '' : cell.getAttribute('t') === 's' ? strings[Number(child(cell, 'v')?.textContent)] || ''
    : cell.getAttribute('t') === 'inlineStr' ? nodes(cell, 't').map((t) => t.textContent).join('') : child(cell, 'v')?.textContent || '';
  const paths = Object.keys(zip).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).sort((a, b) => Number(a.match(/sheet(\d+)/)[1]) - Number(b.match(/sheet(\d+)/)[1]));
  for (const path of paths) {
    const rows = nodes(xml(path), 'row');
    let header = 0, folioCols = [];
    for (const row of rows) {
      const matches = [...row.children].filter((cell) => cell.localName === 'c' && value(cell).trim().toUpperCase() === 'FOLIO').map((cell) => col(cell.getAttribute('r')));
      if (matches.length > folioCols.length) { header = Number(row.getAttribute('r')); folioCols = matches; }
    }
    if (!header) continue;
    const records = [];
    for (const folioCol of folioCols) for (const row of rows) {
      if (Number(row.getAttribute('r')) <= header) continue;
      const cellAt = (column) => [...row.children].find((cell) => cell.localName === 'c' && col(cell.getAttribute('r')) === column);
      const number = value(cellAt(folioCol - 2)).trim();
      const rfc = value(cellAt(folioCol - 1)).trim();
      const folio = value(cellAt(folioCol)).trim();
      if (/^\d+$/.test(number) && rfc && folio) records.push({ rfc, folio });
    }
    if (records.length) return records.sort((a, b) => a.rfc.localeCompare(b.rfc, 'es', { sensitivity: 'base' }) || a.folio.localeCompare(b.folio, 'es', { numeric: true }));
  }
  throw new Error('No encontré columnas RFC y FOLIO con registros.');
}
