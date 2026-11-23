import { useCallback, useEffect, useState } from 'react';
import { accounts, lastBatchKey, logout, readSession, rpc, saveSession } from '../lib/api';
import { qnaLabel } from '../lib/qna';
import { useTheme } from '../lib/theme';
import ThemeToggle from '../components/ThemeToggle';
import LoginPanel from '../components/LoginPanel';
import AccountModal from '../components/AccountModal';
import UsersPage from '../components/UsersPage';
import BatchSetup from '../components/BatchSetup';
import BatchList from '../components/BatchList';
import HistoryView from '../components/HistoryView';
import ScanModal from '../components/ScanModal';
import Brand from '../components/Brand';
import ProfileMenu from '../components/ProfileMenu';
import BrandedLoader from '../components/BrandedLoader';
import '../styles/control.css';
import '../styles/login.css';

export default function ControlPage() {
  const scanOnly = new URLSearchParams(location.search).get('scan') === '1';
  const [theme, toggleTheme] = useTheme();
  const [session, setSession] = useState(readSession);
  const [pairing, setPairing] = useState(() => new URLSearchParams(location.hash.slice(1)).get('pair') || '');
  const [account, setAccount] = useState(null);
  const [users, setUsers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [batch, setBatch] = useState(null);
  const [section, setSection] = useState(() => /\/organizar(?:\.html)?$/i.test(location.pathname) ? 'setup' : 'waiting');
  const [notice, setNotice] = useState({ text: '', error: false });
  const [accountView, setAccountView] = useState(null);
  const [scanMode, setScanMode] = useState(scanOnly ? 'camera' : null);
  const [photo, setPhoto] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [setupVersion, setSetupVersion] = useState(0);
  const [loading, setLoading] = useState(!!session);
  const isAdmin = account?.isAdmin === true;
  const message = useCallback((text, error = false) => setNotice({ text, error }), []);

  useEffect(() => {
    if (!pairing) return;
    let active = true;
    accounts('redeem-device', { token: pairing }, true)
      .then((data) => { if (active) setSession(saveSession(data)); })
      .catch((error) => { if (active) message(error.message, true); })
      .finally(() => { if (active) { history.replaceState(null, '', location.pathname + location.search); setPairing(''); } });
    return () => { active = false; };
  }, [pairing, message]);

  const openBatch = useCallback(async (id) => {
    const data = await rpc('v2_get_batch', { p_batch_id: id });
    setBatch(data); setSection('list');
    localStorage.setItem(lastBatchKey, id);
    const url = new URL(location.href); url.searchParams.set('b', id); history.replaceState(null, '', url);
    return data;
  }, []);

  const refreshBatch = useCallback(async (historyToo = false) => {
    if (!batch?.id) return;
    const data = await rpc('v2_get_batch', { p_batch_id: batch.id });
    setBatch(data);
    if (historyToo) setHistoryVersion((value) => value + 1);
  }, [batch?.id]);

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    let active = true;
    async function boot() {
      setLoading(true);
      try {
        const profile = await accounts('profile');
        if (!active) return;
        setAccount(profile);
        const [directory, owned] = await Promise.all([
          profile.isAdmin ? accounts('list-users') : Promise.resolve({ users: [] }),
          rpc('v2_list_batches'),
        ]);
        if (!active) return;
        setUsers(directory.users); setBatches(owned);
        const url = new URL(location.href);
        const requestedSetup = /\/organizar(?:\.html)?$/i.test(url.pathname) || url.searchParams.get('section') === 'setup';
        if (requestedSetup) { url.pathname = '/'; url.searchParams.delete('section'); history.replaceState(null, '', url); }
        if (url.searchParams.has('invite')) {
          const claim = await rpc('v2_claim_worker', { p_token: url.searchParams.get('invite') });
          url.searchParams.delete('invite'); url.searchParams.set('b', claim.batchId);
          history.replaceState(null, '', url);
          message(`Acceso activado para ${claim.name}.`);
        }
        const candidates = scanOnly ? [url.searchParams.get('b')].filter(Boolean)
          : [...new Set([url.searchParams.get('b'), localStorage.getItem(lastBatchKey), owned[0]?.id].filter(Boolean))];
        let opened = false;
        for (const id of candidates) {
          try { await openBatch(id); opened = true; break; }
          catch (error) { if (id === url.searchParams.get('b')) message(error.message, true); }
        }
        if (requestedSetup && profile.isAdmin) setSection('setup');
        else if (!opened) setSection(profile.isAdmin ? 'setup' : 'waiting');
        if (!profile.recoverySet) { setAccountView('me'); message('Configura tu pregunta de respaldo para recuperar tu acceso.'); }
      } catch (error) {
        if (!active) return;
        message(error.message, true);
        if (/sesión terminó|Inicia sesión/i.test(error.message)) { await logout(); setSession(null); setAccount(null); }
        else setSection('waiting');
      } finally { if (active) setLoading(false); }
    }
    boot();
    return () => { active = false; };
  }, [session?.access_token]);

  useEffect(() => {
    if (!batch?.id) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      rpc('v2_get_batch', { p_batch_id: batch.id }).then(setBatch)
        .catch((error) => message(`Sincronización: ${error.message}`, true));
    }, 5000);
    return () => clearInterval(timer);
  }, [batch?.id]);

  useEffect(() => {
    if (!session || !account || isAdmin || batch?.id) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      rpc('v2_list_batches').then(async (assigned) => {
        setBatches(assigned);
        if (assigned[0]?.id) await openBatch(assigned[0].id);
      }).catch((error) => message(`Sincronización: ${error.message}`, true));
    }, 5000);
    return () => clearInterval(timer);
  }, [session?.access_token, account?.id, isAdmin, batch?.id, openBatch]);

  useEffect(() => {
    function escape(event) {
      if (event.key !== 'Escape') return;
      if (scanMode) { setScanMode(null); setPhoto(null); }
      else if (accountView) setAccountView(null);
    }
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [scanMode, accountView]);

  async function createBatch({ fileName, qna, records, workers }) {
    message('Creando lote y asignaciones…');
    try {
      const created = await rpc('v2_create_batch', { p_file_name: fileName, p_qna: qna,
        p_records: records, p_workers: workers });
      setBatches(await rpc('v2_list_batches'));
      await openBatch(created.batchId);
      message('Lote creado. Cada operador verá su asignación y su QR al iniciar sesión.');
    } catch (error) { message(error.message, true); }
  }

  async function loadUsers() {
    try { const result = await accounts('list-users'); setUsers(result.users); }
    catch (error) { message(error.message, true); }
  }

  async function signOut() {
    await logout(); setSession(null); setAccount(null); setUsers([]); setBatches([]); setBatch(null);
    setSection('waiting'); setAccountView(null); setScanMode(null); setPhoto(null); message('');
  }

  const title = section === 'users' ? 'Administrar usuarios' : section === 'setup' ? 'Preparar lote y ordenar Excel' : section === 'waiting' ? 'Verificación de documentos'
    : batch?.isAdmin ? 'Control de la encargada' : 'Escaneo de documentos';
  const meta = section === 'users' ? 'Crea cuentas, cambia roles y administra los accesos del equipo.' : section === 'setup' ? 'Un archivo y una asignación para el lote compartido y el Excel descargable.'
    : section === 'waiting' ? 'La encargada aún no te asigna un lote. Cuando lo haga aparecerá aquí.'
      : batch ? `${qnaLabel(batch.qna)} · ${batch.fileName} · ${batch.records.length} registros` : '';

  if (scanOnly && (pairing || loading || (session && !account))) return <div className="scan-only-shell"><BrandedLoader /></div>;
  if (scanOnly && (!session || !account || !batch)) return <div className="scan-only-shell"><div className="scan-reopen">
    <h1>No se pudo abrir el escáner</h1><p role="alert">{notice.text || 'El QR venció o no tienes acceso a este lote. Genera otro QR desde tu sesión en la computadora.'}</p>
  </div></div>;
  if (scanOnly) return <div className="scan-only-shell">
    {!scanMode && <div className="scan-reopen"><h1>Escáner FUP</h1><p>{account.name} · {qnaLabel(batch.qna)}</p>
      {notice.text && <p role="status">{notice.text}</p>}
      <button className="primary" type="button" onClick={() => setScanMode('camera')}>Abrir cámara</button>
      <label className="photo-button">Tomar foto del recuadro<input type="file" accept="image/*" capture="environment" onChange={(event) => { if (event.target.files[0]) { setPhoto(event.target.files[0]); setScanMode('photo'); } event.target.value = ''; }} /></label>
    </div>}
    <ScanModal batch={batch} mode={scanMode} photo={photo} standalone onClose={() => { setScanMode(null); setPhoto(null); }} onRefresh={refreshBatch} onMessage={message} />
  </div>;

  return <div className={`control-shell${!session ? ' is-auth' : ''}`}>
    <header className="control-header">
      <Brand />
      {session && account && <nav className="header-nav" aria-label="Secciones de trabajo">
        {isAdmin && <button type="button" className={section === 'setup' ? 'active' : ''} aria-current={section === 'setup' ? 'page' : undefined} onClick={() => setSection('setup')}><span className="nav-long">Preparar lote y Excel</span><span className="nav-short">Preparar</span></button>}
        <button type="button" className={section === 'list' || section === 'waiting' ? 'active' : ''} aria-current={section === 'list' || section === 'waiting' ? 'page' : undefined}
          onClick={() => setSection(batch ? 'list' : isAdmin ? 'setup' : 'waiting')}><span className="nav-long">Listado y avance</span><span className="nav-short">Listado</span></button>
        {isAdmin && batches.length > 0 && <button type="button" className={section === 'history' ? 'active' : ''} aria-current={section === 'history' ? 'page' : undefined} onClick={() => setSection('history')}><span className="nav-long">Bitácora por QNA</span><span className="nav-short">Bitácora</span></button>}
        {isAdmin && <button type="button" className={section === 'users' ? 'active' : ''} aria-current={section === 'users' ? 'page' : undefined} onClick={() => { setSection('users'); loadUsers(); }}>Usuarios</button>}
      </nav>}
      <div className="header-right"><ThemeToggle theme={theme} onToggle={toggleTheme} />
        {session && account && <ProfileMenu account={account} isAdmin={isAdmin}
          onAccount={() => setAccountView('me')}
          onUsers={() => { setSection('users'); loadUsers(); }} onLogout={signOut} />}
      </div>
    </header>
    {pairing ? <BrandedLoader /> : !session ? <LoginPanel onLogin={setSession} /> : loading ? <BrandedLoader /> : !account ? <main className="auth-panel"><div className="auth-card"><p role="status">No se pudo abrir tu cuenta.</p><p className="message error">{notice.text}</p><button type="button" onClick={signOut}>Salir e intentar de nuevo</button></div></main> : <main className="app-panel">
      <div className="app-top"><div><p className="eyebrow">VERIFICACIÓN FUP</p><h1>{title}</h1><p>{meta}</p></div>
        <div className="top-actions" hidden={section === 'users'}>
          {batches.length > 0 && <><select aria-label="Elegir lote" value={batch?.id || ''} onChange={(event) => openBatch(event.target.value).catch((error) => message(error.message, true))}>
            {batches.map((item) => <option key={item.id} value={item.id}>{qnaLabel(item.qna)} · {item.fileName}</option>)}
          </select>{isAdmin && <button type="button" onClick={() => { setSetupVersion((value) => value + 1); setSection('setup'); }}>Nuevo lote</button>}</>}
        </div>
      </div>
      <p className={`message${notice.error ? ' error' : ''}`} role="status" aria-live="polite">{notice.text}</p>
      {isAdmin && <BatchSetup key={setupVersion} users={users} hidden={section !== 'setup'} onCreate={createBatch} onMessage={message} />}
      {isAdmin && <UsersPage account={account} users={users} hidden={section !== 'users'} onUsersChanged={loadUsers} onAccountChanged={setAccount} />}
      <section className="section waiting-section" hidden={section !== 'waiting'}><div className="panel waiting-card"><h2>Listo para verificar</h2><p>Cuando la encargada te asigne un lote, aparecerá aquí automáticamente con tu QR para abrirlo en el celular.</p></div></section>
      {batch && <><BatchList batch={batch} account={account} hidden={section !== 'list'} onMessage={message} onRefresh={refreshBatch}
        onOpenScanner={() => setScanMode('camera')} onPhoto={(file) => { if (file) { setPhoto(file); setScanMode('photo'); } }} />
        {isAdmin && <HistoryView batch={batch} batches={batches} hidden={section !== 'history'} version={historyVersion} onMessage={message} />}
      </>}
    </main>}
    {account && <AccountModal account={account} view={accountView} onClose={() => setAccountView(null)} onAccountChanged={setAccount} />}
    {batch && <ScanModal batch={batch} mode={scanMode} photo={photo}
      onClose={() => { setScanMode(null); setPhoto(null); }} onRefresh={refreshBatch} onMessage={message} />}
  </div>;
}
