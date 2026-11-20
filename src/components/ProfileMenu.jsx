import { useEffect, useRef, useState } from 'react';

export default function ProfileMenu({ account, email, isAdmin, onAccount, onUsers, onLogout }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const name = account?.name || account?.displayName || email || 'Usuario';
  const initials = name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event) => { if (!menuRef.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);

  function choose(action) { setOpen(false); action(); }
  return <div className="profile-menu" ref={menuRef}>
    <button className="profile-avatar" type="button" aria-label="Abrir perfil" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{initials}</button>
    {open && <div className="profile-dropdown">
      <strong>{name}</strong><small>{email}</small>
      <button type="button" onClick={() => choose(onAccount)}>Mi cuenta</button>
      {isAdmin && <button type="button" onClick={() => choose(onUsers)}>Administrar usuarios</button>}
      <button type="button" onClick={() => choose(onLogout)}>Cerrar sesión</button>
    </div>}
  </div>;
}
