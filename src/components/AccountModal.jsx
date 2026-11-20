import { useState } from 'react';
import { accounts } from '../lib/api';
import { securityQuestions } from '../lib/securityQuestions';

export default function AccountModal({ account, view, onClose, onAccountChanged }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [question, setQuestion] = useState(securityQuestions.includes(account.question) ? account.question : '');
  const [answer, setAnswer] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!view) return null;

  async function run(action, payload, success, after) {
    setBusy(true); setMessage(''); setError(false);
    try { await accounts(action, payload); setMessage(success); after?.(); }
    catch (cause) { setError(true); setMessage(cause.message); }
    finally { setBusy(false); }
  }

  return <div className="account-modal" role="dialog" aria-modal="true" aria-label="Mi cuenta" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="account-card">
      <div className="account-heading"><h2>Mi cuenta</h2><button type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      <p className={`message${error ? ' error' : ''}`} role="status">{message}</p>
      <p>{account.name} · @{account.username} · {account.isAdmin ? 'Administrador' : 'Operador'}</p>
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); run('change-password', { currentPassword, password: newPassword }, 'Contraseña actualizada.', () => { setCurrentPassword(''); setNewPassword(''); }); }}>
        <h3>Cambiar mi contraseña</h3>
        <input type="password" autoComplete="current-password" placeholder="Contraseña actual" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        <input type="password" autoComplete="new-password" minLength="8" placeholder="Nueva contraseña (8 caracteres mínimo)" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
        <button className="primary" disabled={busy}>Guardar contraseña</button>
      </form>
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); run('set-recovery', { question, answer }, 'Pregunta de respaldo guardada.', () => { onAccountChanged({ ...account, question: question.trim(), recoverySet: true }); setAnswer(''); }); }}>
        <h3>Pregunta de respaldo</h3><p>La respuesta solo la conoces tú y no se mostrará después. Puede ser corta.</p>
        {account.question && !securityQuestions.includes(account.question) && <p>Tu pregunta anterior sigue funcionando. Elige una de las nuevas opciones si deseas cambiarla.</p>}
        <select aria-label="Pregunta de respaldo" value={question} onChange={(event) => setQuestion(event.target.value)} required>
          <option value="">Selecciona una pregunta</option>{securityQuestions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <input type="password" autoComplete="off" minLength="1" maxLength="160" placeholder="Respuesta de seguridad" value={answer} onChange={(event) => setAnswer(event.target.value)} required />
        <button className="primary" disabled={busy}>Guardar pregunta</button>
      </form>
    </div>
  </div>;
}
