const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const $ = (id) => document.getElementById(id);
const palette = ['#DCEBFF', '#FCE3D7', '#DDF2DF', '#F7E5F4', '#FFF0C8', '#E4E3FF', '#D6F1EE', '#F9DFE8', '#E8EBCB', '#E4E9F2', '#F7E7CF', '#DCEAD9'];
let selectedFile = null;
let parsedBook = null;
let verification = [];
let verified = new Set();
let verificationKey = '';
let roomSecret = '';
let sharedFileName = '';
let syncBusy = false;
const lastRoomKey = 'ordenar-fup:last-team-room';
let cameraStream = null;
let ocrWorker = null;
let readingFolio = false;

function colorFor(index) {
  if (index < palette.length) return palette[index];
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 65% 87%)`;
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

function readBook(bytes) {
  let zip;
  try { zip = fflate.unzipSync(bytes); } catch { throw new Error('No se pudo abrir el archivo. Elige un Excel .xlsx válido.'); }
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

function distribute(total, count) {
  return Array.from({ length: count }, (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0));
}

function generateBook(book, names) {
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
  return fflate.zipSync(zip, { level: 6 });
}

function setStatus(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }

function countValue() {
  const maximum = parsedBook?.sheet.slots.length || 350;
  const raw = Number($('personCount').value);
  return Math.max(1, Math.min(maximum, Number.isFinite(raw) ? Math.round(raw) : 1));
}

function renderPeople() {
  const count = countValue();
  $('personCount').value = String(count);
  const old = [...$('peopleList').querySelectorAll('input')].map((input) => input.value);
  const sizes = parsedBook ? distribute(parsedBook.sheet.slots.length, count) : [];
  $('peopleList').replaceChildren();
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div'); row.className = 'person-row';
    const swatch = document.createElement('span'); swatch.className = 'swatch'; swatch.style.backgroundColor = colorFor(i);
    const label = document.createElement('label'); label.htmlFor = `person-${i}`; label.textContent = `Persona ${i + 1}`;
    const input = document.createElement('input'); input.id = `person-${i}`; input.maxLength = 80; input.placeholder = 'Escribe su nombre'; input.value = old[i] ?? '';
    const size = document.createElement('small'); size.textContent = parsedBook ? `${sizes[i]} reg.` : '—';
    row.append(swatch, label, input, size); $('peopleList').appendChild(row);
  }
  $('distributionNote').textContent = parsedBook ? `Reparto equilibrado de ${parsedBook.sheet.slots.length} registros. Los grupos siguen el orden alfabético.` : 'Carga un archivo para ver el reparto.';
  $('generate').disabled = !parsedBook;
  $('stepTwo').classList.toggle('active', !!parsedBook);
}

async function loadFile(file) {
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name)) { setStatus('Selecciona un archivo con extensión .xlsx.', true); return; }
  if (file.size > 30 * 1024 * 1024) { setStatus('El archivo supera 30 MB. Usa un libro más pequeño.', true); return; }
  setStatus('Leyendo el archivo…');
  $('generate').disabled = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    parsedBook = readBook(bytes); selectedFile = file;
    roomSecret = '';
    try { localStorage.removeItem(lastRoomKey); } catch {}
    const url = new URL(location.href); url.searchParams.delete('s'); history.replaceState(null, '', url);
    await prepareVerification(bytes);
    $('fileName').textContent = file.name;
    $('fileDetails').textContent = `${(file.size / 1024).toFixed(0)} KB · ${parsedBook.sheet.slots.length} registros`;
    $('fileSummary').hidden = false;
    $('uploadTitle').textContent = 'Archivo cargado correctamente';
    $('uploadSubtitle').textContent = 'Puedes cambiarlo antes de descargar';
    $('totalRecords').innerHTML = `${parsedBook.sheet.slots.length} <span>registros detectados</span>`;
    renderPeople(); setStatus('Archivo listo. Escribe los nombres y genera el Excel.');
  } catch (error) {
    parsedBook = null; selectedFile = null; $('fileSummary').hidden = true;
    verification = []; verified = new Set(); verificationKey = ''; sharedFileName = ''; renderVerification();
    $('uploadTitle').textContent = 'Arrastra tu Excel aquí';
    $('uploadSubtitle').textContent = 'o haz clic para elegir un archivo .xlsx';
    $('totalRecords').innerHTML = '— <span>registros detectados</span>';
    renderPeople(); setStatus(error.message, true);
  }
}

async function prepareVerification(bytes) {
  verification = parsedBook.sheet.slots.map((slot, index) => ({ id: String(index), folio: slot.folio, digits: slot.folio.match(/^\s*(\d+)/)?.[1] || '', rfc: slot.rfc }));
  sharedFileName = selectedFile.name;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  verificationKey = 'ordenar-fup:verificacion:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  try { verified = new Set(JSON.parse(localStorage.getItem(verificationKey) || '[]').filter((id) => verification.some((item) => item.id === id))); }
  catch { verified = new Set(); }
  $('verifyFileName').textContent = selectedFile.name;
  renderVerification();
  showVerifyMessage(`${verification.length} folios cargados. Puedes comenzar a escanear.`);
}

function saveVerification() {
  if (roomSecret) return;
  try { localStorage.setItem(verificationKey, JSON.stringify([...verified])); }
  catch { showVerifyMessage('La verificación funciona, pero este navegador no pudo guardar el avance.', true); }
}

function showVerifyMessage(message, error = false) {
  $('verifyMessage').textContent = message;
  $('verifyMessage').classList.toggle('error', error);
}

function renderVerification() {
  const total = verification.length;
  $('verifyCount').textContent = `${verified.size} / ${total}`;
  $('remainingCount').textContent = total ? `${total - verified.size} pendientes` : 'Abre el enlace del equipo para activar la cámara';
  $('progressFill').style.width = total ? `${verified.size / total * 100}%` : '0%';
  $('listTitle').textContent = $('pendingOnly').checked ? 'Folios pendientes' : 'Todos los folios';
  $('shareButton').hidden = !!roomSecret;
  $('copyLink').hidden = !roomSecret;
  $('joinForm').hidden = !!total;
  $('shareButton').disabled = !parsedBook || !!roomSecret;
  $('shareState').textContent = roomSecret ? 'Lista compartida · las marcas se sincronizan entre dispositivos.' : total ? 'Lista solo en este dispositivo. Crea el enlace para compartirla.' : 'Pega el enlace privado de equipo para ver el listado.';
  $('openCamera').textContent = total ? '▣ Escanear con cámara' : 'Abre la lista para usar cámara';
  document.querySelector('.photo-button').hidden = !total;
  for (const id of ['openCamera', 'photoInput', 'manualFolio', 'exportReport', 'folioSearch', 'pendingOnly', 'clearProgress']) $(id).disabled = !total;
  $('manualForm').querySelector('button').disabled = !total;
  const query = $('folioSearch').value.trim().toUpperCase();
  const visible = verification.filter((item) => (!$('pendingOnly').checked || !verified.has(item.id)) && (!query || item.folio.toUpperCase().includes(query) || item.rfc.toUpperCase().includes(query)));
  const list = $('verifyList');
  list.replaceChildren();
  if (!total || !visible.length) {
    const empty = document.createElement('p'); empty.className = 'empty-list'; empty.textContent = total ? 'No hay folios con este filtro.' : 'Carga tu Excel para ver los folios.'; list.appendChild(empty); return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of visible) {
    const row = document.createElement('label'); row.className = `verify-row${verified.has(item.id) ? ' checked' : ''}`;
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = verified.has(item.id); box.dataset.id = item.id; box.setAttribute('aria-label', `Verificado: folio ${item.folio}, RFC ${item.rfc}`);
    const folio = document.createElement('strong'); folio.textContent = item.folio;
    const rfc = document.createElement('span'); rfc.textContent = item.rfc;
    row.append(box, folio, rfc); fragment.appendChild(row);
  }
  list.appendChild(fragment);
}

async function markFolio(raw) {
  const digits = String(raw).trim();
  if (!/^\d+$/.test(digits)) { showVerifyMessage('Escribe o escanea solo los dígitos del folio.', true); return false; }
  const matches = verification.filter((item) => item.digits === digits);
  if (!matches.length) { showVerifyMessage(`El folio ${digits} no aparece en este Excel. Revisa el documento o el archivo.`, true); return false; }
  if (matches.length > 1) { showVerifyMessage(`El folio ${digits} aparece ${matches.length} veces. Búscalo en la lista y marca el RFC correcto.`, true); $('folioSearch').value = digits; renderVerification(); return false; }
  const item = matches[0];
  if (verified.has(item.id)) { showVerifyMessage(`El folio ${digits} ya estaba verificado (${item.rfc}).`); return true; }
  try { if (roomSecret) await sharedRpc('set_mark', { p_secret: roomSecret, p_record_id: Number(item.id), p_checked: true }); }
  catch (error) { showVerifyMessage(`No se pudo sincronizar el folio: ${error.message}`, true); return false; }
  verified.add(item.id); saveVerification(); renderVerification();
  showVerifyMessage(`✓ Folio ${digits} verificado · ${item.rfc}`);
  return true;
}

function setMode(mode) {
  const verifyMode = mode === 'verify';
  $('organizeView').hidden = verifyMode; $('verifyView').hidden = !verifyMode;
  $('organizeTab').classList.toggle('selected', !verifyMode); $('verifyTab').classList.toggle('selected', verifyMode);
  $('organizeTab').setAttribute('aria-pressed', String(!verifyMode)); $('verifyTab').setAttribute('aria-pressed', String(verifyMode));
  $('status').hidden = verifyMode;
  if (!verifyMode) closeCamera();
}

async function sharedRpc(name, params) {
  const config = window.FUP_SUPABASE;
  if (!config?.url || !config?.key) throw new Error('La conexión compartida aún no está configurada.');
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'Content-Profile': 'fup-sep' },
    body: JSON.stringify(params),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Error ${response.status}`);
  return data;
}

function roomLink() {
  const url = new URL(location.href); url.searchParams.set('s', roomSecret); return url.href;
}

function readRoomSecret(raw) {
  const value = String(raw).trim();
  if (/^[0-9a-f]{64}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const secret = url.searchParams.get('s') || '';
    return url.origin === location.origin && /^[0-9a-f]{64}$/.test(secret) ? secret : '';
  } catch { return ''; }
}

async function joinRoom(raw) {
  const secret = readRoomSecret(raw);
  if (!secret) { setMode('verify'); showVerifyMessage('Pega el enlace privado completo del equipo.', true); return; }
  roomSecret = secret;
  history.replaceState(null, '', roomLink());
  showVerifyMessage('Abriendo lista del equipo…');
  await syncRoom(true);
}

async function publishRoom() {
  if (!parsedBook || roomSecret) return;
  $('shareButton').disabled = true; $('shareState').textContent = 'Creando enlace…';
  try {
    const records = verification.map(({ id, folio, rfc }) => ({ folio, rfc, checked: verified.has(id) }));
    const secret = await sharedRpc('create_room', { p_file_name: selectedFile.name, p_records: records });
    if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('La base de datos no devolvió un enlace válido.');
    roomSecret = secret; verificationKey = '';
    try { localStorage.setItem(lastRoomKey, secret); } catch {}
    history.replaceState(null, '', roomLink()); renderVerification();
    showVerifyMessage('Enlace listo. Compártelo con quienes van a escanear.');
    await copyRoomLink();
  } catch (error) { $('shareButton').disabled = false; $('shareState').textContent = 'No se pudo crear el enlace.'; showVerifyMessage(error.message, true); }
}

async function copyRoomLink() {
  try { await navigator.clipboard.writeText(roomLink()); showVerifyMessage('Enlace copiado. Envíalo a tu equipo.'); }
  catch { showVerifyMessage('El enlace está en la barra del navegador. Cópialo para compartirlo.'); }
}

async function syncRoom(initial = false) {
  if (!roomSecret || syncBusy || (!initial && document.hidden)) return;
  syncBusy = true;
  try {
    const data = await sharedRpc('get_room', { p_secret: roomSecret });
    if (!data || !Array.isArray(data.records) || !Array.isArray(data.verified)) throw new Error('No se encontró esta lista compartida. Comprueba el enlace.');
    sharedFileName = data.fileName || 'Listado FUP';
    verification = data.records.map((item, index) => ({ id: String(index), folio: String(item.folio), digits: String(item.folio).match(/^\s*(\d+)/)?.[1] || '', rfc: String(item.rfc) }));
    const next = new Set(data.verified.map(String));
    const changed = initial || next.size !== verified.size || [...next].some((id) => !verified.has(id));
    verified = next;
    if (changed) renderVerification();
    if (initial) { try { localStorage.setItem(lastRoomKey, roomSecret); } catch {} $('verifyFileName').textContent = sharedFileName; setMode('verify'); showVerifyMessage('Lista compartida cargada. Ya puedes escanear con tu equipo.'); }
  } catch (error) { if (initial) { try { localStorage.removeItem(lastRoomKey); } catch {} roomSecret = ''; renderVerification(); setMode('verify'); } showVerifyMessage(`Sincronización: ${error.message}`, true); }
  finally { syncBusy = false; }
}

async function getOcrWorker() {
  if (!window.Tesseract) throw new Error('No se pudo cargar el lector de texto. Comprueba tu conexión e inténtalo de nuevo.');
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker('eng');
    await ocrWorker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  }
  return ocrWorker;
}

async function readImage(image) {
  if (readingFolio) return;
  readingFolio = true; $('captureFolio').disabled = true;
  $('cameraMessage').textContent = 'Leyendo número…'; showVerifyMessage('Leyendo número de documento…');
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(image);
    const candidates = [...new Set((data.text.match(/\d{3,9}/g) || []).map((value) => value.trim()))];
    const known = candidates.filter((candidate) => verification.some((item) => item.digits === candidate));
    if (known.length === 1 && data.confidence >= 45) {
      const accepted = candidates.length === 1 || confirm(`La foto contiene varios números (${candidates.join(', ')}). ¿El folio del documento es ${known[0]}?`);
      const success = accepted && await markFolio(known[0]);
      $('cameraMessage').textContent = success ? `Leído: ${known[0]}. Coloca el siguiente documento.` : 'Comprueba el folio en la lista.';
      if (!accepted) showVerifyMessage('No se marcó ningún folio. Acerca la cámara al número o escríbelo.');
    } else if (candidates.length > 1 || known.length > 1) {
      $('cameraMessage').textContent = `Se leyeron varios números: ${candidates.join(', ')}.`;
      showVerifyMessage('Se detectaron varios números. Acerca la cámara a un solo folio o escríbelo.', true);
    } else if (known.length === 1) {
      $('cameraMessage').textContent = `Lectura poco clara: ${known[0]}.`;
      showVerifyMessage(`No se marcó ${known[0]} porque la imagen no es suficientemente clara. Inténtalo de nuevo o escríbelo.`, true);
    } else {
      const detected = candidates.join(', ');
      $('cameraMessage').textContent = detected ? `Leído: ${detected}. No se encontró en el Excel.` : 'No se pudo leer el número. Acerca más la cámara.';
      showVerifyMessage(detected ? `No se encontró ${detected} en este Excel. Revisa el folio o escríbelo.` : 'No se pudo leer el folio. Intenta otra foto o escríbelo.', true);
    }
  } catch (error) { $('cameraMessage').textContent = error.message; showVerifyMessage(error.message, true); }
  finally { readingFolio = false; $('captureFolio').disabled = false; }
}

async function openCamera() {
  if (!verification.length) return;
  if (!navigator.mediaDevices?.getUserMedia) { showVerifyMessage('Este navegador no permite escaneo en vivo. Toca «Abrir cámara para tomar foto».', true); return; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    $('cameraVideo').srcObject = cameraStream;
    $('cameraModal').hidden = false;
    await $('cameraVideo').play();
  } catch (error) {
    closeCamera();
    const reason = error?.name === 'NotAllowedError' ? 'El permiso de cámara fue rechazado.'
      : error?.name === 'NotFoundError' ? 'No se encontró una cámara en este dispositivo.'
      : error?.name === 'NotReadableError' ? 'La cámara está ocupada por otra aplicación.'
      : 'Este navegador no pudo abrir la cámara en vivo.';
    showVerifyMessage(`${reason} Toca «Abrir cámara para tomar foto» o prueba en Chrome o Safari.`, true);
  }
}

function closeCamera() {
  $('cameraModal').hidden = true;
  $('cameraVideo').pause(); $('cameraVideo').srcObject = null;
  cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null;
}

function captureCamera() {
  const video = $('cameraVideo');
  if (!video.videoWidth) { $('cameraMessage').textContent = 'Espera a que aparezca la imagen de la cámara.'; return; }
  const canvas = document.createElement('canvas');
  const w = video.videoWidth * .78, h = video.videoHeight * .23;
  canvas.width = Math.round(w * 2); canvas.height = Math.round(h * 2);
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(video, (video.videoWidth - w) / 2, (video.videoHeight - h) / 2, w, h, 0, 0, canvas.width, canvas.height);
  readImage(canvas);
}

function downloadReport() {
  const lines = [['Folio', 'RFC', 'Estado'], ...verification.map((item) => [item.folio, item.rfc, verified.has(item.id) ? 'Verificado' : 'Pendiente'])];
  const csv = '\ufeff' + lines.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${sharedFileName.replace(/\.xlsx$/i, '')}_verificacion.csv`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

$('fileInput').addEventListener('change', (event) => loadFile(event.target.files[0]));
$('verifyFileInput').addEventListener('change', async (event) => { await loadFile(event.target.files[0]); if (parsedBook && !roomSecret) await publishRoom(); });
$('joinForm').addEventListener('submit', (event) => { event.preventDefault(); joinRoom($('joinLink').value); });
$('shareButton').addEventListener('click', publishRoom);
$('copyLink').addEventListener('click', copyRoomLink);
$('organizeTab').addEventListener('click', () => setMode('organize'));
$('verifyTab').addEventListener('click', () => setMode('verify'));
$('manualForm').addEventListener('submit', async (event) => { event.preventDefault(); if (await markFolio($('manualFolio').value)) $('manualFolio').value = ''; });
$('verifyList').addEventListener('change', async (event) => {
  if (event.target.type !== 'checkbox') return;
  const id = event.target.dataset.id;
  const checked = event.target.checked;
  try { if (roomSecret) await sharedRpc('set_mark', { p_secret: roomSecret, p_record_id: Number(id), p_checked: checked }); }
  catch (error) { event.target.checked = !checked; showVerifyMessage(`No se pudo sincronizar: ${error.message}`, true); return; }
  if (checked) verified.add(id); else verified.delete(id);
  saveVerification(); renderVerification();
  showVerifyMessage(checked ? 'Documento marcado manualmente.' : 'Documento devuelto a pendientes.');
});
$('folioSearch').addEventListener('input', renderVerification);
$('pendingOnly').addEventListener('change', renderVerification);
$('clearProgress').addEventListener('click', async () => { if (!verified.size || !confirm('¿Reiniciar todos los folios verificados de este Excel para todo el equipo?')) return; try { if (roomSecret) await sharedRpc('clear_marks', { p_secret: roomSecret }); verified.clear(); saveVerification(); renderVerification(); showVerifyMessage('Verificación reiniciada.'); } catch (error) { showVerifyMessage(`No se pudo reiniciar: ${error.message}`, true); } });
$('exportReport').addEventListener('click', downloadReport);
$('openCamera').addEventListener('click', openCamera);
$('closeCamera').addEventListener('click', closeCamera);
$('captureFolio').addEventListener('click', captureCamera);
$('cameraModal').addEventListener('click', (event) => { if (event.target === $('cameraModal')) closeCamera(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('cameraModal').hidden) closeCamera(); });
$('photoInput').addEventListener('change', (event) => { const file = event.target.files[0]; if (file) readImage(file); event.target.value = ''; });
$('changeFile').addEventListener('click', () => $('fileInput').click());
$('minus').addEventListener('click', () => { $('personCount').value = String(countValue() - 1); renderPeople(); });
$('plus').addEventListener('click', () => { $('personCount').value = String(countValue() + 1); renderPeople(); });
$('personCount').addEventListener('change', renderPeople);
$('personCount').addEventListener('input', renderPeople);
const dropzone = $('dropzone');
for (const name of ['dragenter', 'dragover']) dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add('drag'); });
for (const name of ['dragleave', 'drop']) dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));
$('generate').addEventListener('click', () => {
  if (!parsedBook) return;
  const names = [...$('peopleList').querySelectorAll('input')].map((input, i) => input.value.trim() || `Persona ${i + 1}`);
  $('generate').disabled = true; setStatus('Generando el Excel…');
  setTimeout(() => {
    try {
      const bytes = generateBook(parsedBook, names);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `${selectedFile.name.replace(/\.xlsx$/i, '')}_ordenado.xlsx`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      $('stepThree').classList.add('active'); setStatus('Excel generado y descargado correctamente.');
    } catch (error) { setStatus(`No se pudo generar el archivo: ${error.message}`, true); }
    $('generate').disabled = false;
  }, 20);
});

renderPeople();
renderVerification();
const linkSecret = new URL(location.href).searchParams.get('s');
let savedSecret = '';
try { savedSecret = localStorage.getItem(lastRoomKey) || ''; } catch {}
if (linkSecret || savedSecret) joinRoom(linkSecret || savedSecret);
setInterval(() => syncRoom(), 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncRoom(); });
