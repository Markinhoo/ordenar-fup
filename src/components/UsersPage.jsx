import { useMemo, useState } from 'react';
import { accounts } from '../lib/api';

export default function UsersPage({ account, users, hidden, onUsersChanged, onAccountChanged }) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('operador');
  const [password, setPassword] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [editedUsername, setEditedUsername] = useState('');
  const [editedName, setEditedName] = useState('');
  const [assignedPassword, setAssignedPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ text: '', error: false });
  const visible = useMemo(() => users.filter((user) =>
    `${user.username} ${user.name} ${user.role}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es'))), [users, query]);

  async function run(action, payload, success, after) {
    setBusy(true); setNotice({ text: '', error: false });
    try {
      await accounts(action, payload);
      await after?.();
      setNotice({ text: success, error: false });
    } catch (error) { setNotice({ text: error.message, error: true }); }
    finally { setBusy(false); }
  }

  function edit(user, type) {
    setEditing({ id: user.id, type }); setEditedUsername(user.username); setEditedName(user.name);
    setAssignedPassword(''); setNotice({ text: '', error: false });
  }

  function remove(user) {
    if (!confirm(`¿Eliminar la cuenta @${user.username}? Ya no podrá iniciar sesión. La bitácora conservará los escaneos que realizó.`)) return;
    run('delete-user', { userId: user.id }, `Cuenta @${user.username} eliminada.`, async () => {
      setEditing(null); await onUsersChanged();
    });
  }

  return <section className="section users-page" hidden={hidden} aria-label="Administrar usuarios">
    <div className="panel users-create-panel">
      <h2>Crear usuario</h2>
      <p>Asigna los datos de acceso y el rol. El nombre de usuario puede incluir espacios y mayúsculas.</p>
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); run('create-user',
        { username, name, role, password, question, answer }, `Cuenta @${username.trim()} creada.`, async () => {
          setUsername(''); setName(''); setRole('operador'); setPassword(''); setQuestion(''); setAnswer(''); await onUsersChanged();
        }); }}>
        <label>Nombre de usuario<input autoComplete="off" minLength="3" maxLength="80" placeholder="Por ejemplo, STEPHANIA MORALES" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label>Nombre para el listado (opcional)<input autoComplete="off" maxLength="80" placeholder="Se usará el nombre de usuario si lo dejas vacío" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Rol<select value={role} onChange={(event) => setRole(event.target.value)}><option value="operador">Operador · escanea documentos</option><option value="administrador">Administrador · gestiona cuentas y lotes</option></select></label>
        <label>Contraseña inicial<input type="password" autoComplete="new-password" minLength="8" maxLength="128" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label>Pregunta de seguridad<input minLength="10" maxLength="160" placeholder="Por ejemplo, ¿Lugar de nacimiento?" value={question} onChange={(event) => setQuestion(event.target.value)} required /></label>
        <label>Respuesta de seguridad<input type="password" autoComplete="off" minLength="1" maxLength="160" placeholder="Puede ser una respuesta corta" value={answer} onChange={(event) => setAnswer(event.target.value)} required /></label>
        <button className="primary" disabled={busy}>Crear usuario</button>
      </form>
      <p className={`message${notice.error ? ' error' : ''}`}>{notice.text}</p>
    </div>
    <div className="panel users-directory-panel">
      <div className="users-directory-heading"><div><h2>Usuarios del equipo</h2><p>{users.length} cuentas · {users.filter((user) => user.role === 'administrador').length} administradores · {users.filter((user) => user.role === 'operador').length} operadores</p></div>
        <input type="search" aria-label="Buscar usuarios" placeholder="Buscar usuario o rol" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <p className={`message${notice.error ? ' error' : ''}`} role="status" aria-live="polite">{notice.text}</p>
      <div className="users-directory-scroll"><table className="users-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Seguridad</th><th>Acciones</th></tr></thead><tbody>
        {visible.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><small>@{user.username}{user.id === account.id ? ' · Tú' : ''}</small></td>
          <td><select aria-label={`Rol de ${user.username}`} value={user.role} disabled={busy || user.id === account.id}
            onChange={(event) => run('set-role', { userId: user.id, role: event.target.value }, `Rol de @${user.username} actualizado.`, onUsersChanged)}>
            <option value="operador">Operador</option><option value="administrador">Administrador</option></select></td>
          <td>{user.recoverySet ? 'Pregunta lista' : 'Sin pregunta'}</td>
          <td><div className="users-actions"><button type="button" disabled={busy} onClick={() => edit(user, 'name')}>Editar</button>
            {user.id !== account.id && <><button type="button" disabled={busy} onClick={() => edit(user, 'password')}>Contraseña</button><button type="button" className="danger" disabled={busy} onClick={() => remove(user)}>Eliminar</button></>}</div></td></tr>)}
        {!visible.length && <tr><td colSpan="4" className="empty-row">No hay usuarios con este filtro.</td></tr>}
      </tbody></table></div>
      {editing && <form className="stack-form users-edit-form" onSubmit={(event) => { event.preventDefault(); const user = users.find((item) => item.id === editing.id);
        if (!user) return;
        if (editing.type === 'password') run('set-user-password', { userId: user.id, password: assignedPassword }, `Contraseña de @${user.username} actualizada.`, () => { setAssignedPassword(''); setEditing(null); });
        else run('update-user', { userId: user.id, username: editedUsername, name: editedName }, 'Datos del usuario actualizados.', async () => {
          if (user.id === account.id) onAccountChanged({ ...account, username: editedUsername.trim().toLocaleLowerCase('es'), name: editedName.trim() });
          setEditing(null); await onUsersChanged();
        }); }}>
        <h3>{editing.type === 'password' ? 'Asignar contraseña' : 'Editar usuario'} · @{users.find((user) => user.id === editing.id)?.username}</h3>
        {editing.type === 'password' ? <input type="password" autoComplete="new-password" minLength="8" maxLength="128" aria-label="Nueva contraseña" value={assignedPassword} onChange={(event) => setAssignedPassword(event.target.value)} required /> : <>
          <input aria-label="Nombre de usuario" minLength="3" maxLength="80" value={editedUsername} onChange={(event) => setEditedUsername(event.target.value)} required />
          <input aria-label="Nombre para el listado" maxLength="80" value={editedName} onChange={(event) => setEditedName(event.target.value)} required /></>}
        <div><button className="primary" disabled={busy}>Guardar cambios</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></div>
      </form>}
    </div>
  </section>;
}
