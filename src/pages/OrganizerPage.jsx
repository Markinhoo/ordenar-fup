import { useEffect, useMemo, useState } from 'react';
import { isAdmin, readSession } from '../lib/api';
import { readBook, generateBook, colorFor } from '../lib/excelBook';
import { distribute } from '../lib/qna';
import { downloadBlob } from '../lib/download';
import { useTheme } from '../lib/theme';
import ThemeToggle from '../components/ThemeToggle';

export default function OrganizerPage() {
  const [theme, toggleTheme] = useTheme();
  const [ready, setReady] = useState(false);
  const [book, setBook] = useState(null);
  const [file, setFile] = useState(null);
  const [count, setCount] = useState(2);
  const [names, setNames] = useState([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sizes = useMemo(() => book ? distribute(book.sheet.slots.length, count) : [], [book, count]);

  useEffect(() => {
    if (!readSession()) { location.replace('./control.html'); return; }
    isAdmin().then((admin) => admin ? setReady(true) : location.replace('./control.html'))
      .catch(() => location.replace('./control.html'));
  }, []);

  async function loadFile(nextFile) {
    if (!nextFile) return;
    if (!/\.xlsx$/i.test(nextFile.name) || nextFile.size > 30 * 1024 * 1024) {
      setStatus('Elige un Excel .xlsx de hasta 30 MB.'); setError(true); return;
    }
    setStatus('Leyendo el archivo…'); setError(false);
    try {
      const parsed = readBook(new Uint8Array(await nextFile.arrayBuffer()));
      setBook(parsed); setFile(nextFile);
      setCount((current) => Math.min(current, parsed.sheet.slots.length));
      setStatus('Archivo listo. Escribe los nombres y genera el Excel.');
    } catch (cause) { setBook(null); setFile(null); setStatus(cause.message); setError(true); }
  }

  function changeCount(value) {
    const limit = book?.sheet.slots.length || 350;
    setCount(Math.max(1, Math.min(350, limit, Math.round(Number(value) || 1))));
  }

  async function download() {
    if (!book || busy) return;
    setBusy(true); setStatus('Generando el Excel…'); setError(false);
    try {
      const chosen = sizes.map((_, index) => names[index]?.trim() || `Persona ${index + 1}`);
      const bytes = generateBook(book, chosen);
      downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `${file.name.replace(/\.xlsx$/i, '')}_ordenado.xlsx`);
      setStatus('Excel generado y descargado correctamente.');
    } catch (cause) { setStatus(`No se pudo generar el archivo: ${cause.message}`); setError(true); }
    finally { setBusy(false); }
  }

  if (!ready) return <div className="organizer-loading" role="status">Comprobando acceso de administrador…</div>;

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">↧</span><span>ORDENAR <b>FUP</b></span></div>
      <div className="organizer-header-actions"><span className="private-pill"><span className="private-dot" /> Excel local · control compartido</span><ThemeToggle theme={theme} onToggle={toggleTheme} /><a href="./control.html">Control</a></div>
    </header>
    <section className="hero"><div className="eyebrow"><span className="eyebrow-line" /> ORGANIZA TU LISTADO</div>
      <h1>Tu Excel FUP,<br /><em>ordenado y verificado.</em></h1>
      <p>Ordena y reparte los registros, o comprueba con la cámara que cada documento físico esté en tu listado.</p>
    </section>
    <nav className="mode-tabs" aria-label="Herramientas"><button className="selected" type="button" aria-pressed="true">Ordenar y repartir</button>
      <a href="./control.html">Verificar documentos</a></nav>
    <div className="organize-view">
      <div className="steps"><span className="active">01 <b>Archivo</b></span><i /><span className={book ? 'active' : ''}>02 <b>Personas</b></span><i /><span className={status.startsWith('Excel generado') ? 'active' : ''}>03 <b>Descarga</b></span></div>
      <section className="work-grid">
        <div className="card file-card"><div className="card-heading"><div><div className="section-number">01 / ARCHIVO DE ORIGEN</div><h2>Sube tu listado</h2></div><span className="card-icon">▦</span></div>
          <label className={`dropzone${dragging ? ' drag' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); loadFile(event.dataTransfer.files[0]); }}>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { loadFile(event.target.files[0]); event.target.value = ''; }} />
            <span className="upload-icon">↑</span><strong>{file ? 'Archivo cargado correctamente' : 'Arrastra tu Excel aquí'}</strong>
            <span>{file ? 'Puedes cambiarlo antes de descargar' : 'o haz clic para elegir un archivo .xlsx'}</span>
          </label>
          {file && <div className="file-summary"><div className="summary-icon">XLSX</div><div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} KB · {book.sheet.slots.length} registros</small></div></div>}
          <div className="info-line"><span>ⓘ</span> Se conservan las hojas, imágenes, encabezados y demás contenido del archivo.</div>
        </div>
        <div className="card people-card"><div className="card-heading"><div><div className="section-number">02 / DISTRIBUCIÓN</div><h2>Asigna a las personas</h2></div><span className="card-icon">♧</span></div>
          <label className="field-label" htmlFor="personCount">¿Entre cuántas personas se dividirá?</label>
          <div className="count-control"><button type="button" aria-label="Quitar una persona" onClick={() => changeCount(count - 1)}>−</button>
            <input id="personCount" type="number" min="1" max="350" value={count} inputMode="numeric" onChange={(event) => changeCount(event.target.value)} />
            <button type="button" aria-label="Agregar una persona" onClick={() => changeCount(count + 1)}>+</button></div>
          <p className="field-help">{book ? `Reparto equilibrado de ${book.sheet.slots.length} registros. Los grupos siguen el orden alfabético.` : 'Carga un archivo para ver el reparto.'}</p>
          <div className="people-list">{Array.from({ length: count }, (_, index) => <div className="person-row" key={index}>
            <span className="swatch" style={{ backgroundColor: colorFor(index) }} /><label htmlFor={`person-${index}`}>Persona {index + 1}</label>
            <input id={`person-${index}`} maxLength="80" placeholder="Escribe su nombre" value={names[index] || ''} onChange={(event) => setNames((current) => { const next = [...current]; next[index] = event.target.value; return next; })} />
            <small>{book ? `${sizes[index]} reg.` : '—'}</small>
          </div>)}</div>
        </div>
      </section>
      <section className="result-card"><div className="result-copy"><span className="result-kicker">03 / TU ARCHIVO FINAL</span><h2>Todo en orden, en el mismo formato.</h2>
        <p>El orden se aplica a los RFC de izquierda a derecha, llenando cada columna de arriba abajo. Cada folio viaja con su RFC.</p></div>
        <div className="result-actions"><div className="total">{book?.sheet.slots.length || '—'} <span>registros detectados</span></div>
          <button type="button" onClick={download} disabled={!book || busy}>Generar y descargar Excel <span>↗</span></button></div>
      </section>
    </div>
    <p className={`status${error ? ' error' : ''}`} role="status" aria-live="polite">{status}</p>
    <footer>ORDENAR FUP <span>•</span> El Excel original permanece en tu dispositivo.</footer>
  </main>;
}
