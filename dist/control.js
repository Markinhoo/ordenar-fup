const $ = (id) => document.getElementById(id);
const config = window.FUP_SUPABASE;
const sessionKey = 'ordenar-fup:auth-session';
const lastBatchKey = 'ordenar-fup:last-v2-batch';
const state = { session: null, account: null, isAdmin: false, batch: null, batches: [], fileRecords: [], fileName: '', section: 'waiting', history: [], historyMore: false, scan: null, stream: null, ocr: null, reading: false, busy: false };

function message(text, error = false, target = 'appMessage') {
  $(target).textContent = text;
  $(target).classList.toggle('error', error);
}

function saveSession(session) {
  if (!session?.access_token || !session?.refresh_token) return false;
  state.session = { access_token: session.access_token, refresh_token: session.refresh_token,
    expires_at: Date.now() + (session.expires_in || 3600) * 1000,
    email: session.user?.email || state.session?.email || '' };
  localStorage.setItem(sessionKey, JSON.stringify(state.session));
  return true;
}

async function authRequest(path, body, token = config.key) {
  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || `Error ${response.status}`);
  return data;
}

async function ensureSession() {
  if (!state.session) throw new Error('Inicia sesión primero.');
  if (state.session.expires_at > Date.now() + 60000) return state.session.access_token;
  try {
    const data = await authRequest('token?grant_type=refresh_token', { refresh_token: state.session.refresh_token });
    saveSession(data);
    return state.session.access_token;
  } catch {
    localStorage.removeItem(sessionKey); state.session = null;
    showAuth(); throw new Error('La sesión terminó. Entra de nuevo.');
  }
}

async function rpc(name, params = {}) {
  const token = await ensureSession();
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: config.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Profile': 'fup-sep' },
    body: JSON.stringify(params),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Error ${response.status}`);
  return data;
}

async function accounts(action, params = {}, publicRequest = false) {
  const token = publicRequest ? config.key : await ensureSession();
  const response = await fetch(`${config.url}/functions/v1/fup-accounts`, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: config.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

function showAuth() {
  $('authPanel').hidden = false; $('appPanel').hidden = true;
  $('logout').hidden = true; $('organizerLink').hidden = true; $('accountButton').hidden = true;
  $('usersButton').hidden = true; $('signedEmail').textContent = '';
  const invite = new URL(location.href).searchParams.get('invite');
  $('inviteNotice').textContent = invite
    ? 'Este QR está asignado a un correo específico. Entra con la cuenta que creó la encargada para ese correo.'
    : 'La cuenta administradora crea usuarios y carga el Excel; el equipo verifica los documentos.';
}

async function showApp() {
  $('authPanel').hidden = true; $('appPanel').hidden = false;
  $('logout').hidden = false; $('signedEmail').textContent = state.session.email;
  $('setupTab').hidden = true; $('organizerLink').hidden = true; $('usersButton').hidden = true;
  try {
    state.account = await accounts('profile');
    state.isAdmin = state.account.isAdmin === true;
    $('organizerLink').hidden = !state.isAdmin;
    $('accountButton').hidden = false;
    $('usersButton').hidden = !state.isAdmin;
    $('setupTab').hidden = !state.isAdmin;
    await bootstrap();
    if (!state.account.recoverySet) { openAccount(false); message('Configura tu pregunta de respaldo para recuperar tu acceso.'); }
  } catch (error) { state.isAdmin = false; message(error.message, true); showSection('waiting'); }
}

async function bootstrap() {
  const url = new URL(location.href);
  const invite = url.searchParams.get('invite');
  if (invite) {
    const claim = await rpc('v2_claim_worker', { p_token: invite });
    url.searchParams.delete('invite'); url.searchParams.set('b', claim.batchId);
    history.replaceState(null, '', url);
    localStorage.setItem(lastBatchKey, claim.batchId);
    message(`Acceso activado para ${claim.name}.`);
  }
  await refreshBatches();
  const candidates = [...new Set([url.searchParams.get('b'), localStorage.getItem(lastBatchKey), state.batches[0]?.id].filter(Boolean))];
  for (const batchId of candidates) {
    try { await openBatch(batchId); return; }
    catch (error) { if (batchId === url.searchParams.get('b')) message(error.message, true); }
  }
  showSection(state.isAdmin ? 'setup' : 'waiting');
}

async function refreshBatches() {
  state.batches = await rpc('v2_list_batches');
  const selector = $('batchSelector'); selector.replaceChildren();
  for (const batch of state.batches) {
    const option = document.createElement('option'); option.value = batch.id;
    option.textContent = `${batch.qna} · ${batch.fileName}`; selector.appendChild(option);
  }
  selector.hidden = !state.isAdmin || !state.batches.length;
  $('historyTab').hidden = !state.isAdmin || !state.batches.length;
  $('newBatch').hidden = !state.isAdmin || !state.batches.length;
  const qnas = [...new Set(state.batches.map((batch) => batch.qna))].sort().reverse();
  $('historyQna').replaceChildren(new Option('Todas las QNAs', ''), ...qnas.map((qna) => new Option(qnaLabel(qna), qna)));
}

function qnaLabel(qna) {
  const [year, month, half] = qna.split('-');
  return `${half === '1' ? '1ª' : '2ª'} QNA ${month}/${year}`;
}

async function openBatch(id) {
  const data = await rpc('v2_get_batch', { p_batch_id: id });
  state.batch = data;
  localStorage.setItem(lastBatchKey, id);
  const url = new URL(location.href); url.searchParams.set('b', id); history.replaceState(null, '', url);
  $('batchMeta').textContent = `${qnaLabel(data.qna)} · ${data.fileName} · ${data.records.length} registros`;
  $('pageTitle').textContent = data.isAdmin ? 'Control de la encargada' : 'Escaneo de documentos';
  $('setupTab').hidden = !data.isAdmin;
  $('historyTab').hidden = !data.isAdmin;
  $('newBatch').hidden = !data.isAdmin;
  $('batchSelector').hidden = !data.isAdmin || !state.batches.length;
  if (data.isAdmin) $('batchSelector').value = id;
  renderBatch(); showSection('list');
  if (data.isAdmin) await loadHistory();
}

function showSection(name) {
  if (name === 'history' && !state.batch?.isAdmin) name = state.batch ? 'list' : 'waiting';
  if (name === 'setup' && !state.isAdmin) name = state.batch ? 'list' : 'waiting';
  if (name === 'list' && !state.batch) name = state.isAdmin ? 'setup' : 'waiting';
  state.section = name;
  for (const section of ['setup', 'waiting', 'list', 'history']) {
    $(`${section}Section`).hidden = section !== name;
    if (section !== 'waiting') $(`${section}Tab`).classList.toggle('active', section === name);
  }
  if (name === 'setup') {
    $('pageTitle').textContent = 'Preparar lote de trabajo';
    $('batchMeta').textContent = 'Carga el Excel, elige la QNA y asigna los archivos físicos.';
  } else if (name === 'waiting') {
    $('pageTitle').textContent = 'Verificación de documentos';
    $('batchMeta').textContent = 'Abre tu QR para acceder al listado asignado.';
  } else if (state.batch) {
    $('pageTitle').textContent = state.batch.isAdmin ? 'Control de la encargada' : 'Escaneo de documentos';
    $('batchMeta').textContent = `${qnaLabel(state.batch.qna)} · ${state.batch.fileName} · ${state.batch.records.length} registros`;
  }
}

function renderWorkerRows() {
  const count = Math.max(1, Math.min(50, Number($('workerCount').value) || 1));
  $('workerCount').value = count;
  const old = [...$('workerRows').children].map((row) => ({ name: row.querySelector('.worker-name').value,
    email: row.querySelector('.worker-email').value, target: row.querySelector('.worker-target').value }));
  $('workerRows').replaceChildren();
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div'); row.className = 'worker-row';
    const name = document.createElement('input'); name.className = 'worker-name'; name.placeholder = `Persona ${i + 1}`; name.maxLength = 80; name.value = old[i]?.name || '';
    const email = document.createElement('input'); email.className = 'worker-email'; email.type = 'email'; email.placeholder = 'Correo de su cuenta'; email.value = old[i]?.email || '';
    const target = document.createElement('input'); target.className = 'worker-target'; target.type = 'number'; target.min = 0; target.max = 2000;
    target.title = 'Archivos físicos asignados'; target.placeholder = 'Cantidad'; target.value = old[i]?.target ?? (state.fileRecords.length ? String(Math.floor(state.fileRecords.length / count) + (i < state.fileRecords.length % count ? 1 : 0)) : '0');
    row.append(name, email, target); $('workerRows').appendChild(row);
  }
  updateAllocation();
}

function updateAllocation() {
  const targets = [...document.querySelectorAll('.worker-target')].map((input) => Math.max(0, Number(input.value) || 0));
  const sum = targets.reduce((a, b) => a + b, 0);
  const digital = state.fileRecords.length;
  $('allocationNotice').textContent = digital
    ? `${sum} archivos físicos asignados · ${digital} registros digitales. ${sum < digital ? `${digital - sum} digitales quedarán sin persona asignada.` : sum > digital ? `${sum - digital} físicos adicionales podrán registrarse con observación.` : 'El reparto cubre todos los digitales.'}`
    : 'Carga el Excel para comparar cantidades.';
  $('createBatch').disabled = !digital || state.busy;
}

function parseExcel(bytes) {
  let zip;
  try { zip = fflate.unzipSync(bytes); } catch { throw new Error('No se pudo abrir el Excel .xlsx.'); }
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

async function loadFile(file) {
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name) || file.size > 30 * 1024 * 1024) { message('Elige un Excel .xlsx de hasta 30 MB.', true); return; }
  try {
    state.fileRecords = parseExcel(new Uint8Array(await file.arrayBuffer()));
    state.fileName = file.name;
    $('fileSummary').textContent = `${file.name} · ${state.fileRecords.length} registros digitales ordenados por RFC`;
    renderWorkerRows(); message('Archivo leído. Indica nombres, correos y cantidades.');
  } catch (error) { state.fileRecords = []; state.fileName = ''; updateAllocation(); message(error.message, true); }
}

async function createBatch() {
  if (!state.isAdmin || !state.fileRecords.length || state.busy) return;
  const workers = [...$('workerRows').children].map((row) => ({
    name: row.querySelector('.worker-name').value.trim(), email: row.querySelector('.worker-email').value.trim().toLowerCase(),
    target: Number(row.querySelector('.worker-target').value),
  }));
  if (workers.some((worker) => worker.name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(worker.email) || !Number.isInteger(worker.target) || worker.target < 0 || worker.target > 2000)) {
    message('Completa nombre, correo y cantidad válida para cada persona.', true); return;
  }
  if (new Set(workers.map((worker) => worker.email)).size !== workers.length) { message('Cada persona debe tener un correo diferente.', true); return; }
  const qna = `${$('qnaMonth').value}-${$('qnaHalf').value}`;
  if (!/^\d{4}-(0[1-9]|1[0-2])-[12]$/.test(qna)) { message('Elige mes y quincena.', true); return; }
  state.busy = true; updateAllocation(); message('Creando lote y asignaciones…');
  try {
    const result = await rpc('v2_create_batch', { p_file_name: state.fileName, p_qna: qna,
      p_records: state.fileRecords, p_workers: workers });
    await refreshBatches(); await openBatch(result.batchId);
    message('Lote creado. Entrega a cada persona su QR y su correo asignado.');
  } catch (error) { message(error.message, true); }
  finally { state.busy = false; updateAllocation(); }
}

function drawQr(canvas, link) {
  const code = qrcode(0, 'M'); code.addData(link); code.make();
  const modules = code.getModuleCount(), scale = 6, margin = 4;
  canvas.width = canvas.height = (modules + margin * 2) * scale;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let row = 0; row < modules; row++) for (let column = 0; column < modules; column++) {
    if (code.isDark(row, column)) ctx.fillRect((column + margin) * scale, (row + margin) * scale, scale, scale);
  }
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) { message('No se pudo descargar el QR.', true); return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, 'image/png');
}

function renderWorkerQrs() {
  const container = $('workerQrList');
  if (container.dataset.batchId === state.batch.id) return;
  container.replaceChildren();
  for (const worker of state.batch.workers) {
    const card = document.createElement('div'); card.className = 'worker-qr';
    const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `QR de ${worker.name}`);
    const url = new URL('./control.html', location.href); url.searchParams.set('invite', worker.token);
    drawQr(canvas, url.href);
    const details = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = worker.name;
    const email = document.createElement('small'); email.textContent = worker.email;
    const target = document.createElement('small'); target.textContent = `${worker.target} archivos físicos asignados`;
    const download = document.createElement('button'); download.type = 'button'; download.textContent = 'Descargar QR';
    download.addEventListener('click', () => downloadCanvas(canvas, `${worker.name.replace(/[^\w\- ]/g, '').trim() || 'persona'}_${state.batch.qna}_QR.png`));
    details.append(name, email, target, download); card.append(canvas, details); container.appendChild(card);
  }
  container.dataset.batchId = state.batch.id;
}

function renderBatch() {
  const batch = state.batch; if (!batch) return;
  const total = batch.records.length, checked = batch.records.filter((record) => record.checkedAt).length;
  $('totalProgress').textContent = `${checked} / ${total}`;
  $('totalFill').style.width = total ? `${checked / total * 100}%` : '0%';
  $('workerProgress').replaceChildren();
  for (const worker of batch.workers) {
    const row = document.createElement('div'); row.className = 'worker-progress-row';
    const name = document.createElement('span'); name.textContent = worker.name;
    const progress = document.createElement('b');
    progress.textContent = `${batch.records.filter((record) => record.assignedWorkerId === worker.id && record.checkedAt).length} / ${worker.target}`;
    row.append(name, progress); $('workerProgress').appendChild(row);
  }
  $('workerQrPanel').hidden = !batch.isAdmin;
  $('manualPanel').hidden = !batch.isAdmin;
  $('scanActions').hidden = batch.isAdmin;
  if (batch.isAdmin) {
    renderWorkerQrs();
    $('missingWorker').replaceChildren(new Option('Sin asignar', ''), ...batch.workers.map((worker) => new Option(worker.name, worker.id)));
  }
  renderRecords();
}

function renderRecords() {
  const batch = state.batch; if (!batch) return;
  const query = $('recordSearch').value.trim().toUpperCase();
  const people = new Map(batch.workers.map((worker) => [worker.id, worker.name]));
  const visible = batch.records.filter((record) => (! $('pendingOnly').checked || !record.checkedAt)
    && (!query || [record.rfc, record.folio, people.get(record.assignedWorkerId), record.checkedBy].some((text) => String(text || '').toUpperCase().includes(query))));
  $('recordCount').textContent = `${visible.length} de ${batch.records.length} registros · orden RFC`;
  const body = $('recordBody'); body.replaceChildren();
  if (!visible.length) {
    const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = 5; cell.className = 'empty-row'; cell.textContent = 'No hay registros con este filtro.'; return;
  }
  for (const record of visible) {
    const row = body.insertRow();
    if (record.checkedAt) row.classList.add(record.digital ? 'record-checked' : 'record-manual');
    const checkCell = row.insertCell(), check = document.createElement('input');
    check.type = 'checkbox'; check.className = 'record-check'; check.checked = !!record.checkedAt;
    check.disabled = !batch.isAdmin; check.dataset.id = record.id;
    check.setAttribute('aria-label', `Verificado: ${record.folio}. Solo la encargada puede cambiar manualmente.`);
    checkCell.appendChild(check);
    const identity = row.insertCell();
    const rfc = document.createElement('strong'); rfc.textContent = record.rfc || 'Sin RFC';
    const folio = document.createElement('small'); folio.textContent = `Folio ${record.folio}${record.digital ? '' : ' · No digital'}`;
    identity.append(rfc, folio);
    row.insertCell().textContent = people.get(record.assignedWorkerId) || 'Sin asignar';
    const documentCell = row.insertCell();
    documentCell.textContent = record.checkedAt
      ? [record.procedencia, record.nivel, record.documentDate].filter(Boolean).join(' · ') || 'Marca manual'
      : 'Pendiente';
    const actor = row.insertCell(); actor.textContent = record.checkedBy || '—';
    if (record.observation) { const note = document.createElement('small'); note.textContent = record.observation; actor.appendChild(note); }
  }
}

function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function exportCsv(rows, filename) {
  const csv = '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function downloadRecords() {
  const batch = state.batch; if (!batch) return;
  const people = new Map(batch.workers.map((worker) => [worker.id, worker.name]));
  exportCsv([['QNA', 'RFC', 'Folio', 'Persona asignada', 'Estado', 'Responsable', 'Procedencia', 'Nivel', 'Fecha documento', 'Origen', 'Observación'],
    ...batch.records.map((record) => [batch.qna, record.rfc, record.folio, people.get(record.assignedWorkerId) || '',
      record.checkedAt ? 'Verificado' : 'Pendiente', record.checkedBy, record.procedencia, record.nivel, record.documentDate,
      record.source, record.observation])], `${batch.qna}_listado_FUP.csv`);
}

async function refreshBatch() {
  if (!state.batch || state.busy || document.hidden) return;
  try {
    const data = await rpc('v2_get_batch', { p_batch_id: state.batch.id });
    state.batch = data; renderBatch();
  } catch (error) { message(`Sincronización: ${error.message}`, true); }
}

async function loadHistory(append = false) {
  if (!state.batch?.isAdmin) return;
  try {
    const page = await rpc('v2_search_history', { p_query: $('historySearch').value.trim(), p_qna: $('historyQna').value || null,
      p_offset: append ? state.history.length : 0 });
    state.history = append ? [...state.history, ...page] : page;
    state.historyMore = page.length === 200;
    renderHistory();
  } catch (error) { message(error.message, true); }
}

function renderHistory() {
  $('historyCount').textContent = `${state.history.length} movimientos cargados`;
  $('historyMore').hidden = !state.historyMore;
  const body = $('historyBody'); body.replaceChildren();
  if (!state.history.length) {
    const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = 6; cell.className = 'empty-row'; cell.textContent = 'No hay movimientos para esta búsqueda.'; return;
  }
  const labels = { scan: 'Escaneo', rescan: 'Reescaneo', manual_mark: 'Marca manual', manual_unmark: 'Desmarcado', manual_add: 'No digital' };
  for (const event of state.history) {
    const row = body.insertRow();
    row.insertCell().textContent = new Date(event.at).toLocaleString('es-MX');
    const qna = row.insertCell(); qna.textContent = qnaLabel(event.qna);
    const file = document.createElement('small'); file.textContent = event.fileName; qna.appendChild(file);
    const record = row.insertCell(); record.textContent = event.folio;
    const rfc = document.createElement('small'); rfc.textContent = event.rfc || 'Sin RFC'; record.appendChild(rfc);
    row.insertCell().textContent = event.actor;
    row.insertCell().textContent = labels[event.action] || event.action;
    row.insertCell().textContent = [event.procedencia, event.nivel, event.documentDate, event.observation].filter(Boolean).join(' · ');
  }
}

async function downloadHistory() {
  const button = $('historyCsv'); button.disabled = true;
  try {
    const rows = [];
    for (let offset = 0; ; offset += 200) {
      const page = await rpc('v2_search_history', { p_query: $('historySearch').value.trim(), p_qna: $('historyQna').value || null, p_offset: offset });
      rows.push(...page);
      if (page.length < 200) break;
    }
  exportCsv([['Fecha registro', 'QNA', 'Excel', 'Folio', 'RFC', 'Responsable', 'Tipo', 'Procedencia', 'Nivel', 'Fecha documento', 'Observación'],
    ...rows.map((event) => [event.at, event.qna, event.fileName, event.folio, event.rfc, event.actor,
      event.action, event.procedencia, event.nivel, event.documentDate, event.observation])], 'bitacora_FUP.csv');
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
}

async function adminToggle(id, checked) {
  if (!state.batch?.isAdmin) return;
  const record = state.batch.records.find((item) => String(item.id) === String(id));
  const note = prompt(`${checked ? 'Marcar' : 'Desmarcar'} folio ${record?.folio || id}. Escribe la observación obligatoria:`);
  if (note === null) { renderRecords(); return; }
  if (note.trim().length < 5) { message('La observación debe tener al menos 5 caracteres.', true); renderRecords(); return; }
  try {
    await rpc('v2_admin_set_status', { p_batch_id: state.batch.id, p_record_id: id, p_checked: checked, p_observation: note.trim() });
    message(`Folio ${record.folio} ${checked ? 'marcado' : 'desmarcado'} por la encargada.`);
    await refreshBatch(); await loadHistory();
  } catch (error) { message(error.message, true); renderRecords(); }
}

async function addMissing(event) {
  event.preventDefault(); if (!state.batch?.isAdmin) return;
  try {
    await rpc('v2_admin_add_missing', { p_batch_id: state.batch.id, p_folio: $('missingFolio').value.trim(),
      p_rfc: $('missingRfc').value.trim(), p_procedencia: $('missingSource').value.trim(),
      p_nivel: $('missingLevel').value.trim(), p_document_date: $('missingDate').value,
      p_observation: $('missingNote').value.trim(), p_worker_id: $('missingWorker').value || null });
    $('missingForm').reset(); message('Documento no digital añadido con observación.');
    await refreshBatch(); await loadHistory();
  } catch (error) { message(error.message, true); }
}

function parseScanText(raw) {
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
  const known = numbers.filter((number) => state.batch?.records.some((record) => String(record.folio).match(/^\d+/)?.[0] === number));
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

async function getOcrWorker() {
  if (!window.Tesseract) throw new Error('No se cargó el lector de texto. Comprueba la conexión.');
  if (!state.ocr) {
    state.ocr = await Tesseract.createWorker('eng');
    await state.ocr.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  }
  return state.ocr;
}

async function readScan(image) {
  if (state.reading || !state.batch || state.batch.isAdmin) return;
  state.reading = true; $('captureScanner').disabled = true; $('saveScan').disabled = true;
  $('scanResult').hidden = true; $('scanMessage').textContent = 'Leyendo procedencia, nivel, folio y fecha…';
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(image);
    const result = parseScanText(data.text);
    if (data.confidence < 40 || !result.procedencia || !result.nivel || !result.folio || !result.documentDate) {
      $('scanMessage').textContent = 'No se leyeron claramente las cuatro partes del recuadro. Acerca la cámara, mejora la luz y vuelve a intentar.';
      message(`Lectura incompleta. Texto detectado: ${String(data.text).trim().slice(0, 160) || 'ninguno'}`, true);
      return;
    }
    state.scan = result;
    $('scanSource').textContent = result.procedencia;
    $('scanLevel').textContent = result.nivel;
    $('scanFolio').textContent = result.folio;
    $('scanDate').textContent = result.documentDate;
    $('scanResult').hidden = false; $('saveScan').disabled = false;
    $('scanMessage').textContent = 'Compara estos datos con el documento físico y confirma si son correctos.';
  } catch (error) { $('scanMessage').textContent = error.message; message(error.message, true); }
  finally { state.reading = false; $('captureScanner').disabled = false; }
}

async function openScanner() {
  if (!state.batch || state.batch.isAdmin) return;
  if (!navigator.mediaDevices?.getUserMedia) { message('Este navegador no permite cámara en vivo. Usa «Tomar foto del recuadro».', true); return; }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    $('scanVideo').srcObject = state.stream; $('videoWrap').hidden = false; $('captureScanner').hidden = false;
    $('scanResult').hidden = true; $('scanModal').hidden = false;
    await $('scanVideo').play(); $('scanMessage').textContent = 'Alinea las tres filas del recuadro dentro de la guía.';
  } catch (error) {
    closeScanner();
    message(error?.name === 'NotAllowedError' ? 'La cámara no tiene permiso. Actívalo o usa «Tomar foto del recuadro».'
      : 'No se pudo abrir la cámara. Usa «Tomar foto del recuadro».', true);
  }
}

function closeScanner() {
  $('scanModal').hidden = true; $('scanResult').hidden = true; state.scan = null;
  $('scanVideo').pause(); $('scanVideo').srcObject = null;
  state.stream?.getTracks().forEach((track) => track.stop()); state.stream = null;
}

function captureScanner() {
  const video = $('scanVideo');
  if (!video.videoWidth) { $('scanMessage').textContent = 'Espera a que aparezca la imagen.'; return; }
  const width = video.videoWidth * .84;
  const height = Math.min(video.videoHeight * .45, width / 3.4);
  const canvas = document.createElement('canvas'); canvas.width = Math.round(width * 2); canvas.height = Math.round(height * 2);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, (video.videoWidth - width) / 2, (video.videoHeight - height) / 2,
    width, height, 0, 0, canvas.width, canvas.height);
  readScan(canvas);
}

async function photoScan(file) {
  if (!file || !state.batch || state.batch.isAdmin) return;
  $('scanModal').hidden = false; $('videoWrap').hidden = true; $('captureScanner').hidden = true;
  await readScan(file);
}

async function saveScan() {
  if (!state.scan || !state.batch || state.batch.isAdmin) return;
  $('saveScan').disabled = true;
  try {
    const result = await rpc('v2_scan_document', { p_batch_id: state.batch.id, p_folio: state.scan.folio,
      p_procedencia: state.scan.procedencia, p_nivel: state.scan.nivel, p_document_date: state.scan.documentDate });
    message(result.status === 'new' ? `Folio ${result.folio} registrado por escaneo.`
      : `El folio ${result.folio} ya estaba registrado por ${result.checkedBy}. El nuevo intento quedó en la bitácora.`);
    state.scan = null; $('scanResult').hidden = true;
    $('scanMessage').textContent = 'Guardado. Coloca el siguiente documento y lee el recuadro.';
    if (!state.stream) closeScanner();
    await refreshBatch();
  } catch (error) { $('saveScan').disabled = false; $('scanMessage').textContent = error.message; message(error.message, true); }
}

async function submitAuth(event) {
  event.preventDefault();
  try {
    const data = await authRequest('token?grant_type=password', { email: $('authEmail').value.trim(), password: $('authPassword').value });
    saveSession(data); $('authPassword').value = ''; message('Sesión iniciada.', false, 'authMessage');
    await showApp();
  } catch (error) { message(error.message, true, 'authMessage'); }
}

function toggleRecovery(show) {
  $('authForm').hidden = show; $('forgotPassword').hidden = show;
  $('recoveryForm').hidden = !show;
  if (show) $('recoveryEmail').value = $('authEmail').value.trim();
}

async function loadRecoveryQuestion() {
  try {
    const result = await accounts('question', { email: $('recoveryEmail').value.trim() }, true);
    $('recoveryQuestion').textContent = result.question || 'No hay pregunta configurada para esta cuenta. Pide ayuda a la encargada.';
  } catch (error) { message(error.message, true, 'authMessage'); }
}

async function recoverPassword(event) {
  event.preventDefault();
  try {
    await accounts('recover', { email: $('recoveryEmail').value.trim(), answer: $('recoveryAnswer').value,
      password: $('recoveryPassword').value }, true);
    $('authEmail').value = $('recoveryEmail').value.trim();
    $('recoveryForm').reset(); toggleRecovery(false);
    message('Contraseña actualizada. Ya puedes entrar.', false, 'authMessage');
  } catch (error) { message(error.message, true, 'authMessage'); }
}

function closeAccount() { $('accountModal').hidden = true; $('createdCredential').hidden = true; }

async function loadUsers() {
  try {
    const data = await accounts('list-users');
    $('usersList').replaceChildren();
    for (const user of data.users) {
      const row = document.createElement('div');
      const name = document.createElement('span'); name.textContent = `${user.name} · ${user.email}`;
      const status = document.createElement('span'); status.textContent = user.recoverySet ? 'Respaldo listo' : 'Sin respaldo';
      row.append(name, status);
      if (user.email !== 'nomina@fup.com') {
        const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Nueva clave';
        reset.addEventListener('click', () => resetUser(user)); row.appendChild(reset);
      }
      $('usersList').appendChild(row);
    }
  } catch (error) { message(error.message, true, 'accountMessage'); }
}

function openAccount(showUsers = false) {
  if (!state.account) return;
  $('accountModal').hidden = false;
  $('accountTitle').textContent = showUsers ? 'Administrar usuarios' : 'Mi cuenta';
  $('accountEmail').textContent = `${state.account.name} · ${state.account.email}`;
  $('usersSection').hidden = !state.isAdmin || !showUsers;
  $('myQuestion').value = state.account.question || '';
  message('', false, 'accountMessage');
  if (showUsers && state.isAdmin) loadUsers();
}

async function saveRecoveryQuestion(event) {
  event.preventDefault();
  try {
    await accounts('set-recovery', { question: $('myQuestion').value, answer: $('myAnswer').value });
    state.account.question = $('myQuestion').value.trim(); state.account.recoverySet = true;
    $('myAnswer').value = '';
    message('Pregunta de respaldo guardada.', false, 'accountMessage');
  } catch (error) { message(error.message, true, 'accountMessage'); }
}

async function changePassword(event) {
  event.preventDefault();
  try {
    await accounts('change-password', { currentPassword: $('currentPassword').value, password: $('newPassword').value });
    $('passwordForm').reset();
    message('Contraseña actualizada.', false, 'accountMessage');
  } catch (error) { message(error.message, true, 'accountMessage'); }
}

async function createUser(event) {
  event.preventDefault();
  if (!state.isAdmin) return;
  try {
    const result = await accounts('create-user', { name: $('newUserName').value, email: $('newUserEmail').value });
    $('createUserForm').reset();
    $('createdCredential').textContent = `${result.name} · ${result.email} · Contraseña inicial: ${result.password}. Entrégala a esta persona de forma privada; se muestra solo ahora.`;
    $('createdCredential').hidden = false;
    message('Usuario creado sin confirmación por correo.', false, 'accountMessage');
    await loadUsers();
  } catch (error) { message(error.message, true, 'accountMessage'); }
}

async function resetUser(user) {
  if (!state.isAdmin || !confirm(`¿Generar una nueva contraseña para ${user.name} (${user.email})? La anterior dejará de servir.`)) return;
  try {
    const result = await accounts('reset-user', { email: user.email });
    $('createdCredential').textContent = `${result.email} · Nueva contraseña: ${result.password}. Entrégala de forma privada; se muestra solo ahora.`;
    $('createdCredential').hidden = false;
    message('Contraseña inicial renovada.', false, 'accountMessage');
  } catch (error) { message(error.message, true, 'accountMessage'); }
}

function logout() {
  if (state.session) authRequest('logout', {}, state.session.access_token).catch(() => {});
  localStorage.removeItem(sessionKey); state.session = null; state.account = null;
  state.batch = null; state.isAdmin = false; closeAccount();
  showAuth();
}

function init() {
  if (!config?.url || !config?.key) { message('La conexión de Supabase no está configurada.', true, 'authMessage'); return; }
  const now = new Date(); $('qnaMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('qnaHalf').value = now.getDate() <= 15 ? '1' : '2';
  renderWorkerRows();
  try { state.session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { state.session = null; }
  if (state.session) showApp(); else showAuth();
}

$('authForm').addEventListener('submit', submitAuth);
$('forgotPassword').addEventListener('click', () => toggleRecovery(true));
$('cancelRecovery').addEventListener('click', () => toggleRecovery(false));
$('loadQuestion').addEventListener('click', loadRecoveryQuestion);
$('recoveryForm').addEventListener('submit', recoverPassword);
$('logout').addEventListener('click', logout);
$('accountButton').addEventListener('click', () => openAccount(false));
$('usersButton').addEventListener('click', () => openAccount(true));
$('closeAccount').addEventListener('click', closeAccount);
$('accountModal').addEventListener('click', (event) => { if (event.target === $('accountModal')) closeAccount(); });
$('questionForm').addEventListener('submit', saveRecoveryQuestion);
$('passwordForm').addEventListener('submit', changePassword);
$('createUserForm').addEventListener('submit', createUser);
$('setupTab').addEventListener('click', () => showSection('setup'));
$('listTab').addEventListener('click', () => showSection('list'));
$('historyTab').addEventListener('click', () => { showSection('history'); loadHistory(); });
$('newBatch').addEventListener('click', () => showSection('setup'));
$('batchSelector').addEventListener('change', (event) => openBatch(event.target.value).catch((error) => message(error.message, true)));
$('batchFile').addEventListener('change', (event) => loadFile(event.target.files[0]));
$('workerCount').addEventListener('change', renderWorkerRows);
$('workerRows').addEventListener('input', updateAllocation);
$('createBatch').addEventListener('click', createBatch);
$('recordSearch').addEventListener('input', renderRecords);
$('pendingOnly').addEventListener('change', renderRecords);
$('recordBody').addEventListener('change', (event) => {
  if (event.target.classList.contains('record-check')) adminToggle(event.target.dataset.id, event.target.checked);
});
$('downloadCsv').addEventListener('click', downloadRecords);
$('missingForm').addEventListener('submit', addMissing);
$('searchHistory').addEventListener('click', () => loadHistory());
$('historyQna').addEventListener('change', () => loadHistory());
$('historySearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') loadHistory(); });
$('historyCsv').addEventListener('click', downloadHistory);
$('historyMore').addEventListener('click', () => loadHistory(true));
$('openScanner').addEventListener('click', openScanner);
$('closeScanner').addEventListener('click', closeScanner);
$('captureScanner').addEventListener('click', captureScanner);
$('scanModal').addEventListener('click', (event) => { if (event.target === $('scanModal')) closeScanner(); });
$('scanPhoto').addEventListener('change', (event) => { const file = event.target.files[0]; event.target.value = ''; photoScan(file); });
$('saveScan').addEventListener('click', saveScan);
$('retryScan').addEventListener('click', () => { state.scan = null; $('scanResult').hidden = true; $('scanMessage').textContent = 'Vuelve a leer el recuadro.'; });
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('scanModal').hidden) closeScanner();
  else if (!$('accountModal').hidden) closeAccount();
});
setInterval(refreshBatch, 5000);
init();
