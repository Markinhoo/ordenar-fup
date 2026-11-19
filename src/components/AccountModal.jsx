import { useState } from 'react';
import { accounts } from '../lib/api';

export default function AccountModal({ account, users, view, onClose, onUsersChanged, onAccountChanged }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [question, setQuestion] = useState(account.question || '');
  const [answer, setAnswer] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [credential, setCredential] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!view) return null;

  async function run(action, payload, success, after) {
    setBusy(true); setMessage(''); setError(false);
    try { const result = await accounts(action, payload); setMessage(success); await after?.(result); }
    catch (cause) { setError(true); setMessage(cause.message); }
    finally { setBusy(false); }
  }

  async function resetUser(user) {
    if (!confirm(`¿Generar una nueva contraseña para ${user.name} (${user.email})? La anterior dejará de servir.`)) return;
    await run('reset-user', { email: user.email }, 'Contraseña inicial renovada.', (result) =>
      setCredential(`${result.email} · Nueva contraseña: ${result.password}. Entrégala de forma privada; se muestra solo ahora.`));
  }

  return <div className="account-modal" role="dialog" aria-modal="true" aria-label="Administrar cuenta" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="account-card">
      <div className="account-heading"><h2>{view === 'users' ? 'Administrar usuarios' : 'Mi cuenta'}</h2><button type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      <p className={`message${error ? ' error' : ''}`} role="status">{message}</p>
      <p>{account.name} · {account.email}</p>
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); run('change-password', { currentPassword, password: newPassword }, 'Contraseña actualizada.', () => { setCurrentPassword(''); setNewPassword(''); }); }}>
        <h3>Cambiar mi contraseña</h3>
        <input type="password" autoComplete="current-password" placeholder="Contraseña actual" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        <input type="password" autoComplete="new-password" minLength="8" placeholder="Nueva contraseña (8 caracteres mínimo)" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
        <button className="primary" disabled={busy}>Guardar contraseña</button>
      </form>
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); run('set-recovery', { question, answer }, 'Pregunta de respaldo guardada.', () => { onAccountChanged({ ...account, question: question.trim(), recoverySet: true }); setAnswer(''); }); }}>
        <h3>Pregunta de respaldo</h3><p>Elige una pregunta y una respuesta que puedas recordar. La respuesta no se mostrará después.</p>
        <input minLength="10" maxLength="160" placeholder="Tu pregunta privada" value={question} onChange={(event) => setQuestion(event.target.value)} required />
        <input type="password" autoComplete="off" minLength="8" maxLength="160" placeholder="Respuesta (8 caracteres mínimo)" value={answer} onChange={(event) => setAnswer(event.target.value)} required />
        <button className="primary" disabled={busy}>Guardar pregunta</button>
      </form>
      {view === 'users' && account.isAdmin && <section>
        <h3>Usuarios del equipo</h3>
        <form className="stack-form" onSubmit={(event) => { event.preventDefault(); run('create-user', { name, email }, 'Usuario creado sin confirmación por correo.', async (result) => {
          setCredential(`${result.name} · ${result.email} · Contraseña inicial: ${result.password}. Entrégala a esta persona de forma privada; se muestra solo ahora.`);
          setName(''); setEmail(''); await onUsersChanged();
        }); }}>
          <input placeholder="Nombre de la persona" value={name} onChange={(event) => setName(event.target.value)} required />
          <input type="email" placeholder="Correo para iniciar sesión" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <button className="primary" disabled={busy}>Crear usuario</button>
        </form>
        {credential && <p className="credential">{credential}</p>}
        <div id="usersList">{users.map((user) => <div key={user.id}><span>{user.name} · {user.email}</span><span>{user.recoverySet ? 'Respaldo listo' : 'Sin respaldo'}</span>
          {user.email !== 'nomina@fup.com' && <button type="button" disabled={busy} onClick={() => resetUser(user)}>Nueva clave</button>}</div>)}</div>
      </section>}
    </div>
  </div>;
}
