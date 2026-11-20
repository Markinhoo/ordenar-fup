import { useState } from 'react';
import { accounts } from '../lib/api';

export default function AccountModal({ account, users, view, onClose, onUsersChanged, onAccountChanged }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [question, setQuestion] = useState(account.question || '');
  const [answer, setAnswer] = useState('');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('operador');
  const [password, setPassword] = useState('');
  const [userQuestion, setUserQuestion] = useState('');
  const [userAnswer, setUserAnswer] = useState('');
  const [editing, setEditing] = useState(null);
  const [editedUsername, setEditedUsername] = useState('');
  const [editedName, setEditedName] = useState('');
  const [assignedPassword, setAssignedPassword] = useState('');
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

  function openEdit(user, type) {
    setEditing({ id: user.id, type }); setEditedUsername(user.username); setEditedName(user.name);
    setAssignedPassword(''); setMessage('');
  }

  return <div className="account-modal" role="dialog" aria-modal="true" aria-label="Administrar cuenta" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="account-card">
      <div className="account-heading"><h2>{view === 'users' ? 'Administrar usuarios' : 'Mi cuenta'}</h2><button type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      <p className={`message${error ? ' error' : ''}`} role="status">{message}</p>
      {view === 'me' && <>
        <p>{account.name} · @{account.username} · {account.isAdmin ? 'Administrador' : 'Operador'}</p>
        <form className="stack-form" onSubmit={(event) => { event.preventDefault(); run('change-password', { currentPassword, password: newPassword }, 'Contraseña actualizada.', () => { setCurrentPassword(''); setNewPassword(''); }); }}>
          <h3>Cambiar mi contraseña</h3>
          <input type="password" autoComplete="current-password" placeholder="Contraseña actual" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
          <input type="password" autoComplete="new-password" minLength="8" placeholder="Nueva contraseña (8 caracteres mínimo)" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          <button className="primary" disabled={busy}>Guardar contraseña</button>
        </form>
        <form className="stack-form" onSubmit={(event) => { event.preventDefault(); run('set-recovery', { question, answer }, 'Pregunta de respaldo guardada.', () => { onAccountChanged({ ...account, question: question.trim(), recoverySet: true }); setAnswer(''); }); }}>
          <h3>Pregunta de respaldo</h3><p>La respuesta solo la conoces tú y no se mostrará después.</p>
          <input minLength="10" maxLength="160" placeholder="Tu pregunta privada" value={question} onChange={(event) => setQuestion(event.target.value)} required />
          <input type="password" autoComplete="off" minLength="8" maxLength="160" placeholder="Respuesta (8 caracteres mínimo)" value={answer} onChange={(event) => setAnswer(event.target.value)} required />
          <button className="primary" disabled={busy}>Guardar pregunta</button>
        </form>
      </>}
      {view === 'users' && account.isAdmin && <section className="users-section">
        <h3>Crear cuenta</h3>
        <form className="stack-form" onSubmit={(event) => { event.preventDefault(); run('create-user',
          { username, name, role, password, question: userQuestion, answer: userAnswer },
          `Cuenta @${username.trim().toLowerCase()} creada. Comparte el usuario y contraseña de forma privada.`, async () => {
            setUsername(''); setName(''); setRole('operador'); setPassword(''); setUserQuestion(''); setUserAnswer(''); await onUsersChanged();
          }); }}>
          <input autoComplete="off" minLength="3" maxLength="32" placeholder="Nombre de usuario para iniciar sesión" value={username} onChange={(event) => setUsername(event.target.value)} required />
          <input autoComplete="off" maxLength="80" placeholder="Nombre para el listado (opcional)" value={name} onChange={(event) => setName(event.target.value)} />
          <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Rol de la nueva cuenta"><option value="operador">Operador · escanea documentos</option><option value="administrador">Administrador · gestiona cuentas y lotes</option></select>
          <input type="password" autoComplete="new-password" minLength="8" maxLength="128" placeholder="Contraseña inicial (8 caracteres mínimo)" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <input minLength="10" maxLength="160" placeholder="Pregunta de seguridad" value={userQuestion} onChange={(event) => setUserQuestion(event.target.value)} required />
          <input type="password" autoComplete="off" minLength="8" maxLength="160" placeholder="Respuesta de seguridad" value={userAnswer} onChange={(event) => setUserAnswer(event.target.value)} required />
          <button className="primary" disabled={busy}>Crear usuario</button>
        </form>
        <h3>Usuarios del equipo</h3>
        <div id="usersList">{users.map((user) => <div className="user-entry" key={user.id}>
          <div className="user-summary"><span><strong>{user.name}</strong><small>@{user.username} · {user.recoverySet ? 'Respaldo listo' : 'Sin respaldo'}</small></span>
            <select aria-label={`Rol de ${user.username}`} value={user.role} disabled={busy || user.id === account.id}
              onChange={(event) => run('set-role', { userId: user.id, role: event.target.value }, 'Rol actualizado.', onUsersChanged)}>
              <option value="operador">Operador</option><option value="administrador">Administrador</option>
            </select>
            <button type="button" disabled={busy} onClick={() => openEdit(user, 'name')}>Editar</button>
            {user.id !== account.id && <button type="button" disabled={busy} onClick={() => openEdit(user, 'password')}>Contraseña</button>}
          </div>
          {editing?.id === user.id && editing.type === 'name' && <form className="stack-form user-edit" onSubmit={(event) => { event.preventDefault(); run('update-user', { userId: user.id, username: editedUsername, name: editedName }, 'Usuario actualizado.', async () => {
            if (user.id === account.id) onAccountChanged({ ...account, username: editedUsername.trim().toLowerCase(), name: editedName.trim() });
            setEditing(null); await onUsersChanged();
          }); }}>
            <input aria-label="Nuevo nombre de usuario" value={editedUsername} onChange={(event) => setEditedUsername(event.target.value)} required />
            <input aria-label="Nuevo nombre en el listado" value={editedName} onChange={(event) => setEditedName(event.target.value)} required />
            <button className="primary" disabled={busy}>Guardar usuario</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button>
          </form>}
          {editing?.id === user.id && editing.type === 'password' && <form className="stack-form user-edit" onSubmit={(event) => { event.preventDefault(); run('set-user-password', { userId: user.id, password: assignedPassword }, 'Contraseña asignada.', () => { setAssignedPassword(''); setEditing(null); }); }}>
            <input type="password" autoComplete="new-password" minLength="8" maxLength="128" aria-label={`Nueva contraseña para ${user.username}`} placeholder="Nueva contraseña" value={assignedPassword} onChange={(event) => setAssignedPassword(event.target.value)} required />
            <button className="primary" disabled={busy}>Guardar contraseña</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button>
          </form>}
        </div>)}</div>
      </section>}
    </div>
  </div>;
}
