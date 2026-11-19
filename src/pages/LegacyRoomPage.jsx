import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAdmin, logout, readSession, sharedRpc } from '../lib/api';
import { readBook } from '../lib/excelBook';
import { exportCsv } from '../lib/download';
import { getFolioWorker } from '../lib/ocr';
import { drawQr, downloadQr } from '../lib/qr';
import { useTheme } from '../lib/theme';
import ThemeToggle from '../components/ThemeToggle';
import AppSidebar from '../components/AppSidebar';
import '../styles/organizer.css';
import '../styles/organizer-react.css';
import '../styles/legacy-room.css';

const lastRoomKey = 'ordenar-fup:last-team-room';
const validSecret = (value) => /^[0-9a-f]{64}$/.test(value || '');
const digitsOf = (value) => String(value).match(/^\s*(\d+)/)?.[1] || '';

function readSecret(raw) {
  const value = String(raw || '').trim();
  if (validSecret(value)) return value;
  try {
    const url = new URL(value);
    const secret = url.searchParams.get('s');
    return url.origin === location.origin && validSecret(secret) ? secret : '';
  } catch { return ''; }
}

function roomLink(secret) {
  const url = new URL('/sala', location.origin);
  url.searchParams.set('s', secret);
  return url.href;
}

export default function LegacyRoomPage() {
  const [theme, toggleTheme] = useTheme();
  const [allowed, setAllowed] = useState(false);
  const [secret, setSecret] = useState(() => new URLSearchParams(location.search).get('s') || localStorage.getItem(lastRoomKey) || '');
  const [linkInput, setLinkInput] = useState('');
  const [fileName, setFileName] = useState('');
  const [records, setRecords] = useState([]);
  const [verified, setVerified] = useState(new Set());
  const [query, setQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const qrRef = useRef(null);

  const loadRoom = useCallback(async (roomSecret, initial = false) => {
    const data = await sharedRpc('get_room', { p_secret: roomSecret });
    if (!data || !Array.isArray(data.records) || !Array.isArray(data.verified)) throw new Error('No se encontró esta lista compartida. Comprueba el enlace.');
    setRecords(data.records.map((item, id) => ({ id, folio: String(item.folio), rfc: String(item.rfc), digits: digitsOf(item.folio) })));
    setVerified(new Set(data.verified.map(Number)));
    setFileName(data.fileName || 'Listado FUP');
    if (initial) setNotice('Lista compartida cargada. Ya puedes escanear con tu equipo.');
  }, []);

  useEffect(() => {
    if (!readSession()) { location.replace('/'); return; }
    isAdmin().then((admin) => admin ? setAllowed(true) : location.replace('/')).catch(() => location.replace('/'));
  }, []);

  useEffect(() => {
    if (!allowed || !validSecret(secret)) return;
    let active = true;
    loadRoom(secret, true).then(() => {
      if (active) { localStorage.setItem(lastRoomKey, secret); history.replaceState(null, '', roomLink(secret)); }
    }).catch((error) => { if (active) setNotice(error.message); });
    const timer = setInterval(() => {
      if (!document.hidden) loadRoom(secret).catch((error) => setNotice(`Sincronización: ${error.message}`));
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [allowed, secret, loadRoom]);

  useEffect(() => { if (validSecret(secret)) drawQr(qrRef.current, roomLink(secret)); }, [secret, fileName]);
  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  const visible = useMemo(() => records.filter((item) => (!pendingOnly || !verified.has(item.id))
    && (!query || item.folio.toUpperCase().includes(query.toUpperCase()) || item.rfc.toUpperCase().includes(query.toUpperCase()))), [records, verified, query, pendingOnly]);

  async function join(event) {
    event.preventDefault();
    const next = readSecret(linkInput);
    if (!next) { setNotice('Pega el enlace privado completo del equipo.'); return; }
    setSecret(next); setLinkInput(''); setNotice('Abriendo lista del equipo…');
  }

  async function createRoom(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name) || file.size > 30 * 1024 * 1024) { setNotice('Elige un Excel .xlsx de hasta 30 MB.'); return; }
    setBusy(true); setNotice('Leyendo Excel y creando la sala…');
    try {
      const book = readBook(new Uint8Array(await file.arrayBuffer()));
      const list = book.sheet.slots.map(({ folio, rfc }) => ({ folio, rfc, checked: false }));
      const next = await sharedRpc('create_room', { p_file_name: file.name, p_records: list });
      if (!validSecret(next)) throw new Error('La base de datos no devolvió un enlace válido.');
      setSecret(next); setNotice('QR listo. Muéstralo para que el equipo entre con su celular.');
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }

  async function mark(item, checked) {
    if (busy) return;
    setBusy(true);
    try {
      await sharedRpc('set_mark', { p_secret: secret, p_record_id: item.id, p_checked: checked });
      await loadRoom(secret);
      setNotice(`${item.folio} ${checked ? 'verificado' : 'pendiente'}.`);
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }

  async function scan(image) {
    if (!image || !records.length) return;
    setNotice('Leyendo número de documento…');
    try {
      const worker = await getFolioWorker();
      const { data } = await worker.recognize(image);
      const found = [...new Set((data.text.match(/\b\d{3,12}\b/g) || []))];
      const matches = records.filter((item) => found.includes(item.digits));
      if (matches.length !== 1) { setNotice(matches.length ? 'Se leyeron varios folios. Acerca la cámara.' : 'No se encontró el folio en la lista.'); return; }
      await mark(matches[0], true);
    } catch (error) { setNotice(error.message); }
  }

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream; setCameraOpen(true);
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); } });
    } catch (error) { setNotice(`No se pudo abrir la cámara: ${error.message}`); }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    scan(canvas);
  }

  async function reset() {
    if (!confirm('¿Reiniciar todos los folios verificados de este Excel para todo el equipo?')) return;
    try { await sharedRpc('clear_marks', { p_secret: secret }); await loadRoom(secret); setNotice('Verificación reiniciada.'); }
    catch (error) { setNotice(error.message); }
  }

  if (!allowed) return <div className="organizer-loading" role="status">Comprobando acceso a la sala…</div>;

  return <main className="shell legacy-shell organizer-with-sidebar">
    <AppSidebar page="legacy" admin onLogout={async () => { await logout(); location.replace('/'); }} />
    <header className="topbar"><div className="brand"><span className="brand-mark">↧</span><span>ORDENAR <b>FUP</b></span></div>
      <div className="organizer-header-actions"><ThemeToggle theme={theme} onToggle={toggleTheme} /><a href="/">Control actual</a></div></header>
    <section className="hero"><div className="eyebrow">SALA ANTERIOR</div><h1>Verifica cada folio.</h1><p>Las marcas de esta sala se sincronizan entre dispositivos.</p></section>
    <section className="verify-view">
      <div className="verify-tools card"><div className="card-heading"><div><div className="section-number">CONTROL DE DOCUMENTOS</div><h2>{fileName || 'Abre una sala'}</h2></div></div>
        <form className="join-form" onSubmit={join}><label htmlFor="legacy-link">Enlace del equipo</label><div><input id="legacy-link" value={linkInput} onChange={(event) => setLinkInput(event.target.value)} placeholder="Pega aquí el enlace privado" /><button type="submit">Entrar</button></div></form>
        {!records.length && <label className="verify-file"><input type="file" accept=".xlsx" onChange={(event) => createRoom(event.target.files[0])} /><span>↑</span><strong>O cargar Excel y crear QR</strong></label>}
        {validSecret(secret) && <div className="inline-qr"><canvas ref={qrRef} role="img" aria-label="Código QR de la sala" /><div><strong>QR de acceso del equipo</strong><small>Abre esta sala desde otro dispositivo.</small><button type="button" onClick={() => downloadQr(qrRef.current, `${fileName || 'sala'}_QR.png`)}>Descargar QR</button></div></div>}
        <div className="verify-progress"><strong>{verified.size} / {records.length}</strong><span>documentos verificados</span><div className="progress-track"><div style={{ width: `${records.length ? verified.size / records.length * 100 : 0}%` }} /></div><small>{records.length - verified.size} pendientes</small></div>
        <button className="primary-button" type="button" disabled={!records.length} onClick={openCamera}>Escanear con cámara</button>
        <label className="photo-button">Tomar foto o elegir imagen<input type="file" accept="image/*" capture="environment" onChange={(event) => scan(event.target.files[0])} /></label>
        <p className="verify-message" role="status">{notice}</p>
      </div>
      <div className="verify-list-card card"><div className="verify-list-heading"><div><div className="section-number">LISTADO DEL EXCEL</div><h2>Folios pendientes</h2></div>
        <button type="button" disabled={!records.length} onClick={() => exportCsv([['Folio', 'RFC', 'Estado'], ...records.map((item) => [item.folio, item.rfc, verified.has(item.id) ? 'Verificado' : 'Pendiente'])], `${fileName.replace(/\.xlsx$/i, '')}_verificacion.csv`)}>Descargar CSV</button></div>
        <div className="list-controls"><input type="search" placeholder="Buscar folio o RFC" value={query} onChange={(event) => setQuery(event.target.value)} /><label><input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} /> Solo pendientes</label></div>
        <div className="verify-list">{visible.length ? visible.map((item) => <label className={`verify-row${verified.has(item.id) ? ' checked' : ''}`} key={item.id}>
          <input type="checkbox" checked={verified.has(item.id)} disabled={busy} onChange={(event) => mark(item, event.target.checked)} aria-label={`Verificado: folio ${item.folio}, RFC ${item.rfc}`} />
          <strong>{item.folio}</strong><span>{item.rfc}</span></label>) : <p className="empty-list">{records.length ? 'No hay folios con este filtro.' : 'Abre una sala para ver los folios.'}</p>}</div>
        <button className="clear-progress" type="button" disabled={!verified.size} onClick={reset}>Reiniciar verificación</button>
      </div>
    </section>
    {cameraOpen && <div className="camera-modal" role="dialog" aria-modal="true" aria-label="Escanear folio"><div className="camera-panel"><div className="camera-header"><strong>Escanear No. de documento</strong><button type="button" onClick={closeCamera}>×</button></div>
      <div className="camera-preview"><video ref={videoRef} autoPlay playsInline muted /><div className="scan-frame"><span>Coloca aquí el folio</span></div></div><p>{notice || 'Acerca la cámara hasta que el número se vea nítido.'}</p><button className="primary-button" type="button" onClick={capture}>Leer folio</button></div></div>}
  </main>;
}
