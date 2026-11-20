import { useMemo, useState } from 'react';
import { initialQna, qnaCode, distribute } from '../lib/qna';
import { parseRosterExcel } from '../lib/rosterExcel';
import { readBook, generateBook, colorFor } from '../lib/excelBook';
import { downloadBlob } from '../lib/download';

const workerColumns = 'clamp(24px, 3vw, 30px) minmax(0, 1fr) clamp(85px, 10vw, 112px)';

export default function BatchSetup({ users, onCreate, onMessage, hidden }) {
  const [fileName, setFileName] = useState('');
  const [records, setRecords] = useState([]);
  const [book, setBook] = useState(null);
  const [count, setCount] = useState(2);
  const [selected, setSelected] = useState([]);
  const [qna, setQna] = useState(initialQna);
  const [busy, setBusy] = useState(false);
  const [withColors, setWithColors] = useState(false);
  const sizes = useMemo(() => distribute(records.length, count), [records.length, count]);
  const operators = users.filter((user) => user.role === 'operador');
  const unique = selected.slice(0, count).every((id) => operators.some((user) => user.id === id))
    && new Set(selected.slice(0, count)).size === count;

  async function loadFile(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name) || file.size > 30 * 1024 * 1024) {
      onMessage('Elige un Excel .xlsx de hasta 30 MB.', true); return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const next = parseRosterExcel(bytes);
      const nextBook = readBook(bytes);
      if (next.length !== nextBook.sheet.slots.length) throw new Error('El conteo de registros no coincide entre el listado y el Excel. Revisa el archivo.');
      setRecords(next); setBook(nextBook); setFileName(file.name);
      setCount((current) => Math.min(current, next.length));
      onMessage('Archivo leído. El reparto y el Excel ordenado están listos para preparar.');
    } catch (error) { setRecords([]); setBook(null); setFileName(''); onMessage(error.message, true); }
  }

  async function create() {
    if (busy || !records.length || !unique) return;
    const workers = selected.slice(0, count).map((id, index) => {
      const user = users.find((item) => item.id === id);
      return user && { userId: user.id, target: sizes[index] };
    });
    if (workers.some((item) => !item)) { onMessage('Selecciona una cuenta distinta para cada persona.', true); return; }
    const code = qnaCode(qna.month, qna.half);
    if (!code) { onMessage('Elige mes y quincena.', true); return; }
    setBusy(true);
    try { await onCreate({ fileName, qna: code, records, workers }); }
    finally { setBusy(false); }
  }

  function download() {
    if (!book || (withColors && !unique) || busy) return;
    try {
      const names = withColors ? selected.slice(0, count).map((id) => users.find((user) => user.id === id)?.name) : [];
      if (withColors && names.some((name) => !name)) throw new Error('Selecciona una cuenta distinta para cada persona.');
      const bytes = generateBook(book, names, { withColors });
      downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `${fileName.replace(/\.xlsx$/i, '')}_ordenado${withColors ? '_con_colores' : ''}.xlsx`);
      onMessage(`Excel alfabetizado ${withColors ? 'con colores' : 'sin colores'} descargado. Los folios conservan su RFC.`);
    } catch (error) { onMessage(`No se pudo generar el Excel: ${error.message}`, true); }
  }

  return <section className="section setup-section" hidden={hidden}>
    <div className="setup-card">
      <h2>1. Carga el archivo general</h2>
      <label className="file-picker">Seleccionar Excel .xlsx<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { loadFile(event.target.files[0]); event.target.value = ''; }} /></label>
      <p>{fileName ? `${fileName} · ${records.length} registros digitales ordenados por RFC` : 'Aún no hay archivo. Se tomarán RFC y folio del Excel.'}</p>
      <div className="qna-fields">
        <label>Mes de trabajo<input type="month" value={qna.month} onChange={(event) => setQna((current) => ({ ...current, month: event.target.value }))} required /></label>
        <label>Quincena<select value={qna.half} onChange={(event) => setQna((current) => ({ ...current, half: event.target.value }))}><option value="1">Primera (1–15)</option><option value="2">Segunda (16–fin)</option></select></label>
      </div><p>QNA del lote: <strong id="qnaCode">{qnaCode(qna.month, qna.half) || '—'}</strong></p>
    </div>
    <div className="setup-card">
      <h2>2. Reparte el lote y ordena el Excel</h2>
      <p>Elige cuántas personas trabajarán y selecciona sus nombres. El sistema reparte todos los registros del Excel en orden alfabético por RFC.</p>
      <label className="count-label">Personas <input type="number" min="1" max={Math.min(50, records.length || 50)} value={count}
        onChange={(event) => setCount(Math.max(1, Math.min(50, records.length || 50, Number(event.target.value) || 1)))} /></label>
      <div className="worker-heading" style={{ gridTemplateColumns: workerColumns }} aria-hidden="true"><span>Color</span><span>Persona</span><span>Hojas</span></div>
      <div className="worker-rows">{sizes.map((size, index) => <div className="worker-row" style={{ display: 'grid', gridTemplateColumns: workerColumns }} key={index}>
        <span className="worker-swatch" style={{ backgroundColor: colorFor(index) }} title={`Color de persona ${index + 1}`} aria-hidden="true" />
        <select aria-label={`Persona ${index + 1}`} value={selected[index] || ''} onChange={(event) => setSelected((current) => { const next = [...current]; next[index] = event.target.value; return next; })}>
          <option value="">Persona {index + 1}: selecciona usuario</option>
          {operators.map((user) => <option key={user.id} value={user.id}>{user.name} (@{user.username})</option>)}
        </select><output className="worker-target" aria-label={`Hojas para persona ${index + 1}`}>{size} hojas</output>
      </div>)}</div>
      <p className="allocation-notice">{records.length ? `${records.length} registros digitales repartidos entre ${count} ${count === 1 ? 'persona' : 'personas'}. ${unique ? 'Todos tienen responsable.' : 'Selecciona una cuenta distinta para cada persona.'}` : 'Carga el Excel para calcular el reparto.'}</p>
      <div className="setup-actions"><button className="primary" type="button" onClick={create} disabled={!records.length || !unique || busy}>Crear lote y códigos QR</button>
        <label className="color-download-option"><input type="checkbox" checked={withColors} onChange={(event) => setWithColors(event.target.checked)} /> Con colores</label>
        <button type="button" onClick={download} disabled={!book || (withColors && !unique) || busy}>Descargar Excel ordenado</button></div>
      <p>Si falta alguien, crea su cuenta en <strong>Usuarios</strong> y después selecciónala aquí.</p>
    </div>
  </section>;
}
