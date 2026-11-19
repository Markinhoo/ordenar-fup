import { useEffect, useState } from 'react';
import { rpc } from '../lib/api';
import { exportCsv } from '../lib/download';
import { qnaLabel } from '../lib/qna';

const labels = { scan: 'Escaneo', rescan: 'Reescaneo', manual_mark: 'Marca manual', manual_unmark: 'Desmarcado', manual_add: 'No digital' };

export default function HistoryView({ batch, batches, hidden, version, onMessage }) {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [qna, setQna] = useState('');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const qnas = [...new Set(batches.map((item) => item.qna))].sort().reverse();

  async function load(append = false, nextQna = qna) {
    if (!batch?.isAdmin) return;
    setBusy(true);
    try {
      const page = await rpc('v2_search_history', { p_query: query.trim(), p_qna: nextQna || null,
        p_offset: append ? rows.length : 0 });
      setRows((current) => append ? [...current, ...page] : page);
      setMore(page.length === 200);
    } catch (error) { onMessage(error.message, true); }
    finally { setBusy(false); }
  }

  useEffect(() => { if (!hidden && batch?.isAdmin) load(false); }, [hidden, batch?.id, version]);

  async function download() {
    setBusy(true);
    try {
      const all = [];
      for (let offset = 0; ; offset += 200) {
        const page = await rpc('v2_search_history', { p_query: query.trim(), p_qna: qna || null, p_offset: offset });
        all.push(...page);
        if (page.length < 200) break;
      }
      exportCsv([['Fecha registro', 'QNA', 'Excel', 'Folio', 'RFC', 'Responsable', 'Tipo', 'Procedencia', 'Nivel', 'Fecha documento', 'Observación'],
        ...all.map((event) => [event.at, qnaLabel(event.qna), event.fileName, event.folio, event.rfc, event.actor,
          event.action, event.procedencia, event.nivel, event.documentDate, event.observation])], 'bitacora_FUP.csv');
    } catch (error) { onMessage(error.message, true); }
    finally { setBusy(false); }
  }

  return <section className="section history-section" hidden={hidden}><div className="panel">
    <div className="panel-heading"><div><h2>Bitácora de escaneos</h2><p>Consulta QNAs anteriores y quién registró cada folio.</p></div>
      <button type="button" disabled={busy} onClick={download}>Descargar CSV completo</button></div>
    <div className="history-filters"><select value={qna} onChange={(event) => { setQna(event.target.value); load(false, event.target.value); }}>
      <option value="">Todas las QNAs</option>{qnas.map((item) => <option key={item} value={item}>{qnaLabel(item)}</option>)}
    </select><input type="search" placeholder="Folio, RFC o persona" value={query} onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') load(); }} /><button type="button" onClick={() => load()} disabled={busy}>Buscar</button></div>
    <p>{rows.length} movimientos cargados</p>
    <div className="history-scroll"><table><thead><tr><th>Registro</th><th>QNA / Excel</th><th>Folio / RFC</th><th>Responsable</th><th>Tipo</th><th>Recuadro / observación</th></tr></thead>
      <tbody>{rows.length ? rows.map((event) => <tr key={event.id}>
        <td>{new Date(event.at).toLocaleString('es-MX')}</td><td>{qnaLabel(event.qna)}<small>{event.fileName}</small></td>
        <td>{event.folio}<small>{event.rfc || 'Sin RFC'}</small></td><td>{event.actor}</td>
        <td>{labels[event.action] || event.action}</td><td>{[event.procedencia, event.nivel, event.documentDate, event.observation].filter(Boolean).join(' · ')}</td>
      </tr>) : <tr><td colSpan="6" className="empty-row">No hay movimientos para esta búsqueda.</td></tr>}</tbody>
    </table></div>{more && <button type="button" disabled={busy} onClick={() => load(true)}>Cargar movimientos anteriores</button>}
  </div></section>;
}
