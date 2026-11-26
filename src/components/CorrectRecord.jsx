import { useState } from 'react';
import { rpc } from '../lib/api';
import { DOCUMENT_LEVELS } from '../lib/ocr';
export default function CorrectRecord({ batchId, record, onClose, onSaved }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      await rpc('v14_correct_document', { p_batch_id: batchId, p_record_id: record.id,
        p_procedencia: data.get('source'), p_nivel: data.get('level'), p_document_date: data.get('date'),
        p_observation: data.get('note'), p_expected: {procedencia: record.procedencia, nivel: record.nivel, documentDate: record.documentDate} });
      await onSaved(); onClose();
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <div className="scan-modal" role="dialog" aria-modal="true" aria-label="Corregir documento"><div className="scan-card correction-card">
    <div className="scan-heading"><h2>Corregir folio {record.folio}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar">×</button></div>
    <p>La revisión conservará su responsable. El cambio y su motivo quedarán en la bitácora.</p>
    <form className="stack-form" onSubmit={submit}>
      <label>Procedencia<select name="source" defaultValue={record.procedencia || ''} required><option value="">Selecciona</option>{['ESTATAL','FEDERAL','MUNICIPAL'].map((value)=><option key={value}>{value}</option>)}</select></label>
      <label>Nivel<select name="level" defaultValue={DOCUMENT_LEVELS.includes(record.nivel) ? record.nivel : ''} required><option value="">Selecciona</option>{DOCUMENT_LEVELS.map((value)=><option key={value}>{value}</option>)}</select></label>
      <label>Fecha del documento<input type="date" name="date" defaultValue={record.documentDate || ''} required /></label>
      <label>Motivo de la corrección<textarea name="note" minLength={5} maxLength={500} required /></label>
      {error && <p role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar corrección'}</button>
    </form></div></div>;
}
