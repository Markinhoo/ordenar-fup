import { useEffect, useState } from 'react';
import '../styles/sidebar.css';

const paths = {
  setup: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h6M7 17h4" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  excel: <><path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h8" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 7a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5" /></>,
  account: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  exit: <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 16l4-4-4-4M18 12H9" /></>,
  menu: <><path d="M5 6h14M5 12h14M5 18h14" /></>,
  close: <><path d="M5 5l14 14M19 5 5 19" /></>,
};

function Icon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function AppSidebar({ admin, section, hasBatches, page = 'control', onNavigate, onUsers, onAccount, onLogout }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  function action(callback) { callback(); setOpen(false); }
  const item = (key, label, callback, active = false) => <button key={key} type="button" onClick={() => action(callback)}
    className={active ? 'active' : ''} aria-label={label} aria-current={active ? 'page' : undefined} data-tooltip={label}>
    <Icon name={key} /><span className="sidebar-label">{label}</span></button>;

  return <>
    <button className="sidebar-mobile-trigger" type="button" onClick={() => setOpen(true)} aria-label="Abrir menú"><Icon name="menu" /></button>
    {open && <button className="sidebar-backdrop" type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" />}
    <aside className={`app-sidebar${open ? ' is-expanded' : ''}`} aria-label="Menú principal">
      <div className="sidebar-heading"><button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Contraer menú' : 'Expandir menú'}
        aria-expanded={open} data-tooltip={open ? 'Contraer menú' : 'Expandir menú'}><Icon name={open ? 'close' : 'menu'} /><span className="sidebar-label">Menú</span></button></div>
      <nav aria-label="Secciones">
        {page === 'control' ? <>
          {admin && item('setup', 'Preparar lote y ordenar Excel', () => onNavigate('setup'), section === 'setup')}
          {item('list', 'Listado y avance', () => onNavigate('list'), section === 'list' || section === 'waiting')}
          {admin && hasBatches && item('history', 'Bitácora por QNA', () => onNavigate('history'), section === 'history')}
        </> : <>
          <a href="/" aria-label="Control de documentos" data-tooltip="Control de documentos"><Icon name="list" /><span className="sidebar-label">Control de documentos</span></a>
          <a href="/organizar" className={page === 'organizer' ? 'active' : ''} aria-current={page === 'organizer' ? 'page' : undefined} aria-label="Ordenar Excel" data-tooltip="Ordenar Excel"><Icon name="excel" /><span className="sidebar-label">Ordenar Excel</span></a>
          {page === 'legacy' && <a href="/sala" className="active" aria-current="page" aria-label="Sala anterior" data-tooltip="Sala anterior"><Icon name="history" /><span className="sidebar-label">Sala anterior</span></a>}
        </>}
      </nav>
      <div className="sidebar-actions">
        {page === 'control' && admin && item('users', 'Usuarios', onUsers)}
        {page === 'control' && item('account', 'Mi cuenta', onAccount)}
        {item('exit', 'Salir', onLogout)}
      </div>
    </aside>
  </>;
}
