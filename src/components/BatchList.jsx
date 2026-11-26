import { useMemo, useState } from 'react';
import { rpc } from '../lib/api';
import { exportCsv } from '../lib/download';
import { qnaLabel } from '../lib/qna';
import CorrectRecord from './CorrectRecord';
import { batchSummary, batchReportRows } from '../lib/batchReport';
import PersonalQr from './PersonalQr';

export default function BatchList({ batch, account, hidden, onMessage, onRefresh, onOpenScanner, onPhoto }) {
  const [workerFilter, setWorkerFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const summary = batchSummary(batch);
  const lastRecord = batch.records.filter((record) => record.checkedAt).sort((a,b) => new Date(b.checkedAt)-new Date(a.checkedAt))[0];
  const [query, setQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const people = useMemo(() => new Map(batch.workers.map((worker) => [worker.id, worker.name])), [batch.workers]);
  const total = batch.records.length;
  const checked = batch.records.filter((record) => record.checkedAt).length;
  const visible = batch.records.filter((record) => (!workerFilter || (record.assignedWorkerId || 'unassigned') === workerFilter) && (!pendingOnly || !record.checkedAt) &&
    (!query.trim() || [record.rfc, record.folio, people.get(record.assignedWorkerId), record.checkedBy]
      .some((text) => String(text || '').toUpperCase().includes(query.trim().toUpperCase()))));

  async function toggle(record, value) {
    if (!batch.isAdmin) return;
    const note = prompt(`${value ? 'Marcar' : 'Desmarcar'} folio ${record.folio}. Escribe la observación obligatoria:`);
    if (note === null) return;
    if (note.trim().length < 5) { onMessage('La observación debe tener al menos 5 caracteres.', true); return; }
    try {
      await rpc('v2_admin_set_status', { p_batch_id: batch.id, p_record_id: record.id, p_checked: value, p_observation: note.trim() });
      onMessage(`Folio ${record.folio} ${value ? 'marcado' : 'desmarcado'} por la encargada.`);
      await onRefresh(true);
    } catch (error) { onMessage(error.message, true); }
  }

  async function addMissing(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await rpc('v2_admin_add_missing', { p_batch_id: batch.id, p_folio: String(data.get('folio')).trim(),
        p_rfc: String(data.get('rfc')).trim(), p_procedencia: String(data.get('source')).trim(),
        p_nivel: String(data.get('level')).trim(), p_document_date: data.get('date'),
        p_observation: String(data.get('note')).trim(), p_worker_id: data.get('worker') || null });
      form.reset(); onMessage('Documento no digital añadido con observación.');
      await onRefresh(true);
    } catch (error) { onMessage(error.message, true); }
  }

  async function downloadClosingReport() {
    setReportBusy(true);
    try {
      const snapshot = await rpc('v2_get_batch', {p_batch_id: batch.id});
      exportCsv(batchReportRows(snapshot, new Date().toISOString()), qnaLabel(batch.qna) + '_reporte_cierre_FUP.csv');
      onMessage('Reporte de cierre descargado. Incluye los pendientes al momento de generarlo.');
    } catch(error) { onMessage(error.message, true); } finally { setReportBusy(false); }
  }
  function downloadRecords() {
    exportCsv([['QNA', 'RFC', 'Folio', 'Persona asignada', 'Estado', 'Responsable', 'Procedencia', 'Nivel', 'Fecha documento', 'Origen', 'Observación'],
      ...batch.records.map((record) => [qnaLabel(batch.qna), record.rfc, record.folio, people.get(record.assignedWorkerId) || '',
        record.checkedAt ? 'Verificado' : 'Pendiente', record.checkedBy, record.procedencia, record.nivel, record.documentDate,
        record.source, record.observation])], `${qnaLabel(batch.qna)}_listado_FUP.csv`);
  }

  return <section className="section list-section" hidden={hidden}>
    <div className="list-side">
      {!hidden && <div className="panel"><PersonalQr batchId={batch.id} name={account?.name || people.get(batch.myWorkerId)} />
        <p>Puedes revisar cualquier folio de este lote; tu nombre quedará como responsable del escaneo.</p>
        <button className="primary" type="button" onClick={onOpenScanner}>Abrir cámara</button>
        <label className="photo-button">Tomar foto del recuadro<input type="file" accept="image/*" capture="environment" onChange={(event) => { onPhoto(event.target.files[0]); event.target.value = ''; }} /></label>
      </div>}
      <div className="panel progress-panel"><h2>Avance del lote</h2><strong>{checked} / {total}</strong>
        <p>{summary.pending} pendientes · {summary.added} añadidos manualmente</p><div className="progress-track"><div style={{ width: total ? `${checked / total * 100}%` : '0%' }} /></div>
        <div>{batch.workers.map((worker) => <div className="worker-progress-row" key={worker.id}><button type="button" onClick={() => { setWorkerFilter(worker.id); setPendingOnly(true); }}>{worker.name}</button>
          <b>{batch.records.filter((record) => record.assignedWorkerId === worker.id && record.checkedAt).length} / {batch.records.filter((record) => record.assignedWorkerId === worker.id).length} · {batch.records.filter((record) => record.assignedWorkerId === worker.id && !record.checkedAt).length} pendientes</b></div>)}</div>
      </div>
      {batch.isAdmin && <>
        <div className="panel"><h2>Añadir documento no digital</h2><p>Solo la encargada puede agregarlo. La observación queda en la bitácora.</p>
          <form className="stack-form" onSubmit={addMissing}>
            <input name="folio" placeholder="No. de documento" inputMode="numeric" required />
            <input name="rfc" placeholder="RFC (si se conoce)" />
            <input name="source" placeholder="Procedencia" required />
            <input name="level" placeholder="Nivel" required />
            <label>Fecha del documento<input name="date" type="date" required /></label>
            <select name="worker"><option value="">Sin asignar</option>{batch.workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select>
            <textarea name="note" placeholder="Observación: por qué no está en el Excel" minLength="5" maxLength="500" required />
            <button className="primary">Añadir y registrar</button>
          </form>
        </div>
      </>}
    </div>
    {editing && batch.isAdmin && <CorrectRecord batchId={batch.id} record={editing} onClose={() => setEditing(null)} onSaved={async () => { onMessage('Corrección guardada en la bitácora.'); await onRefresh(true).catch(() => onMessage('Corrección guardada; actualiza el listado al recuperar la conexión.', true)); }} />}
    <div className="panel records-panel">
      {lastRecord && <div className="last-document"><strong>Último documento registrado: {lastRecord.folio}</strong><span>{lastRecord.nivel || 'Marca manual'} · {lastRecord.checkedBy} · {new Date(lastRecord.checkedAt).toLocaleTimeString('es-MX')}</span></div>}
      <div className="panel-heading"><div><h2>Listado por RFC</h2><p>{visible.length} de {total} registros · orden RFC</p></div>
        <div><button type="button" onClick={downloadRecords}>Descargar CSV</button>{batch.isAdmin && <button type="button" disabled={reportBusy} onClick={downloadClosingReport}>{reportBusy ? 'Generando…' : 'Reporte de cierre'}</button>}</div></div>
      <div className="list-filters"><input type="search" placeholder="Buscar RFC, folio o persona" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Filtrar persona asignada" value={workerFilter} onChange={(event) => setWorkerFilter(event.target.value)}><option value="">Todas las personas</option>{batch.workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}<option value="unassigned">Sin asignar</option></select><label><input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} /> Solo pendientes</label></div>
      <div className="records-scroll"><table><thead><tr><th>✓</th><th>RFC / Folio</th><th>Asignado</th><th>Documento</th><th>Responsable</th></tr></thead>
        <tbody>{visible.length ? visible.map((record) => <tr key={record.id} className={record.checkedAt ? record.digital ? 'record-checked' : 'record-manual' : ''}>
          <td><input className="record-check" type="checkbox" checked={!!record.checkedAt} disabled={!batch.isAdmin}
            aria-label={`Verificado: ${record.folio}. Solo la encargada puede cambiar manualmente.`} onChange={(event) => toggle(record, event.target.checked)} /></td>
          <td><strong>{record.rfc || 'Sin RFC'}</strong><small>Folio {record.folio}{record.digital ? '' : ' · No digital'}</small></td>
          <td>{people.get(record.assignedWorkerId) || 'Sin asignar'}</td>
          <td>{record.checkedAt ? [record.procedencia, record.nivel, record.documentDate].filter(Boolean).join(' · ') || 'Marca manual' : 'Pendiente'}</td>
          <td>{batch.isAdmin && record.checkedAt && <button type="button" onClick={() => setEditing(record)}>Corregir datos</button>}{record.checkedBy || '—'}{record.observation && <small>{record.observation}</small>}</td>
        </tr>) : <tr><td colSpan="5" className="empty-row">No hay registros con este filtro.</td></tr>}</tbody>
      </table></div><small>Cualquier operador asignado al lote puede escanear un folio. La asignación inicial permanece; Responsable muestra a quien hizo el último escaneo.</small>
    </div>
  </section>;
}
