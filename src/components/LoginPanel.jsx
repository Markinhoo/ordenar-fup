import { useState } from 'react';
import { accounts, login } from '../lib/api';

export default function LoginPanel({ onLogin }) {
  const [recovery, setRecovery] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const invite = new URLSearchParams(location.search).has('invite');

  async function signIn(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { const session = await login(email, password); setPassword(''); onLogin(session); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function loadQuestion() {
    setBusy(true); setMessage('');
    try { const result = await accounts('question', { email: recoveryEmail }, true);
      setQuestion(result.question || 'No hay pregunta configurada para esta cuenta. Pide ayuda a la encargada.'); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function recover(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await accounts('recover', { email: recoveryEmail, answer, password: newPassword }, true);
      setEmail(recoveryEmail.trim()); setAnswer(''); setNewPassword(''); setRecovery(false);
      setMessage('Contraseña actualizada. Ya puedes entrar.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <main className="auth-panel"><div className="auth-card">
    <p className="eyebrow">CONTROL COMPARTIDO</p>
    <h1>Inicia sesión en Ordenar FUP</h1>
    <p>{invite ? 'Este QR está asignado a una cuenta. Entra con la cuenta que creó la encargada para ti.'
      : 'La cuenta administradora crea usuarios y carga el Excel; el equipo verifica los documentos.'}</p>
    {!recovery ? <><form onSubmit={signIn}>
      <label>Correo electrónico<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      <button className="primary" disabled={busy}>Entrar</button>
    </form><button className="text-button" type="button" onClick={() => { setRecovery(true); setRecoveryEmail(email); setMessage(''); }}>Olvidé mi contraseña</button></>
      : <form className="stack-form" onSubmit={recover}>
        <label>Correo de tu cuenta<input type="email" autoComplete="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} required /></label>
        <button type="button" onClick={loadQuestion} disabled={busy}>Ver pregunta de respaldo</button>
        <p>{question}</p>
        <label>Respuesta de respaldo<input type="password" autoComplete="off" minLength="8" value={answer} onChange={(event) => setAnswer(event.target.value)} required /></label>
        <label>Nueva contraseña<input type="password" autoComplete="new-password" minLength="8" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
        <button className="primary" disabled={busy}>Restablecer contraseña</button>
        <button type="button" className="text-button" onClick={() => { setRecovery(false); setMessage(''); }}>Volver al acceso</button>
      </form>}
    <p className={`message${message ? ' error' : ''}`} role="status">{message}</p>
  </div></main>;
}
